#!/usr/bin/env python3
"""Convert the May creator outreach DOCX into a structured Markdown SOP source."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document


DEFAULT_SOURCE = Path("/Users/depp/Downloads/达人建联各SOP话述(5月版) (1).docx")
DEFAULT_OUTPUT = Path("docs/rag/sources/sop-creator-outreach-may-2026-v1.md")


SECTION_META = {
    "首次建联D": {
        "topic_group": "outreach_contact",
        "intent_key": "first_outreach_fixed",
        "scene_keys": "first_contact",
        "template_kind": "outreach",
        "priority": 1,
        "sendable": True,
        "review_note": "Normalized stale April wording to May and aligned the bonus line with the May $100 challenge policy.",
    },
    "打招呼": {
        "topic_group": "signup_onboarding",
        "intent_key": "username_followup",
        "scene_keys": "trial_intro, follow_up",
        "template_kind": "onboarding",
        "priority": 1,
        "sendable": True,
    },
    "需要介绍Moras的话术": {
        "topic_group": "product_mechanics",
        "intent_key": "how_moras_works",
        "scene_keys": "content_request, general",
        "template_kind": "faq",
        "priority": 1,
        "sendable": True,
    },
    "案例+数据": {
        "topic_group": "product_mechanics",
        "intent_key": "case_data_reference",
        "scene_keys": "content_request, gmv_inquiry, general",
        "template_kind": "reference",
        "priority": 5,
        "sendable": False,
        "is_reference": True,
        "review_note": "Contains performance claims and external profile links; use only after policy review.",
    },
    "规则+MCN机制（文字版/图片版）": {
        "topic_group": "settlement_pricing",
        "intent_key": "may_policy_overview",
        "scene_keys": "monthly_inquiry, mcn_binding, payment_issue",
        "template_kind": "policy",
        "priority": 1,
        "sendable": True,
    },
    "如何结算&支付": {
        "topic_group": "settlement_pricing",
        "intent_key": "weekly_settlement",
        "scene_keys": "payment_issue, monthly_inquiry",
        "template_kind": "payment",
        "priority": 1,
        "sendable": True,
    },
    "发布数量+产品tips": {
        "topic_group": "content_strategy",
        "intent_key": "posting_cadence",
        "scene_keys": "content_request, follow_up",
        "template_kind": "strategy",
        "priority": 1,
        "sendable": True,
    },
    "MCN确认/怎么绑我们的MCN": {
        "topic_group": "mcn_partnership",
        "intent_key": "mcn_explain",
        "scene_keys": "mcn_binding",
        "template_kind": "mcn",
        "priority": 1,
        "sendable": True,
    },
    "开启广告授权": {
        "topic_group": "content_strategy",
        "intent_key": "ad_authorization",
        "scene_keys": "content_request, follow_up",
        "template_kind": "strategy",
        "priority": 2,
        "sendable": True,
    },
    "7-14天体验到期前跟进绑定": {
        "topic_group": "mcn_partnership",
        "intent_key": "mcn_hesitation",
        "scene_keys": "mcn_binding, follow_up",
        "template_kind": "mcn",
        "priority": 1,
        "sendable": True,
    },
    "银行可所需达人信息": {
        "topic_group": "settlement_pricing",
        "intent_key": "payment_method",
        "scene_keys": "payment_issue",
        "template_kind": "payment",
        "priority": 2,
        "sendable": True,
    },
    "教达人怎么看佣金明细表": {
        "topic_group": "settlement_pricing",
        "intent_key": "weekly_settlement",
        "scene_keys": "payment_issue",
        "template_kind": "payment",
        "priority": 2,
        "sendable": True,
    },
    "发布要求与排他条款（Posting requirements & exclusivity）": {
        "topic_group": "mcn_partnership",
        "intent_key": "self_run_vs_full_service",
        "scene_keys": "mcn_binding, general",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "怎么算有效，最低要求，是否排他": {
        "topic_group": "settlement_pricing",
        "intent_key": "qualified_video_rule",
        "scene_keys": "payment_issue, content_request",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "违规后二次安抚": {
        "topic_group": "violation_risk_control",
        "intent_key": "violation_reassurance",
        "scene_keys": "violation_appeal",
        "template_kind": "appeal",
        "priority": 3,
        "sendable": True,
    },
    "有效视频与选品权限 FAQ": {
        "topic_group": "product_mechanics",
        "intent_key": "qualified_video_rule",
        "scene_keys": "payment_issue, content_request",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "老用户费用调整说明": {
        "topic_group": "settlement_pricing",
        "intent_key": "subsidy_explain",
        "scene_keys": "gmv_inquiry, payment_issue",
        "template_kind": "payment",
        "priority": 4,
        "sendable": False,
        "is_reference": True,
        "review_note": "Contains older reward-adjustment language and should not be sent until policy-reviewed.",
    },
    "老用户 Loyal Tier 旧版说明": {
        "topic_group": "settlement_pricing",
        "intent_key": "subsidy_explain",
        "scene_keys": "gmv_inquiry, payment_issue",
        "template_kind": "payment",
        "priority": 5,
        "sendable": False,
        "is_reference": True,
        "review_note": "Contains March 16 wording and legacy compensation terms; retained as reference only.",
    },
    "针对2000美金以上达人": {
        "topic_group": "settlement_pricing",
        "intent_key": "subsidy_explain",
        "scene_keys": "gmv_inquiry, payment_issue",
        "template_kind": "payment",
        "priority": 3,
        "sendable": True,
        "review_note": "Contains tiered incentive language; confirm with operator before use.",
    },
    "如何发布视频/能否给使用指导": {
        "topic_group": "signup_onboarding",
        "intent_key": "registered_not_posted",
        "scene_keys": "trial_intro, content_request",
        "template_kind": "onboarding",
        "priority": 2,
        "sendable": True,
    },
    "登陆不上了": {
        "topic_group": "signup_onboarding",
        "intent_key": "username_followup",
        "scene_keys": "trial_intro, video_not_loading",
        "template_kind": "support",
        "priority": 2,
        "sendable": True,
    },
    "产品列表推荐的逻辑是什么": {
        "topic_group": "product_mechanics",
        "intent_key": "product_logic",
        "scene_keys": "content_request",
        "template_kind": "faq",
        "priority": 1,
        "sendable": True,
    },
    "选品类目与受众匹配（What products you promote）": {
        "topic_group": "content_strategy",
        "intent_key": "product_selection",
        "scene_keys": "content_request, gmv_inquiry",
        "template_kind": "strategy",
        "priority": 1,
        "sendable": True,
    },
    "内容版权与使用权（Ownership & rights）": {
        "topic_group": "product_mechanics",
        "intent_key": "creator_control",
        "scene_keys": "content_request, general",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "是否有发布视频的限制": {
        "topic_group": "content_strategy",
        "intent_key": "posting_cadence",
        "scene_keys": "content_request",
        "template_kind": "strategy",
        "priority": 1,
        "sendable": True,
    },
    "分不同的时间段来发": {
        "topic_group": "content_strategy",
        "intent_key": "posting_cadence",
        "scene_keys": "content_request, follow_up",
        "template_kind": "strategy",
        "priority": 2,
        "sendable": True,
    },
    "链接没有的回复：": {
        "topic_group": "content_strategy",
        "intent_key": "product_selection",
        "scene_keys": "content_request",
        "template_kind": "support",
        "priority": 2,
        "sendable": True,
    },
    "能不能自己修改脚本": {
        "topic_group": "product_mechanics",
        "intent_key": "manual_editing_request",
        "scene_keys": "content_request",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "如何知道自己视频是否符合条件": {
        "topic_group": "product_mechanics",
        "intent_key": "qualified_video_rule",
        "scene_keys": "payment_issue, content_request",
        "template_kind": "faq",
        "priority": 2,
        "sendable": True,
    },
    "视频违规（商品问题）": {
        "topic_group": "violation_risk_control",
        "intent_key": "violation_reassurance",
        "scene_keys": "violation_appeal",
        "template_kind": "appeal",
        "priority": 1,
        "sendable": True,
    },
    "是否支持西班牙语": {
        "topic_group": "product_mechanics",
        "intent_key": "language_support",
        "scene_keys": "general, follow_up",
        "template_kind": "support",
        "priority": 3,
        "sendable": True,
    },
    "会偶尔发，自己账号有自己的风格": {
        "topic_group": "content_strategy",
        "intent_key": "audience_fit",
        "scene_keys": "content_request, follow_up",
        "template_kind": "strategy",
        "priority": 2,
        "sendable": True,
    },
    "达人的视频在投广告无法删除或隐藏": {
        "topic_group": "violation_risk_control",
        "intent_key": "risk_precheck",
        "scene_keys": "violation_appeal, content_request",
        "template_kind": "risk_reminder",
        "priority": 2,
        "sendable": True,
    },
    "那我的账号会有违规的风险吗？": {
        "topic_group": "violation_risk_control",
        "intent_key": "violation_reassurance",
        "scene_keys": "violation_appeal, general",
        "template_kind": "appeal",
        "priority": 1,
        "sendable": True,
    },
    "视频违规了": {
        "topic_group": "violation_risk_control",
        "intent_key": "violation_reassurance",
        "scene_keys": "violation_appeal",
        "template_kind": "appeal",
        "priority": 1,
        "sendable": True,
    },
    "对于违规的高频": {
        "topic_group": "violation_risk_control",
        "intent_key": "violation_reassurance",
        "scene_keys": "violation_appeal",
        "template_kind": "appeal",
        "priority": 2,
        "sendable": True,
    },
    "给案例账号": {
        "topic_group": "product_mechanics",
        "intent_key": "case_data_reference",
        "scene_keys": "content_request, gmv_inquiry, general",
        "template_kind": "reference",
        "priority": 5,
        "sendable": False,
        "is_reference": True,
        "review_note": "Contains performance claims and external profile links; use only after policy review.",
    },
    "视频违规指导 违规申诉话术参考": {
        "topic_group": "violation_risk_control",
        "intent_key": "appeal_template",
        "scene_keys": "violation_appeal",
        "template_kind": "appeal",
        "priority": 1,
        "sendable": True,
        "is_reference": True,
    },
    "给了赔偿再次提醒：": {
        "topic_group": "violation_risk_control",
        "intent_key": "post_compensation_warning",
        "scene_keys": "violation_appeal",
        "template_kind": "risk_reminder",
        "priority": 2,
        "sendable": True,
    },
    "达人使用Tips": {
        "topic_group": "violation_risk_control",
        "intent_key": "risk_precheck",
        "scene_keys": "content_request, violation_appeal",
        "template_kind": "risk_reminder",
        "priority": 2,
        "sendable": True,
    },
    "版本迭代（WA群通知版）": {
        "topic_group": "content_strategy",
        "intent_key": "version_update_notice",
        "scene_keys": "follow_up, general",
        "template_kind": "announcement",
        "priority": 3,
        "sendable": True,
    },
    "达人选品&转化建议": {
        "topic_group": "content_strategy",
        "intent_key": "product_selection",
        "scene_keys": "content_request, gmv_inquiry",
        "template_kind": "strategy",
        "priority": 1,
        "sendable": True,
    },
}


TOP_LEVEL_HEADINGS = {
    "三. 515新用户&老用户政策",
    "六.结算细节问题",
    "七.产品问题",
}


SYNTHETIC_HEADINGS = {
    "Hi! I am truly sorry for the late reply": "违规后二次安抚",
    "These are excellent questions!": "有效视频与选品权限 FAQ",
    "Hi XXX！Thanks for all your hard work": "老用户费用调整说明",
    "Here are the specific details of the adjustment.": "老用户 Loyal Tier 旧版说明",
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def collect_paragraphs(source: Path) -> list[str]:
    doc = Document(str(source))
    return [p.text.strip() for p in doc.paragraphs if p.text.strip()]


def split_sections(paragraphs: list[str]) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    title: str | None = None
    body: list[str] = []

    def flush() -> None:
        nonlocal title, body
        if title and body:
            sections.append((title, body))
        title = None
        body = []

    for text in paragraphs:
        normalized = normalize_text(text)
        synthetic_title = next((value for prefix, value in SYNTHETIC_HEADINGS.items() if normalized.startswith(prefix)), None)
        if synthetic_title:
            flush()
            title = synthetic_title
            body.append(text)
            continue
        if normalized in TOP_LEVEL_HEADINGS:
            flush()
            sections.append((normalized, []))
            continue
        if normalized in SECTION_META:
            flush()
            title = normalized
            continue
        if title:
            body.append(text)

    flush()
    return sections


def md_escape_code(text: str) -> str:
    return text.replace("```", "` ` `")


def write_meta(meta: dict[str, object]) -> str:
    lines = ["<!-- template-meta"]
    for key, value in meta.items():
        if isinstance(value, bool):
            value = "true" if value else "false"
        lines.append(f"{key}: {value}")
    lines.append("-->")
    return "\n".join(lines)


def render_section(title: str, body: list[str]) -> str:
    if not body:
        return f"\n## {title}\n"

    meta = SECTION_META.get(title, {})
    text = "\n".join(body).strip()
    if title == "首次建联D":
        text = (
            text
            .replace("this April", "this May")
            .replace("this April.", "this May.")
            .replace("your April incentive journey", "your May incentive journey")
            .replace("$200 Achievement Bonus: Complete our April milestone tasks and secure your extra cash reward.", "$100 Challenge Bonus: Complete the May 14-day posting challenge and secure your extra cash reward.")
        )
    parts = [f"\n## {title}", write_meta(meta)]

    if meta.get("review_note"):
        parts.append(f"> Review note: {meta['review_note']}")

    parts.append("```text")
    parts.append(md_escape_code(text))
    parts.append("```")
    return "\n\n".join(parts) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    source = Path(args.source)
    out = Path(args.out)
    paragraphs = collect_paragraphs(source)
    sections = split_sections(paragraphs)

    out.parent.mkdir(parents=True, exist_ok=True)
    rendered = [
        "# Moras Creator Outreach SOP (May 2026)",
        "",
        f"Source: `{source}`",
        "Converted: 2026-05-07",
        "Status: May rollout source; section metadata is explicit so retrieval does not depend on Chinese/English heading inference.",
        "",
        "## Scope",
        "",
        "- Use case: May creator outreach, onboarding, MCN binding, settlement, posting safety, product support, violation appeal, and WA group notices.",
        "- Audience: TikTok Shop creators in outreach / onboarding / activation / growth stages.",
        "- Retrieval guardrail: sections with `sendable: false` are reference-only and should not be used as direct replies.",
        "- Policy guardrail: performance claims, GMV examples, compensation promises, and MCN requirements must stay aligned with current operator-approved policy before sending.",
    ]
    rendered.extend(render_section(title, body) for title, body in sections)
    rendered.extend([
        "",
        "## Obsidian Sync",
        "",
        "- Status: synced",
        "- Note: `docs/obsidian/notes/2026-05-07-may-template-rollout-kickoff.md`",
        "- Index: `docs/obsidian/index.md`",
    ])
    out.write_text("\n".join(rendered).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {out} with {sum(1 for _, body in sections if body)} sections from {len(paragraphs)} paragraphs")


if __name__ == "__main__":
    main()
