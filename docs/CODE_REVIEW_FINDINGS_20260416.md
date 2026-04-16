# WA CRM v2 代码复核落档

> 复核时间：2026-04-16
> 复核范围：本轮用户提交的 5 条 review finding，按当前代码重新验证
> 备注：本次按用户要求忽略鉴权类问题，聚焦当前实现中仍然成立的数据完整性、误删和破坏性验证风险

---

## 结论速览

| 状态 | 等级 | 问题 | 结论 |
|------|------|------|------|
| Confirmed | P1 | `replace-contact` 会删除超出原始抓取切片之外的有效历史 | 成立 |
| Confirmed | P1 | `reconcile` 会把合法的重复短消息当成污染数据删除 | 成立 |
| Confirmed | P1 | group-pollution 清理范围过宽，可能误删无关 1:1 消息 | 成立 |
| Confirmed | P2 | API smoke 在开启 API IT 时默认执行破坏性清理 | 成立 |
| Stale / Resolved | P2 | `/api/stats` 暴露全局 reply-hit rate | 当前代码已修复，不再成立 |

---

## Confirmed Findings

### 1. [P1] `replace-contact` 会删除超出抓取切片之外的有效消息

**状态更新（2026-04-16 working tree）**

- 该问题已在当前工作区修复
- `replaceCreatorMessagesFromRaw()` 现在默认要求 raw slice 未触达 fetch limit，才允许窗口替换
- 只有显式 override 时才允许带风险的 partial window replace

**影响文件**

- `server/services/waMessageRepairService.js`
- `server/waCrawler.cjs`

**复核时的证据**

- `replaceCreatorMessagesFromRaw()` 先用抓回来的最老/最新 raw message 计算一个带 padding 的删除窗口，然后按整个窗口删 CRM 消息，见 `server/services/waMessageRepairService.js:452-480`
- 删除完成后，只把本次抓取到的 `normalizedRaw` 重插回去，见 `server/services/waMessageRepairService.js:483-495`
- 但 `audit_recent_messages` 的原始抓取本身是受 `limit` 限制的，默认就是 `120` 条，见 `server/waCrawler.cjs:308-350` 与 `server/waCrawler.cjs:429-435`

**实际风险**

如果某个联系人在该时间窗内的真实消息数量大于 crawler 返回的切片上限，那么落在删除窗口里、但没有出现在这次 raw slice 里的有效消息会被静默抹掉。

**已执行修复**

- 已给 `replaceCreatorMessagesFromRaw()` 增加 raw slice 完整性门槛
- 已把 `waSessionRouter.replaceRoutedContact()` 改成默认拒绝不安全窗口替换，只在显式 `force` 时 override
- 已补回归测试，锁住默认安全行为

### 2. [P1] `reconcile` 会把合法重复消息压成删除

**状态更新（2026-04-16 working tree）**

- 该问题已在当前工作区修复
- `reconcile` 现在只删除和 raw/effective row 精确重合的重复项，不再按 2 分钟近邻做广义删除

**影响文件**

- `server/services/waMessageRepairService.js`

**复核时的证据**

- `reconcileCreatorMessagesFromRaw()` 对每条未匹配上的 existing row，只要存在任意一条 effective raw row 满足“归一化文本相同且时间差不超过 2 分钟”，就把该 existing row 放进删除列表，见 `server/services/waMessageRepairService.js:246-259`
- 这个判断没有要求一一配对，也没有验证重复次数是否一致

**实际风险**

像 `ok`、`thanks`、`done` 这类短消息在 2 分钟内出现两次是完全可能的。当前实现只要其中一条被 raw slice 支撑，另一条合法重复也可能被误判成污染并删除。

**已执行修复**

- 已把删除条件从“2 分钟内存在近邻”收紧为“精确 support key 重合”
- 已补回归测试，验证合法重复消息不会再被误删

### 3. [P1] group-pollution 清理指纹过粗且作用域过宽

**状态更新（2026-04-16 working tree）**

- 该问题已在当前工作区修复
- direct/group 冲突判定已切到 role + normalized text + exact timestamp 的精确 key
- 当 `sessionId` 和 `operator` 同时存在时，作用域已从 `OR` 收紧为 `AND`

**影响文件**

- `server/services/groupMessageService.js`

**复核时的证据**

- direct/group 冲突键只由 `normalized_text + second` 组成，不包含 role、author、chat_id 等更强区分信息，见 `server/services/groupMessageService.js:31-35`
- direct message 与 group message 的污染判定作用域是 `(same session) OR (same operator)`，见 `server/services/groupMessageService.js:251-272` 与 `server/services/groupMessageService.js:316-335`
- 命中后会直接删掉匹配 fingerprint 的 CRM 消息，见 `server/services/groupMessageService.js:339-349`

**实际风险**

同一个 operator 下，某个群聊消息和某个无关 1:1 会话如果在同一秒出现相同短文本，当前逻辑就可能把 1:1 消息当成群污染误删。

**已执行修复**

- 已把污染判定从粗 fingerprint 收紧为精确 conflict key
- 已把核心过滤/清理逻辑改为基于原始 `role/text/timestamp` 精确匹配，而不是依赖旧 fingerprint
- 已补回归测试，并在真实 smoke 中验证 `group_overlap_matches = 0`

### 4. [P2] API smoke 在开启 API 集成测试时默认会改写真实消息数据

**状态更新（2026-04-16 working tree）**

- 该问题已在当前工作区修复
- `scripts/test-smoke.cjs` 现在默认跳过 purge，只有显式 `SMOKE_PURGE_GROUP_POLLUTION=1` 才会执行
- `scripts/purge-group-pollution.cjs` 本身也新增了显式确认门槛，避免被直接误跑

**影响文件**

- `scripts/test-smoke.cjs`
- `scripts/purge-group-pollution.cjs`

**复核时的证据**

- 当 `SMOKE_INCLUDE_API_IT=1` 时，smoke runner 默认把 `SMOKE_PURGE_GROUP_POLLUTION !== '0'` 视为真，并执行 `npm run test:data:group-pollution:purge`，见 `scripts/test-smoke.cjs:81-100`
- `scripts/purge-group-pollution.cjs` 不是只读校验，它会遍历 `wa_messages` 的 `(creator_id, operator)` 组合，并调用 `purgeCreatorMessagesMatchingGroups()` 执行真实删除，见 `scripts/purge-group-pollution.cjs:29-66`

**实际风险**

这意味着“打开 API IT 做验收”并不等价于只读验证。只要没有额外显式关闭，测试本身就会修改生产样式数据。

**本次复核观测**

- 本轮 review run 中，该 purge 步骤报告过 `purged_total: 23`
- 该观测值说明问题不是理论风险，而是已经发生过实际删除
- 当前仓库内未保留该次运行产物，因此这个数字应视为本次复核时的运行观测记录

**已执行修复**

- 已把 destructive purge 从 `test-smoke.cjs` 默认路径移除，改成显式 `SMOKE_PURGE_GROUP_POLLUTION=1` 才执行
- 已给 `scripts/purge-group-pollution.cjs` 增加确认门槛，避免直接误跑
- 已补回归测试，锁住默认只读行为

---

## Stale / Resolved Finding

### 5. [P2] `/api/stats` 暴露全局 `generation_reply_hit_rate` 已不再成立

**影响文件**

- `server/routes/stats.js`

**为什么当前代码里已经修复**

- `GET /api/stats` 现在单独构造了 `scopeWhereSft`，见 `server/routes/stats.js:36-39`
- `sft_memory` 的 reply-hit-rate 查询已把这个 owner scope 条件带进来，见 `server/routes/stats.js:119-129`

**结论**

这一条如果继续保留为“当前未修复问题”，会误导后续排查方向。更准确的状态应该是：该 finding 对旧版本成立，但对本次复核时的代码已经失效。

---

## 交叉结论

### 1. 当前高风险点集中在 `wa_messages` 的破坏性整理链路

本轮确认仍然成立的 4 条里，有 3 条直接会删除 `wa_messages`，分别来自：

- repair 的 `replace`
- repair 的 `reconcile`
- group-pollution purge

这说明问题不是孤立 bug，而是同一类“在证据不足时仍执行 destructive cleanup”的实现模式。

### 2. 当前 smoke / 验收链路不是天然只读

只要开启 `SMOKE_INCLUDE_API_IT=1`，默认路径就会调用真实 purge。后续所有“在生产样式环境做验收”的动作，都应先确认是否存在类似写库步骤。

---

## 建议优先级

1. 先把 `scripts/test-smoke.cjs` 改成默认只读，停止验证流程继续改写真实数据。
2. 再收紧 `groupMessageService` 的 fingerprint 与 scope，避免继续扩大误删面。
3. 最后重写 `waMessageRepairService` 的 `replace` 与 `reconcile` 策略，把“覆盖完整性证明”做成删除前置条件。
