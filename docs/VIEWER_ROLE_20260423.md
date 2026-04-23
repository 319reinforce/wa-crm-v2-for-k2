# Viewer Role — 并发岗角色接入（2026-04-23）

## 背景

业务场景：**主管 + 自己团队实操**。主管需要能旁观多个 owner（Beau / Yiyun / Jiawen …）的聊天，判断团队是否合规；但主管本身也绑定一个 owner，只能向自己名下的达人发送消息。

原有角色只有两档：`admin`（全权）/ `operator`（锁死自己 owner，读写都只限自己）。不足以支持上述场景——如果给主管 admin，他能跨 owner 发消息，权限过大；如果给 operator，他看不到其他 owner 的数据，无法判断合规。

新增第三档：`viewer`（并发查看者）。

## 三角色对比

| 角色 | 读范围 | 写范围 | owner 绑定 |
|---|---|---|---|
| admin | 全部 | 全部 | 无 |
| operator | 自己 owner | 自己 owner | 必填 |
| **viewer** | **全部（跨 owner）** | **自己 owner** | **必填** |

## 核心设计：方法感知的 owner 锁

把"owner 锁"拆分成**读锁**与**写锁**两维，通过 HTTP 方法感知（`GET/HEAD/OPTIONS` vs 其他）区分。

### 关键抽象

`server/middleware/appAuth.js::getLockedOwner(req)` —— 所有 route 已经在用的"当前请求受限于哪个 owner"单点函数：

```js
function getLockedOwner(req) {
    const owner = normalizeOperatorName(req?.auth?.owner, null);
    if (!owner) return null;
    const role = String(req?.auth?.role || '').toLowerCase();
    // viewer 在读方法上返回 null（放行跨 owner 读）
    if (role === 'viewer' && isSafeMethod(req)) return null;
    return owner;
}
```

配套辅助：

- `getWriteLockedOwner(req)` — 始终返回 owner（无论方法），用于 session_id lookup 等"始终按写锁算"的场景
- `isSafeMethod(req)` — HTTP 方法判断

### 副产物：buildAuthContext 分拆出两个 lock flag

```js
owner_locked_read: !!owner && role !== 'viewer' && role !== 'admin',
owner_locked_write: !!owner && (role === 'operator' || role === 'viewer' || role === 'owner'),
owner_locked: readOwnerLocked || writeOwnerLocked,  // 兼容已有消费方
```

前端 `/api/auth/session` 响应用 `owner_locked_read` 决定是否锁 UI filter —— viewer 读不锁，所以 UI 允许切换 filter 到任意 owner 浏览。

## 为什么不用"逐路由加守卫"

项目后端已经统一使用 `getLockedOwner(req)` + `matchesOwnerScope(req, owner)` 作为 owner 过滤/访问控制的单点接口，分布在几十处 route handler 里。

如果为 viewer 单独加 `requireNonViewer` 守卫或 per-route 判断：
- 每条新 route 都得想起来加守卫（容易漏）
- 改动面巨大，review 成本高

改 `getLockedOwner` 内部一行语义——让它 HTTP 方法感知——**所有现有 route 都自动适配新语义**，零侵入。

## 变更清单

| 层 | 文件 | 关键改动 |
|---|---|---|
| schema | `schema.sql:787` | role ENUM 增加 `'viewer'` |
| 中间件 | `server/middleware/appAuth.js` | `entryFromDbSession`：viewer 绑 owner；`buildAuthContext`：拆 read/write 两锁；`getLockedOwner`：方法感知；导出新增 `getWriteLockedOwner` / `isSafeMethod` |
| Login 路由 | `server/index.cjs` | `/api/auth/login`：viewer 返回 owner=operator_name + owner_locked=false；`/api/auth/session`：改用 `owner_locked_read` |
| 用户 CRUD | `server/routes/users.js` | 接受 `'viewer'`；viewer 必填 `operator_name` |
| 前端 helper | `src/utils/appAuth.js` | 新增 `isAppAuthViewer()` + `canAppAuthWriteToOwner(targetOwner)` |
| 管理面板 | `src/components/UsersPanel.jsx` | 角色下拉加「并发查看者」；Owner 列对 viewer 可编辑 |
| 聊天 UI | `src/components/WAMessageComposer.jsx` | 按 `creator.wa_owner === viewerOwnOwner` 动态启/禁发送、图片、AI 生成；跨 owner 访问时显示黄色只读横幅 |

## 部署

schema.sql 是源定义，运行库需手动 ALTER：

```sql
ALTER TABLE users MODIFY COLUMN role ENUM('admin','operator','viewer') NOT NULL;
```

## PR

- 分支：`feat/viewer-role`
- 主仓（Gitea）：https://git.k2lab.ai/K2Lab/whatsapp-mgr/compare/main...feat/viewer-role
- 镜像（github）：同名 branch 已推送，但 github/main 与本地历史脱钩无法直接 PR
- 基于：`df7959e`（LLM admin config PR #39 合并后的 main 邻近 commit）

## 测试计划

- [ ] admin 登录 → 用户管理 → 创建 viewer（绑定 Beau）
- [ ] viewer 登录，默认 filter 显示 Beau 的 creators，可切换到 Yiyun
- [ ] 切到 Yiyun 达人聊天：消息可见，输入区出现黄色横幅，发送/图片/AI 按钮灰掉
- [ ] 切回 Beau 达人：按钮恢复，正常发送
- [ ] curl `POST /api/wa/send` 到 Yiyun 达人（viewer token）：期望 403
- [ ] curl `GET /api/creators?owner=Yiyun` (viewer token)：期望 200 + Yiyun 的列表
- [ ] `GET /api/users` (viewer token)：期望 403（admin-only）

## 设计复盘

### 一次返工

首次实现把 viewer 设计成"完全只读、全局可见"——在 `requireAppAuth` 里硬拦所有写方法、owner 设为 null。用户纠正：viewer 实际是"绑 owner + 跨 owner 读 + 只写自己 owner"，像并发岗主管。

返工后所有之前的改动被还原，用方法感知的 owner 锁重新实现。教训：需求的粒度要问清楚"读写范围是否独立"这类维度，不要默认「只读 = 全局」。

### `hasPrivilegedRole` 没动

`server/utils/ownerScope.js::hasPrivilegedRole` 仍只含 admin/service。`profileAnalysis.js` 和 `trainingWorker.js` 的 service-or-admin 钩子不放行 viewer —— 符合预期（这些是系统内触发，viewer 无权）。写操作本身已经由 `getLockedOwner` 的 method-aware 分流处理。

### `shouldExposeCreatorListPhone` 没动

viewer 在列表中看不到 `wa_phone`（和 operator 一致）。理由：operator 本来也看不到，viewer 是 operator + 跨 owner 读，隐私维度不做额外放开，保持最小差异。
