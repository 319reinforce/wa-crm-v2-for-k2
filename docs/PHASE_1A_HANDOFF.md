# Phase 1a 交接简报 — `requireAdminOnly` middleware

> 给新 Claude Code session（工作目录 `/Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr`）的自包含任务说明。
> 只做 **Phase 1a**，不涉及 Phase 1b/1c/1d/2/3/4 的任何代码。
> 严格 TDD，不允许跳过测试直接写实现。

---

## 0. 必读

进入本项目前按顺序读：

1. `CLAUDE.md`（根）— 项目入口
2. `.claude/CLAUDE.md` — Agent 编排规则（本次你是 orchestrator + backend-agent 合一）
3. `docs/WA_SESSIONS_DESIGN.md` — 特别关注 §2（D7/D9）、§3.3、§6.1、§9、§13
4. `docs/WA_SESSIONS_DESIGN_REVIEW.md` — 特别关注 CRITICAL-2、HIGH-1
5. 被改动的文件：`server/middleware/appAuth.js`

读完这些材料后，确保能回答以下三个问题，再动手：

- 什么是 "admin role"？它和 "not owner-locked" 有什么区别？
- `role: 'service'` 的 token 应该能调 `DELETE /api/wa/sessions/:sid/auth` 吗？为什么？
- `requireAdminOnly` 和 `requireAppAuth` 的调用顺序是什么？哪个先挂？

---

## 1. 任务 Scope（只做这些，不多不少）

### 1.1 代码改动

**文件 1：`server/middleware/appAuth.js`**

新增并导出一个 middleware 函数：

```js
/**
 * Gate for destructive admin-only endpoints.
 *
 * Requires that requireAppAuth has already populated req.auth.
 * Rejects with 403 if req.auth.role !== 'admin'.
 *
 * Must be mounted AFTER requireAppAuth in the route chain:
 *   router.delete('/sessions/:sid/auth', requireAppAuth, requireAdminOnly, handler)
 */
function requireAdminOnly(req, res, next) {
  if (req.auth?.role === 'admin') return next();
  return res.status(403).json({
    ok: false,
    error: 'Forbidden: admin role required',
  });
}

module.exports = {
  // ... existing exports
  requireAdminOnly,
};
```

**禁止做的事**：

- ❌ 不要改动 `requireAppAuth` 现有行为
- ❌ 不要改动 `buildTokenEntries`、`buildAuthContext`、`extractToken` 等任何现有函数
- ❌ 不要在本次提交里挂载这个 middleware 到任何路由（那是 Phase 1d 的事）
- ❌ 不要做性能优化、重构、console.log 清理等"顺手改"

### 1.2 测试

**文件 2：`tests/api/requireAdminOnly.test.mjs`**（新建，用 `node --test`）

覆盖以下场景（最少 6 个 test case）：

| 场景 | 输入 `req.auth` | 期望 |
|---|---|---|
| admin role 放行 | `{ role: 'admin', token: 'x', owner: null }` | `next()` 被调用一次，`res.status` 未被调 |
| owner role 拒绝 | `{ role: 'owner', owner: 'Beau' }` | 403 + body 含 `'admin role required'` |
| service role 拒绝 | `{ role: 'service' }` | 403（这是 HIGH-1 的核心修复点） |
| 无 auth（未经 requireAppAuth） | `req.auth === undefined` | 403，不崩溃 |
| `req.auth` 为 null | `req.auth === null` | 403，不崩溃 |
| role 不是已知值 | `{ role: 'something_else' }` | 403 |

**硬性要求**：

- 用 `node --test` 和 `node:assert`，不引入 Vitest / Jest
- mock `req` 用字面量；mock `res` 用 `{ status: mock.fn(...), json: mock.fn(...) }`
- mock `next` 用 `mock.fn()`
- 测试文件 < 150 行
- 每个 case 独立 `test(...)` 块，不共享 state

---

## 2. TDD 执行顺序（严格）

1. **先写测试文件**：`tests/api/requireAdminOnly.test.mjs`
2. **运行测试**：`node --test tests/api/requireAdminOnly.test.mjs`
3. **确认 6 个 case 都 FAIL**（因为 `requireAdminOnly` 还不存在，import 会报错）
   - 如果任何 case 意外 PASS，停下来检查 — 多半是 mock 有 bug
4. **实现 `requireAdminOnly`**：在 `appAuth.js` 里加函数 + 加到 `module.exports`
5. **再跑测试**：`node --test tests/api/requireAdminOnly.test.mjs`
6. **确认 6 个 case 都 PASS**
7. **回归检查**：跑项目现有测试，确认没破坏
   ```bash
   npm run test:unit
   npm run test:api:lifecycle   # 如果原本能跑
   ```

如果任何现有测试挂了，**停下来**，查 `appAuth.js` 的其它导出是否被误改。

---

## 3. 验收标准

- [ ] `tests/api/requireAdminOnly.test.mjs` 6 个 case 全 PASS
- [ ] `server/middleware/appAuth.js` diff 只有两处：新增函数 + `module.exports` 里加一个 key
- [ ] `git diff --stat` 显示只有这 2 个文件变化（零歧义）
- [ ] 无 `console.log` / `console.debug`
- [ ] `git diff server/middleware/appAuth.js` 现有函数一行不变
- [ ] Grep 验证：`rg "requireAdminOnly" server/` 只出现在 `appAuth.js` 里（因为还没有路由挂）

---

## 4. 提交规范

按 `k2lab-git-commit` skill。

**分支**：
```
feat/wa-sessions-p1a-require-admin-only
```

**commit message**（准确格式见 skill）：
```
feat: add requireAdminOnly middleware for admin-gated endpoints

Adds a role-based auth gate that restricts routes to tokens whose
req.auth.role === 'admin'. Rejects owner-locked and service-role
tokens with 403, closing CRITICAL-2 and HIGH-1 from the WA Sessions
design review.

Not wired to any route yet — that is Phase 1d.

Refs: docs/WA_SESSIONS_DESIGN.md §2 D9, §3.3, §6.1
      docs/WA_SESSIONS_DESIGN_REVIEW.md CRITICAL-2, HIGH-1
```

**MR 描述**（Gitea）：

- Summary：照 commit message 前三行
- Test plan：粘贴 `node --test tests/api/requireAdminOnly.test.mjs` 输出的 6 PASS
- Scope：明确列出"只改两个文件"
- 不要 touch 其它 Phase 的文件

---

## 5. 禁止扩张 scope

如果在读代码时发现以下"顺手能改"的问题，**全部记下不要动**，留给对应 Phase 或单独 issue：

| 发现 | 记到哪 |
|---|---|
| `appAuth.js` 的某个其它函数有小 bug | 开 issue，不在本 PR 修 |
| 有路由该挂 `requireAdminOnly` 但没挂 | Phase 1d |
| `waService.js` 需要 `restartClient` | Phase 1b |
| compose 该改 | Phase 4 运维 |
| 任何前端代码 | Phase 2 |
| 现有测试覆盖率低 | 另一个 issue |

scope 膨胀会让这个最小改动失去 "低风险、快速收尾" 的特性。

---

## 6. 环境与启动

```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
git checkout main
git pull origin main
git checkout -b feat/wa-sessions-p1a-require-admin-only

# 确认项目能跑测试
node --version     # 需要 ≥ 18
ls tests/          # 确认 tests/api 目录存在或需要创建

# 开始 TDD
# 1) 先写测试
#    code tests/api/requireAdminOnly.test.mjs
# 2) 跑测试 看到 FAIL
# 3) 改 server/middleware/appAuth.js
# 4) 跑测试 看到 PASS
# 5) 回归 npm run test:unit
# 6) 提交 + push + MR
```

---

## 7. 完成后

1. 在 MR 里 @ 运维 reviewer
2. 回到 orchestrator session 汇报：
   - MR 链接
   - 测试输出
   - `git diff --stat` 结果
3. **不要自动进入 Phase 1b**，等 MR 合入后由运维或 orchestrator 启动下一阶段

---

## 8. 卡住怎么办

- 测试 mock `res.status().json()` 链式调用不好写 → 看 `tests/api/` 下现有文件（如 `test-strategy-config-api.cjs`）有没有参考
- `appAuth.js` 里的 auth context 字段名有歧义 → 以代码为准（`req.auth.role`、`req.auth.owner`、`req.auth.token_key`），不要凭设计文档猜
- 有测试意外 PASS（应该 FAIL 的阶段）→ 多半是 mock 出了 bug，不要往下走
- 遇到任何 CLAUDE.md / Review 文档没覆盖的决策 → 停下来，在 MR 里 @orchestrator 问，不要自行决定

---

## 9. 参考 checklist（给 reviewer）

```
[ ] 仅改两个文件（appAuth.js + 新 test file）
[ ] requireAdminOnly 签名匹配 §1.1 契约
[ ] 6 个测试 case 全部覆盖到
[ ] 所有测试 PASS
[ ] 现有测试不回归
[ ] commit message 符合规范
[ ] 不挂载到任何路由
[ ] 不 touch 任何前端 / crawler / 路由文件
```
