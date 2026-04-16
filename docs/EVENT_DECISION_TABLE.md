# Event Decision Table

这张表是事件检测与 OpenAI 二次核对的统一判断口径。

- 轻量检测：`POST /api/events/detect` 用关键词做候选召回。
- 二次核对：`POST /api/events/verify` 或 `POST /api/events/:id/verify` 用 OpenAI 基于 10 条上下文做语义确认。
- 最终标准：没有明确证据时一律返回 `uncertain`，不能靠脑补。

| event_key | event_type | 标签 | 核心正向信号 | 关键负向信号 | 状态指引 |
| --- | --- | --- | --- | --- | --- |
| `trial_7day` | `challenge` | 7天试用 | 达人明确说已开始/已完成 7 天试用；运营确认达人已加入试用 | 仅介绍试用规则；只聊 AI generations 没有参与确认 | `draft`: 仅提及/邀请；`active`: 明确开始；`completed`: 明确完成 |
| `monthly_challenge` | `challenge` | 月度挑战 | 达人确认加入月度挑战；确认月费/执行周期开始 | 只是在讲月度方案和价格 | `draft`: 介绍规则；`active`: 已开始月度执行；`completed`: 周期完成/完成结算 |
| `agency_bound` | `agency` | Agency绑定 | 达人明确同意绑定/签约；运营确认签约完成；达人要签约链接 | 只有规则介绍；达人明确拒绝或犹豫 | `draft`: 仅讨论；`active`: 明确愿意绑定；`completed`: 明确已绑定/签约 |
| `gmv_milestone` | `gmv` | GMV里程碑 | 对话明确提到达到某个 GMV 门槛；运营恭喜达人成交额达标 | 只讨论目标，没有明确达成 | `draft`: 里程碑未确认；`active`: 刚达成待核；`completed`: 明确达成并完成核对 |
| `referral` | `referral` | 推荐 | 明确介绍新达人、发邀请码、确认推荐动作 | 只泛泛提社区或朋友，没有实际推荐 | `draft`: 仅提可能推荐；`active`: 已在推进推荐；`completed`: 推荐已确认完成 |
| `recall_pending` | `followup` | 待召回 | 上下文显示达人此前愿意绑定但未落地，需要重新召回 | 已明确拒绝绑定；已经 agency bound | `draft`: 证据不足；`active`: 确认进入召回池；`completed`: 召回已完成 |
| `second_touch` | `followup` | 二次触达 | 上下文显示达人此前回复少/无明确意愿，现在需要二次触达 | 已明确愿意绑定；已 agency bound | `draft`: 普通跟进；`active`: 确认是二次触达对象；`completed`: 二次触达已得出结论 |

## OpenAI 输出要求

OpenAI 二次核对统一输出：

```json
{
  "verdict": "confirm | reject | uncertain",
  "event_key": "trial_7day",
  "status": "draft | active | completed | cancelled",
  "confidence": 1,
  "reason": "short explanation",
  "evidence_message_ids": [123],
  "evidence_quote": "direct quote",
  "start_at": "YYYY-MM-DD or null",
  "meta": {}
}
```

## 核验原则

1. 只允许基于 10 条上下文消息判断。
2. 没有明确证据就返回 `uncertain`。
3. 必须引用 `evidence_message_ids`。
4. `status` 由对话语义决定，不能硬猜。
5. `source_anchor` 优先使用 `message_id`，其次 `message_hash`，再其次 `timestamp`。
