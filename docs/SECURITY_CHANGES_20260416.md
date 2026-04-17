# Security Changes — 2026-04-16 (Compatibility Entry)

此文件保留给旧链接和旧会话引用使用。

当前 canonical 变更记录：

- `docs/SECURITY_CHANGES_2026-04-16.md`

截至 2026-04-17 的真实状态已同步为：

- P0：全部完成
- P1：全部完成
- P2：P2-1 / P2-4 / P2-7 已完成
- 剩余项：P2-2 / P2-3 / P2-5 / P2-6

最新验证结果：

- `npm test` => `114/114` passed
- `[SMOKE] PASSED`
- 默认仍跳过 API integration smoke、UI acceptance smoke、WA send smoke

补充说明：

- SSE/EventSource 当前通过同源 `httpOnly` cookie 复用认证态，不再依赖 query token
- 本地开发只有在 `.env` 显式设置 `LOCAL_API_AUTH_BYPASS=true` 时才允许 localhost 无 token 访问
- 服务间调用必须使用专用 `INTERNAL_SERVICE_TOKEN`，不能复用 admin token

详细内容请查看：

- `docs/SECURITY_FIX_PLAN.md`
- `docs/SECURITY_CHANGES_2026-04-17.md`
