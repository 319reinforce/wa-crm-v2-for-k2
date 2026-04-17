# Security Changes — 2026-04-17

## 范围

本次是对 2026-04-16 安全修复的补充收口，聚焦审查指出的 audit 脱敏遗漏：

- `client_id` 仍可能把达人手机号写入 `audit_log`
- `record_id` 仍可能以手机号形式原样落库
- `/api/audit-log` 对历史脏数据缺少返回前兜底脱敏

---

## 今日完成

### 1. audit 写入统一递归脱敏
**文件：** `server/middleware/audit.js`

- `sanitizeAuditValue` 改为递归处理嵌套对象和数组
- 新增 `sanitizeAuditRecordId`
- 脱敏字段扩展为：
  - `wa_phone`
  - `phone`
  - `client_id`
  - `record_id`
  - `password`
  - `token`
  - `secret`
- phone-like 的 `record_id` 写入前不再原样落库

### 2. audit-log 返回前兜底脱敏
**文件：** `server/routes/audit.js`

- `GET /api/audit-log` 现在统一走 `sanitizeAuditLogRow`
- 即使数据库里已经存在旧的未脱敏记录，接口返回时也会再次遮罩

### 3. 补充回归测试
**文件：** `tests/auditMiddleware.test.mjs`、`tests/auditRoutes.test.mjs`

- 覆盖递归脱敏 `client_id` / `record_id` / 嵌套手机号字段
- 覆盖 `writeAudit` 对 phone-like `record_id` 的写入前脱敏
- 覆盖 `/api/audit-log` 对历史脏数据的返回前脱敏

### 4. 文档表述校正
**文件：** `docs/SECURITY_CHANGES_2026-04-16.md`、`docs/SECURITY_CHANGES_20260416.md`

- 将 “linter” 相关表述改成更准确的“顺带完成的清理项”
- 明确当前仓库没有单独的正式 `lint` 命令
- 同步更新 audit 脱敏描述与测试覆盖范围

### 5. 文档状态统一（2026-04-17）
**文件：** `docs/SECURITY_FIX_PLAN.md`、`docs/SECURITY_FIX_REPORT.md`、`SECURITY_FIX_REPORT.md`、`.claude/memory/security-fixes-2026-04-14.md`

- `docs/SECURITY_FIX_PLAN.md` 已更新为当前真实状态：P0/P1 全部完成，P2 仅剩 `P2-2 / P2-3 / P2-5 / P2-6`
- `docs/SECURITY_FIX_REPORT.md` 已重写为最新摘要报告
- 根目录 `SECURITY_FIX_REPORT.md` 改为兼容入口，避免与 `docs/` 下 canonical 报告继续漂移
- memory handoff 已更新为跨 `2026-04-14` 到 `2026-04-17` 的连续状态摘要

---

## 今日涉及文件

- `server/middleware/audit.js`
- `server/routes/audit.js`
- `tests/auditMiddleware.test.mjs`
- `tests/auditRoutes.test.mjs`
- `docs/SECURITY_CHANGES_2026-04-16.md`
- `docs/SECURITY_CHANGES_20260416.md`
- `docs/SECURITY_FIX_PLAN.md`
- `docs/SECURITY_FIX_REPORT.md`
- `SECURITY_FIX_REPORT.md`
- `.claude/memory/security-fixes-2026-04-14.md`

---

## 验证结果

### `npm run test:unit`

- `114/114` passed

### `npm test`

- `SMOKE: PASSED`
- 包含：
  - backend syntax check
  - `vite build`
  - unit tests
- 仍按环境开关跳过：
  - API integration smoke
  - UI acceptance smoke
  - WA send smoke

---

## 下一步修复方案

### 1. 做一次历史泄露扫描

检查 `audit_log` 里已经落盘的旧数据，重点扫：

- `record_id` 是否仍有手机号
- `before_value` / `after_value` 中是否仍有 `client_id`、`wa_phone`、`phone`
- 是否存在其他同义字段，如 `creator_phone`、`account_phone`、`phone_number`

### 2. 决定历史数据处置策略

如果线上/测试库里已存在泄露记录，建议二选一：

1. 直接做一次 SQL 脱敏回填
2. 先限制 `audit-log` 可见范围，再补离线清洗

### 3. 扩大安全扫面范围

继续检查不是 `audit-log` 但同样会返回达人标识的诊断接口，例如：

- generation log detail
- retrieval snapshot detail
- 其他调试 / 导出接口

目标是区分“业务必须返回”与“只用于排障但不该直接暴露”的字段。

### 4. 明确 lint 策略

当前仓库只有 syntax/build/test，没有正式 `lint` 脚本。后续建议二选一：

1. 正式补 `npm run lint`
2. 继续不引入 lint，但所有文档统一写成 `Syntax check + build + tests`

### 5. 最后做一次真实 API 级回归

在有测试数据的环境里补一轮实际请求验证：

- 写入一条含手机号的 audit 事件
- 通过 `/api/audit-log` 读取
- 确认写入值和返回值都已经被遮罩

---

## 当前结论

2026-04-17 这次补修已经把“只脱敏顶层字段”的漏洞收口为：

- 写入前脱敏
- 返回前兜底脱敏
- 回归测试覆盖
- 文档表述对齐

下一步重点不在继续改代码，而在于确认历史库里有没有需要一次性清洗的旧记录。

补充后的当前代码 + 文档一致状态为：

- P0：全部完成
- P1：全部完成
- P2：P2-1 / P2-4 / P2-7 已完成
- Remaining：P2-2 / P2-3 / P2-5 / P2-6
