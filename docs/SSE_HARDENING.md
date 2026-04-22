# SSE 链路加固说明

> 适用范围：`GET /api/events/subscribe`（SSE 推送） + 前端 `src/App.jsx` 中的 `EventSource` 订阅
> 最后更新：2026-04-22（分支 `0420claude`）

---

## 背景故障

浏览器控制台报错：

```
/api/events/subscribe:1  Failed to load resource: net::ERR_HTTP2_PROTOCOL_ERROR
```

同时出现 React #31（`object with keys {code, severity, message}`），两件事独立，但都是 SSE 场景下触发。本文档只覆盖 SSE 部分。

---

## 代码侧加固（已在本分支落地）

### 1. `Connection` 头按 HTTP 版本分支

- RFC 9113 §8.2.2 禁止 HTTP/2 响应携带 `Connection`、`Keep-Alive`、`Transfer-Encoding` 等 connection-specific 头
- 若源站显式下发 `Connection: keep-alive`，经 HTTP/2 反代（Caddy/Nginx/Cloudflare）时链路会被判 malformed 直接 RST，浏览器看到就是 `ERR_HTTP2_PROTOCOL_ERROR`
- 修法：只在 HTTP/1.1 下设置 `Connection: keep-alive`；HTTP/2 下让协议自管

位置：`server/index.cjs` → `app.get('/api/events/subscribe', ...)`

### 2. SSE 响应强制 `Content-Encoding: identity`

- 双保险：哪怕上游代理或中间件误启压缩，这一行会把编码重置为 `identity`
- 与下面 compression filter 组合后，SSE 流绝不会被 gzip/br

### 3. compression 中间件显式排除 SSE

- 旧实现靠"SSE 路由注册在 compression 之前"这一隐式顺序来规避压缩，脆弱
- 新实现给 `compression()` 传 `filter`：
  - 请求头 `Accept: text/event-stream` → 跳过
  - 响应头 `Content-Type: text/event-stream` → 跳过
  - 响应头 `Cache-Control: ...no-transform...` → 跳过
  - 其余走默认 `compression.filter`

位置：`server/index.cjs` 中间件装配段

### 4. 前端 EventSource 指数退避 + 可见性感知

- 旧实现裸用 `new EventSource(...)`，浏览器默认 3s 节奏无限重试，后端挂掉会打满 Network 面板
- 新实现：`onerror` 关闭当前连接，按 1s → 2s → 4s → 8s → 15s → 30s 退避重连
- 标签页隐藏时暂停重连，恢复可见时立即回到 1s 起步
- 心跳由后端 `sseBus.ping()`（25s 间隔）负责维持长连接不被中间盒关闭

位置：`src/App.jsx` 的 SSE `useEffect`

---

## 反代层配置清单（运维侧必须确认）

上面的代码修复在源站解决了协议合规性，但 SSE 真正在边缘能不能推下去，还要看反代不做"多事"的几项：

### Nginx

在 `/api/events/` location 下：

```nginx
location /api/events/ {
    proxy_pass http://wa_crm_v2_upstream;
    proxy_http_version 1.1;           # 与 upstream 走 HTTP/1.1
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;              # 关键：关缓冲，流式下发
    proxy_cache off;                  # 关缓存
    chunked_transfer_encoding off;    # SSE 不走 chunked
    proxy_read_timeout 24h;           # 长连接超时拉高
    proxy_send_timeout 24h;

    # 如果 Nginx 自己也开了 gzip，显式关掉
    gzip off;
}
```

### Caddy v2

```caddyfile
handle /api/events/* {
    reverse_proxy wa_crm_v2_upstream {
        flush_interval -1          # 立即 flush，不缓冲
        transport http {
            versions 1.1           # 与 upstream 走 HTTP/1.1
            read_timeout 24h
            write_timeout 24h
        }
    }
    encode {                       # 站点全局 encode 时也要排除 SSE
        match {
            not path /api/events/*
        }
    }
}
```

### Cloudflare

- SSE 路径**必须绕过**以下功能，否则会整段缓冲或插入中间响应：
  - Auto Minify（HTML/CSS/JS）
  - Rocket Loader
  - Polish / Mirage
  - Cache Rules（SSE 路径 Cache-Control: `no-cache, no-transform`，需 Page Rule 或 Cache Rule 显式 bypass）
  - Workers（若有自定义 Worker，对 SSE 路径早 return）
- 若 zone 是 HTTP/3 (QUIC) on，多数 SSE 场景可用，但在 Workers + HTTP/3 叠加下偶有流异常，排障先关 HTTP/3 复测
- 建议把 SSE 路径挂到 Cloudflare 的 **"Bypass cache"** 规则

### Apache

```apache
<Location "/api/events/">
    ProxyPass           http://upstream/api/events/ flushpackets=on
    ProxyPassReverse    http://upstream/api/events/
    SetEnv no-gzip 1
    Header set Cache-Control "no-cache, no-transform"
    Header unset Connection
</Location>
```

---

## 排障顺序（按从易到难）

1. **直连源站复测**：跳过所有反代，`curl -N -H 'Cookie: <auth>' http://origin:3000/api/events/subscribe`，如能持续收到 `: ping`，说明源站 OK，问题 100% 在反代层
2. **对比 HTTP/1.1 vs HTTP/2**：浏览器 Network 面板看 `/api/events/subscribe` 的 `Protocol` 列
   - 只有 HTTP/2 报错 → 第 1、2、3 节的代码修复 + 反代 HTTP/2 配置
   - HTTP/1.1 也报错 → 反代缓冲/压缩/超时
3. **看响应头**：正常应当有 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Content-Encoding: identity`；若出现 `Content-Encoding: gzip` 或 `Transfer-Encoding: chunked` 就是被中间件/反代改了
4. **看心跳**：curl 直连后每 25s 应见一行 `: ping <ts>`；没有就是源站心跳 interval 被关了
5. **看前端重连频率**：如果前端一直在"1s → 2s → 4s"退避重连，说明连接总是起来几秒就被某一方切断，重点查反代 `read_timeout` / `idle_timeout`

---

## 相关代码指针

| 功能 | 位置 |
|------|------|
| SSE 路由 + 响应头 | `server/index.cjs` → `app.get('/api/events/subscribe', ...)` |
| SSE 广播总线 | `server/events/sseBus.js` |
| 心跳调度 | `server/index.cjs` → `setInterval(() => sseBus.ping(), 25000)` |
| compression filter | `server/index.cjs` → `app.use(_compression({ filter: ... }))` |
| 前端订阅 + 重连退避 | `src/App.jsx` → `// SSE 实时订阅` 注释下的 `useEffect` |

---

## 未来可选加固（本次未做）

- `Last-Event-ID` 断点续传：需要 `sseBus.broadcast` 为每条事件发 `id:` 行 + 后端维护 ring buffer，前端重连时通过 `EventSource` 自动带回最后一个 id；当前广播体量不大，故暂不做
- 多进程水平扩展：`sseBus` 目前是进程内 `Set`，多个 Node 实例之间不共享订阅。若要上横向扩容，可接 Redis pub/sub 作为总线，或走 SSE gateway（如 Mercure）
