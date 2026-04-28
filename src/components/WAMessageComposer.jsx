import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EmojiPicker from 'emoji-picker-react';
import AIReplyPicker from './AIReplyPicker';
import { useToast } from './Toast';
import { buildConversation, buildRichContext, computeSimilarity } from './WAMessageComposer/ai/extractors';
import { inferAutoTopic, startNewTopic, resolveTopicContext, inferSceneKeyFromTopicGroup } from './WAMessageComposer/ai/topicDetector';
import { generateViaExperienceRouter } from './WAMessageComposer/ai/experienceRouter';
import { useMessagePolling, getMessageKey } from './WAMessageComposer/hooks/useMessagePolling';
import { TOPIC_GROUP_LABELS, TOPIC_GROUP_ORDER, TOPIC_GROUP_SUBTOPICS, getIntentLabel, getTopicLabel } from './WAMessageComposer/constants/topicLabels';
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api';
import { fetchWaAdmin } from '../utils/waAdmin';
import { fetchAppAuth, isAppAuthViewer, canAppAuthWriteToOwner, getAppAuthScopeOwner } from '../utils/appAuth';
import { DEFAULT_UNBOUND_AGENCY_STRATEGIES, normalizeUnboundAgencyStrategies } from '../utils/unboundAgencyStrategies';
import { getCreatorSignalBadges, getCreatorStatusMeta, getCreatorTrialPhaseMeta } from '../utils/creatorMeta';
import WA from '../utils/waTheme';

const API_BASE = '/api';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const CHAT_PATTERN = [
    'radial-gradient(circle at 1px 1px, rgba(111,106,98,0.05) 1px, transparent 0)',
    'radial-gradient(circle at 12px 12px, rgba(111,106,98,0.03) 1px, transparent 0)',
].join(', ');

const MESSAGES_CACHE_TTL_MS = 30_000;
const POLICY_DOCS_CACHE_TTL_MS = 60_000;
const messagesCache = new Map();
let policyDocsCacheEntry = null;

function getCachedMessages(creatorId) {
    if (!creatorId) return null;
    const entry = messagesCache.get(creatorId);
    if (!entry) return null;
    if (Date.now() - entry.ts > MESSAGES_CACHE_TTL_MS) {
        messagesCache.delete(creatorId);
        return null;
    }
    return entry;
}

function setCachedMessages(creatorId, msgs, total) {
    if (!creatorId) return;
    messagesCache.set(creatorId, { msgs, total, ts: Date.now() });
}

function invalidateMessagesCache(creatorId) {
    if (creatorId) messagesCache.delete(creatorId);
}

function getCachedPolicyDocs() {
    if (!policyDocsCacheEntry) return null;
    if (Date.now() - policyDocsCacheEntry.ts > POLICY_DOCS_CACHE_TTL_MS) {
        policyDocsCacheEntry = null;
        return null;
    }
    return policyDocsCacheEntry.docs;
}

function setCachedPolicyDocs(docs) {
    policyDocsCacheEntry = { docs, ts: Date.now() };
}
const LIFECYCLE_AARRR_META = [
    { key: 'acquisition', label: '获取', color: '#6d8fe5' },
    { key: 'activation', label: '激活', color: '#e2a55f' },
    { key: 'retention', label: '留存', color: '#58a68b' },
    { key: 'revenue', label: '变现', color: '#2f7d65' },
    { key: 'referral', label: '传播', color: '#b8734c' },
];

function formatBytes(value = 0) {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toTimestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function getMessageRenderKey(message, fallback = '') {
    if (!message) return fallback;
    return String(
        message.message_key
        ?? message.id
        ?? message.message_hash
        ?? `${message.role || ''}:${toTimestampMs(message.timestamp)}:${message.text || ''}:${fallback}`
    );
}

function getTranslationKey(message, fallback = '') {
    if (!message) return fallback;
    return String(message.message_key ?? getMessageRenderKey(message, fallback));
}

function getLatestMessageTimestamp(messages = []) {
    return messages.reduce((max, message) => Math.max(max, toTimestampMs(message?.timestamp)), 0);
}

function normalizeJumpText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9\u4e00-\u9fff\s$]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildJumpTokens(value) {
    const normalized = normalizeJumpText(value);
    if (!normalized) return [];
    return [...new Set(normalized.split(' ').filter(token => token && token.length >= 2))];
}

function extractImageUrls(value = '') {
    const source = String(value || '');
    const absolute = source.match(/https?:\/\/[^\s"'<>，。；、)）\]]+/g) || [];
    const relative = source.match(/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>，。；、)）\]]*)?/gi) || [];
    return [...new Set([...absolute, ...relative].map((url) => url.trim()).filter(Boolean))].slice(0, 12);
}

function mergeMediaUrls(current = '', incoming = '') {
    const urls = [
        ...extractImageUrls(current),
        ...extractImageUrls(incoming),
    ];
    return [...new Set(urls)].slice(0, 6).join('\n');
}

function formatMediaUrlLabel(url = '') {
    if (String(url || '').startsWith('/')) {
        const fileName = String(url).split('/').filter(Boolean).pop() || url;
        return decodeURIComponent(fileName).slice(0, 56);
    }
    try {
        const parsed = new URL(url);
        const fileName = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
        return `${parsed.hostname} / ${decodeURIComponent(fileName).slice(0, 42)}`;
    } catch (_) {
        return String(url || '').slice(0, 56);
    }
}

const SOP_IMAGE_TOPIC_TEMPLATES = [
    {
        topic_group: 'outreach_contact',
        intent_key: 'first_outreach_fixed',
        scene_key: 'first_contact',
        label: 'App Store下载图',
        image: '/sop-assets/apr-2026/image1.png',
        summary: 'Moras App Store 下载入口截图，适合建联、跟进、邀请码说明时附给达人。',
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'invite_code_reply',
        scene_key: 'trial_intro',
        label: '邀请码填写图',
        image: '/sop-assets/apr-2026/image3.png',
        summary: '注册/登录后输入邀请码的步骤截图，适合邀请码回复和注册卡点说明。',
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'username_followup',
        scene_key: 'trial_intro',
        label: '登录返回图',
        image: '/sop-assets/apr-2026/image11.png',
        summary: '登录失败时返回上一步的参考截图，用于指导达人用原邮箱重新登录。',
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'username_followup',
        scene_key: 'trial_intro',
        label: '原邮箱登录图',
        image: '/sop-assets/apr-2026/image12.png',
        summary: '使用此前登录邮箱继续登录的截图，适合处理登录不上或账号找回问题。',
    },
    {
        topic_group: 'mcn_partnership',
        intent_key: 'mcn_explain',
        scene_key: 'mcn_binding',
        label: 'MCN邀请入口',
        image: '/sop-assets/apr-2026/image4.png',
        summary: 'TikTok Agency/MCN 邀请与绑定入口截图，用于解释如何接受绑定邀请。',
    },
    {
        topic_group: 'mcn_partnership',
        intent_key: 'mcn_explain',
        scene_key: 'mcn_binding',
        label: 'Agency权限勾选',
        image: '/sop-assets/apr-2026/image5.png',
        summary: 'Agency 绑定时需要勾选的数据权限截图，适合绑定步骤指导。',
    },
    {
        topic_group: 'mcn_partnership',
        intent_key: 'mcn_hesitation',
        scene_key: 'mcn_binding',
        label: '解绑旧MCN',
        image: '/sop-assets/apr-2026/image6.png',
        summary: '已有 MCN 时如何先解绑/处理旧绑定的截图，适合绑定冲突说明。',
    },
    {
        topic_group: 'settlement_pricing',
        intent_key: 'monthly_fee_explain',
        scene_key: 'payment_issue',
        label: '7天额度说明图',
        image: '/sop-assets/apr-2026/image2.png',
        summary: '7 天试用、20 generations/day 与 MCN 后额度变化说明图。',
    },
    {
        topic_group: 'settlement_pricing',
        intent_key: 'subsidy_explain',
        scene_key: 'payment_issue',
        label: '规则奖励图',
        image: '/sop-assets/apr-2026/image9.png',
        summary: 'April Creator Rewards Program 的规则、补贴、里程碑和推荐奖励图。',
    },
    {
        topic_group: 'product_mechanics',
        intent_key: 'how_moras_works',
        scene_key: 'content_request',
        label: '产品流程图',
        image: '/sop-assets/apr-2026/image3.png',
        summary: 'Moras 注册、生成和使用流程参考图，可用于产品机制说明。',
    },
    {
        topic_group: 'violation_risk_control',
        intent_key: 'risk_precheck',
        scene_key: 'violation_appeal',
        label: '广告状态图',
        image: '/sop-assets/apr-2026/image13.png',
        summary: '视频处于广告/投放状态时的页面截图，适合解释无法删除或隐藏的情况。',
    },
    {
        topic_group: 'violation_risk_control',
        intent_key: 'risk_precheck',
        scene_key: 'violation_appeal',
        label: 'Ads only图',
        image: '/sop-assets/apr-2026/image14.jpeg',
        summary: '将视频切换为 ads only、减少自然流量影响的参考截图。',
    },
    {
        topic_group: 'violation_risk_control',
        intent_key: 'violation_reassurance',
        scene_key: 'violation_appeal',
        label: '发布前检查图',
        image: '/sop-assets/apr-2026/image15.png',
        summary: '发布前检查颜色、形状、logo、纹理是否一致的 Tips 截图。',
    },
    {
        topic_group: 'content_strategy',
        intent_key: 'posting_cadence',
        scene_key: 'content_request',
        label: 'GMV案例图1',
        image: '/sop-assets/apr-2026/image7.jpeg',
        summary: '达人 GMV 表现案例截图，仅作运营参考，发送前注意避免夸大承诺。',
    },
    {
        topic_group: 'content_strategy',
        intent_key: 'product_selection',
        scene_key: 'content_request',
        label: 'GMV案例图2',
        image: '/sop-assets/apr-2026/image8.jpeg',
        summary: '达人 GMV/订单表现案例截图，仅作运营参考，避免作为保证收益表达。',
    },
];

function findMessageMatch(messages = [], jumpTarget = null) {
    if (!jumpTarget || !Array.isArray(messages) || messages.length === 0) return null;

    const exactId = jumpTarget?.sourceMessageId ? String(jumpTarget.sourceMessageId) : '';
    const sourceText = normalizeJumpText(jumpTarget?.sourceText || '');
    const fallbackText = normalizeJumpText(jumpTarget?.triggerText || '');
    const sourceTokens = buildJumpTokens(jumpTarget?.sourceText || '');
    const fallbackTokens = buildJumpTokens(jumpTarget?.triggerText || '');
    const targetTimestamp = toTimestampMs(jumpTarget?.sourceMessageTimestamp || 0);

    let best = null;
    let bestScore = 0;

    messages.forEach((message, index) => {
        const messageId = message?.id ? String(message.id) : '';
        const messageText = normalizeJumpText(message?.text || '');
        const messageTokens = buildJumpTokens(message?.text || '');
        const renderKey = getMessageRenderKey(message, `jump_${index}`);

        let score = 0;
        if (exactId && messageId && messageId === exactId) {
            score += 1000;
        }
        if (sourceText && messageText) {
            if (messageText.includes(sourceText) || sourceText.includes(messageText)) {
                score += 240;
            }
        }
        if (fallbackText && messageText) {
            if (messageText.includes(fallbackText) || fallbackText.includes(messageText)) {
                score += 160;
            }
        }

        sourceTokens.forEach((token) => {
            if (messageTokens.includes(token) || messageText.includes(token)) score += token.length >= 4 ? 14 : 8;
        });
        fallbackTokens.forEach((token) => {
            if (messageTokens.includes(token) || messageText.includes(token)) score += token.length >= 4 ? 9 : 5;
        });

        if (targetTimestamp > 0) {
            const diff = Math.abs(toTimestampMs(message?.timestamp) - targetTimestamp);
            if (diff <= 60 * 1000) score += 120;
            else if (diff <= 10 * 60 * 1000) score += 70;
            else if (diff <= 60 * 60 * 1000) score += 35;
        }

        if (score > bestScore) {
            bestScore = score;
            best = { message, renderKey, score };
        }
    });

    return bestScore >= 20 ? best : null;
}

function mergeChronologicalMessages(existing = [], incoming = []) {
    const merged = new Map();

    [...existing, ...incoming].forEach((message, index) => {
        const key = getMessageRenderKey(message, `merge_${index}`);
        if (!merged.has(key)) {
            merged.set(key, message);
            return;
        }

        const current = merged.get(key);
        const currentId = Number(current?.id || 0);
        const incomingId = Number(message?.id || 0);
        if (incomingId > currentId) {
            merged.set(key, { ...current, ...message });
        }
    });

    return Array.from(merged.values()).sort((a, b) => {
        const tsDiff = toTimestampMs(a?.timestamp) - toTimestampMs(b?.timestamp);
        if (tsDiff !== 0) return tsDiff;
        return Number(a?.id || 0) - Number(b?.id || 0);
    });
}

function getLatestIncomingMessage(messages = []) {
    const latest = messages[messages.length - 1];
    return latest?.role === 'user' ? latest : null;
}

function isImageMessage(message = {}) {
    const mime = String(message?.mime_type || message?.mimeType || '').toLowerCase();
    const url = String(message?.media_url || message?.previewUrl || '').toLowerCase();
    return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
}

function hasMediaAttachment(message = {}) {
    return !!(message?.media_url || message?.previewUrl || message?.file_name || message?.fileName || message?.mime_type || message?.mimeType);
}

function getMessageMediaUrl(message = {}) {
    return String(message?.media_url || message?.previewUrl || '').trim();
}

function getMessageFileName(message = {}) {
    return String(message?.file_name || message?.fileName || '').trim();
}

function getMessageMime(message = {}) {
    return String(message?.mime_type || message?.mimeType || '').trim();
}

function getMessageCaption(message = {}) {
    const raw = String(message?.caption || message?.text || '').trim();
    if (raw === '🖼️ [Image]') return '';
    return raw.replace(/^🖼️ \[Image\]\s*/i, '').trim();
}

function getConversationStatusMeta(creator) {
    const meta = getCreatorStatusMeta(creator);
    if (!meta?.label) return null;
    return {
        label: meta.label,
        bg: meta.bg,
        color: meta.accent,
    };
}

function parseLifecycleTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return null;
        return toTimestampMs(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const n = Number(value.trim());
        if (!Number.isFinite(n) || n <= 0) return null;
        return toTimestampMs(n);
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function getLifecycleChartSource(creator) {
    const full = creator?._full || creator || {};
    return {
        lifecycle: creator?.lifecycle || full?.lifecycle || {},
        events: creator?.events || full?.events || {},
        wacrm: creator?.wacrm || full?.wacrm || {},
        joinbrands: creator?.joinbrands || full?.joinbrands || {},
        keeperGmv: Number(
            creator?.keeper_gmv
            ?? full?.keeper_gmv
            ?? full?.keeper?.keeper_gmv
            ?? 0
        ) || 0,
        createdAt: creator?.created_at || full?.created_at || null,
        updatedAt: creator?.updated_at || full?.updated_at || null,
        lastActive: creator?.last_active || full?.last_active || null,
    };
}

function getLifecycleStageRank(stageKey) {
    const rankMap = {
        acquisition: 0,
        activation: 1,
        retention: 2,
        revenue: 3,
        terminated: 4,
    };
    const normalized = String(stageKey || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(rankMap, normalized) ? rankMap[normalized] : -1;
}

function getEventAnchorTimestamp(event) {
    return parseLifecycleTimestamp(event?.display_start_at)
        || parseLifecycleTimestamp(event?.completed_at)
        || parseLifecycleTimestamp(event?.verified_at)
        || parseLifecycleTimestamp(event?.updated_at)
        || parseLifecycleTimestamp(event?.created_at)
        || parseLifecycleTimestamp(event?.start_at)
        || null;
}

function getEventKeyTimestamp(events = [], eventKeys = []) {
    const normalizedKeys = eventKeys.map((item) => String(item || '').toLowerCase()).filter(Boolean);
    const timestamps = (Array.isArray(events) ? events : [])
        .filter((event) => normalizedKeys.includes(String(event?.event_key || '').toLowerCase()))
        .map((event) => getEventAnchorTimestamp(event))
        .filter(Boolean);
    if (timestamps.length === 0) return null;
    return Math.min(...timestamps);
}

function getReferralActivatedAtForChat(creator, events = []) {
    const { lifecycle } = getLifecycleChartSource(creator);
    const referralTs = getEventKeyTimestamp(events, ['referral']);
    if (referralTs) return referralTs;
    if (lifecycle?.flags?.referral_active) {
        return parseLifecycleTimestamp(lifecycle?.evaluated_at);
    }
    return null;
}

function getLifecycleEventMilestonesForChat(creator, events = []) {
    const { lifecycle, wacrm, keeperGmv, createdAt, updatedAt, lastActive } = getLifecycleChartSource(creator);
    const flags = lifecycle?.flags || {};
    const stageRank = getLifecycleStageRank(lifecycle?.stage_key);
    const fallbackAnchor = parseLifecycleTimestamp(lastActive) || parseLifecycleTimestamp(updatedAt);
    const milestone = {
        acquisition_at: parseLifecycleTimestamp(createdAt) || parseLifecycleTimestamp(lifecycle?.evaluated_at) || fallbackAnchor,
        activation_at: null,
        retention_at: null,
        revenue_at: null,
        referral_at: getReferralActivatedAtForChat(creator, events),
    };

    const trialTs = getEventKeyTimestamp(events, ['trial_7day', 'monthly_challenge']);
    const agencyTs = getEventKeyTimestamp(events, ['agency_bound']);
    const revenueTs = getEventKeyTimestamp(events, ['gmv_milestone']);

    if (trialTs) {
        milestone.activation_at = trialTs;
    } else if (
        stageRank >= 1
        || flags?.trial_completed
        || ['joined', 'active', 'completed'].includes(String(wacrm?.beta_status || '').toLowerCase())
        || String(wacrm?.monthly_fee_status || '').toLowerCase() === 'paid'
    ) {
        milestone.activation_at = parseLifecycleTimestamp(lifecycle?.evaluated_at) || fallbackAnchor;
    }

    if (agencyTs) {
        milestone.retention_at = agencyTs;
    } else if (stageRank >= 2 || flags?.agency_bound) {
        milestone.retention_at = parseLifecycleTimestamp(lifecycle?.evaluated_at) || fallbackAnchor;
    }

    if (revenueTs) {
        milestone.revenue_at = revenueTs;
    } else if (
        stageRank >= 3
        || keeperGmv >= 2000
        || ['gte_2k', 'gte_5k', 'gte_10k', '2k', '5k', '10k'].includes(String(flags?.gmv_tier || '').toLowerCase())
    ) {
        milestone.revenue_at = parseLifecycleTimestamp(lifecycle?.evaluated_at) || fallbackAnchor;
    }

    return milestone;
}

function buildLifecycleJourneyModel(creator, events = []) {
    if (!creator) return null;
    const { lifecycle } = getLifecycleChartSource(creator);
    const milestones = getLifecycleEventMilestonesForChat(creator, events);
    const seq = ['acquisition', 'activation', 'retention', 'revenue'];
    let progressIndex = -1;
    seq.forEach((key, idx) => {
        if (milestones[`${key}_at`]) progressIndex = idx;
    });
    const hasReferral = !!milestones.referral_at;
    const width = 320;
    const left = 14;
    const right = 14;
    const top = 14;
    const bottom = 64;
    const innerWidth = width - left - right;
    const xs = LIFECYCLE_AARRR_META.map((_, idx) => left + (innerWidth / (LIFECYCLE_AARRR_META.length - 1)) * idx);
    const ys = LIFECYCLE_AARRR_META.map((stage, idx) => {
        const reached = stage.key === 'referral' ? hasReferral : idx <= progressIndex;
        return reached ? top + 8 : bottom;
    });
    const points = xs.map((x, idx) => `${x},${ys[idx]}`).join(' ');
    const reachedCount = seq.filter((key) => milestones[`${key}_at`]).length + (hasReferral ? 1 : 0);
    const stageLabel = lifecycle?.stage_label
        || LIFECYCLE_AARRR_META.find((item) => item.key === lifecycle?.stage_key)?.label
        || '获取';

    return {
        stageKey: lifecycle?.stage_key || 'acquisition',
        stageLabel,
        reachedCount,
        progressIndex,
        xs,
        ys,
        points,
        top,
        bottom,
        left,
        right,
        width,
        hasReferral,
    };
}

function formatLifecycleStripTime(value) {
    const ts = parseLifecycleTimestamp(value);
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function LifecycleJourneyStrip({ creator, events = [] }) {
    const [expanded, setExpanded] = useState(false);
    const model = buildLifecycleJourneyModel(creator, events);
    if (!model) return null;

    const { lifecycle } = getLifecycleChartSource(creator);
    const evaluatedLabel = formatLifecycleStripTime(lifecycle?.evaluated_at);

    return (
        <div
            className="px-4 md:px-5 py-3"
            style={{ background: WA.shellPanelStrong, borderBottom: `1px solid ${WA.borderLight}` }}
        >
            <div
                className="rounded-[22px] overflow-hidden"
                style={{
                    background: 'linear-gradient(180deg, rgba(255,253,250,0.98) 0%, rgba(247,242,233,0.98) 100%)',
                    border: `1px solid ${WA.borderLight}`,
                    boxShadow: '0 12px 28px rgba(32,26,21,0.05)',
                }}
            >
                {/* Header - Always Visible, Clickable */}
                <div
                    className="px-4 py-3 md:px-5 md:py-3.5 cursor-pointer select-none hover:bg-black/[0.02] active:bg-black/[0.04] transition-colors"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <div
                                    className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                                    style={{ color: WA.textMuted }}
                                >
                                    Lifecycle Journey
                                </div>
                                <svg
                                    className="transition-transform duration-200"
                                    style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                    width="12"
                                    height="12"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                >
                                    <path
                                        d="M3 4.5L6 7.5L9 4.5"
                                        stroke={WA.textMuted}
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                            <div className="mt-0.5 text-sm md:text-[15px] font-semibold" style={{ color: WA.textDark }}>
                                生命周期轨迹
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 shrink-0">
                            <span
                                className="text-[11px] px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: 'rgba(45,138,160,0.12)', color: '#2d8aa0' }}
                            >
                                {model.stageLabel}
                            </span>
                            <span
                                className="text-[11px] px-2.5 py-1 rounded-full font-semibold"
                                style={{ background: 'rgba(185,133,63,0.12)', color: '#9a6f2f' }}
                            >
                                命中 {model.reachedCount}/5
                            </span>
                        </div>
                    </div>
                </div>

                {/* Expandable Content */}
                {expanded && (
                    <div className="px-4 pb-3 md:px-5 md:pb-4 pt-0">
                        {evaluatedLabel && (
                            <div className="mb-3 text-[11px]" style={{ color: WA.textMuted }}>
                                最近评估 {evaluatedLabel}
                            </div>
                        )}

                        <svg viewBox={`0 0 ${model.width} 88`} className="block w-full h-[88px] md:h-[96px]" preserveAspectRatio="none">
                            <line
                                x1={model.left}
                                y1={model.bottom}
                                x2={model.width - model.right}
                                y2={model.bottom}
                                stroke="rgba(153,133,107,0.20)"
                                strokeWidth="1"
                            />
                            {model.xs.map((x) => (
                                <line
                                    key={`guide_${x}`}
                                    x1={x}
                                    y1={model.top + 2}
                                    x2={x}
                                    y2={model.bottom + 4}
                                    stroke="rgba(153,133,107,0.12)"
                                    strokeWidth="1"
                                />
                            ))}
                            <polyline
                                fill="none"
                                stroke="#9f8e7a"
                                strokeWidth="2"
                                points={model.points}
                            />
                            {LIFECYCLE_AARRR_META.map((stage, idx) => {
                                const reached = stage.key === 'referral' ? model.hasReferral : idx <= model.progressIndex;
                                return (
                                    <circle
                                        key={stage.key}
                                        cx={model.xs[idx]}
                                        cy={model.ys[idx]}
                                        r={reached ? 4 : 3}
                                        fill={reached ? stage.color : '#d1c4b3'}
                                        stroke="#fffdfa"
                                        strokeWidth="1.5"
                                    />
                                );
                            })}
                        </svg>

                        <div className="grid grid-cols-5 gap-1.5 mt-2.5">
                            {LIFECYCLE_AARRR_META.map((stage, idx) => {
                                const reached = stage.key === 'referral' ? model.hasReferral : idx <= model.progressIndex;
                                const active = stage.key === model.stageKey;
                                return (
                                    <div key={stage.key} className="min-w-0 text-center">
                                        <div
                                            className="text-[11px] font-semibold"
                                            style={{ color: active ? stage.color : (reached ? WA.textDark : WA.textMuted) }}
                                        >
                                            {stage.label}
                                        </div>
                                        <div className="mt-1 text-[10px]" style={{ color: reached ? '#8b7761' : '#b6a28b' }}>
                                            {reached ? '已达成' : '待推进'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function WAMessageComposer({ client, creator, jumpTarget, onClose, onSwipeLeft, onMessageSent, onCreatorUpdated, asPanel, topSlot = null }) {
    // 当前用户是否 viewer,以及对当前目标 creator 的 owner 是否有写权限
    const isViewer = isAppAuthViewer();
    const viewerOwnOwner = isViewer ? String(getAppAuthScopeOwner() || '').trim() : '';
    const targetOwner = creator?.wa_owner || client?.wa_owner || null;
    const canSendToTarget = canAppAuthWriteToOwner(targetOwner);
    const writeBlocked = isViewer && !canSendToTarget;
    const writeBlockedTitle = writeBlocked
        ? `只读模式：当前达人归属 ${targetOwner || '其他 owner'}，你只能给自己 owner (${viewerOwnOwner}) 下的达人发送消息`
        : null;
    const toast = useToast();
    const [inputText, setInputText] = useState('');
    const [generating, setGenerating] = useState(false);
    const [sendingText, setSendingText] = useState(false);
    const [isComposing, setIsComposing] = useState(false);
    // 共享锁：发送/生成/选择 任意操作在飞行中时，阻止其他入口重复触发
    const sendLockRef = useRef(false);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [translating, setTranslating] = useState(false);
    // 翻译进度：null = 未翻译, 'n/t' = 翻译中
    const [translateProgress, setTranslateProgress] = useState(null);
    // 翻译 map：key = message_key，value = 中文翻译
    const [translationMap, setTranslationMap] = useState({});
    const [translatingMessageKey, setTranslatingMessageKey] = useState(null);
    // 主输入框翻译：loading 态
    const [translatingInput, setTranslatingInput] = useState(false);
    // 主输入框翻译 undo 快照：存原文；置 null 表示当前不在"已翻译"状态
    const [inputOriginalBeforeTranslate, setInputOriginalBeforeTranslate] = useState(null);
    // 记录上一次的译文，用于判断用户是否手动编辑过输入框（编辑后再点 🌐 视为重新翻译而不是 undo）
    const [lastTranslatedInputText, setLastTranslatedInputText] = useState(null);

    // 当前回复上下文（模板/AI 共用，四槽位方案）
    const [activeReplyContext, setActiveReplyContext] = useState(null);
    // 用户主动关闭 Reply Deck 时记下当时的 context signature；
    // 只要 signature 没变（没有新来信 / 没切 topic），就不再自动把 deck 弹回来。
    const [dismissedReplySignature, setDismissedReplySignature] = useState(null);
    const [templateDeck, setTemplateDeck] = useState(null);
    const [templateLoading, setTemplateLoading] = useState(false);
    const [templateError, setTemplateError] = useState(null);

    // 当前活跃的 AI 候选（op3/op4，通过 🤖 按钮手动触发）
    const [activePicker, setActivePicker] = useState(null);
    // 主输入框工具:Emoji 润色 loading 态(翻译复用 translatingInput)
    const [emojiEnhancingInput, setEmojiEnhancingInput] = useState(false);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerError, setPickerError] = useState(null);
    const [pickerCollapsed, setPickerCollapsed] = useState(false);
    const [replyDeckHeight, setReplyDeckHeight] = useState(0);
    const [templateManageModal, setTemplateManageModal] = useState(null);
    const [isMobileViewport, setIsMobileViewport] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < 768;
    });
    const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl, fileName, mimeType, size }
    const [sendingMedia, setSendingMedia] = useState(false);
    const [syncingMessages, setSyncingMessages] = useState(false);
    const [repairingMessages, setRepairingMessages] = useState(false);
    const [lastSyncSummary, setLastSyncSummary] = useState(null);
    const [lastRepairSummary, setLastRepairSummary] = useState(null);

    // 待审核队列
    const [pendingCandidates, setPendingCandidates] = useState([]);

    // 移动端标签 bar 显示状态
    const [tagsVisible, setTagsVisible] = useState(true);

    // 话题下拉菜单
    const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);

    // 当前话题状态
    const [currentTopic, setCurrentTopic] = useState(null); // { topic_key, trigger, detected_at, keywords }

    // 自动检测到的话题（每次 messages 变化时刷新）
    const [autoDetectedTopic, setAutoDetectedTopic] = useState(null); // { topic_key, label, confidence }

    // 键盘弹出时 visualViewport 偏移量
    const [viewportOffset, setViewportOffset] = useState(0);

    // 移动端左划手势
    const touchStartX = useRef(null);
    const handleTouchStart = (e) => {
        touchStartX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (touchStartX.current === null) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX.current;
        if (deltaX < -50) {
            onSwipeLeft?.();
        }
        touchStartX.current = null;
    };

    // 消息历史（从 API 轮询更新）
    const [messages, setMessages] = useState(client?.messages || []);
    const [messageTotal, setMessageTotal] = useState(
        Number.isFinite(Number(client?.msg_count))
            ? Number(client.msg_count)
            : Number.isFinite(Number(creator?.msg_count))
                ? Number(creator.msg_count)
                : Array.isArray(client?.messages)
                    ? client.messages.length
                    : 0
    );
    const [loadedServerCount, setLoadedServerCount] = useState(0);
    const [loadingOlder, setLoadingOlder] = useState(false);

    // 政策文档和客户记忆（预加载）
    const [policyDocs, setPolicyDocs] = useState([]);
    const [clientMemory, setClientMemory] = useState([]);
    const [agencyStrategies, setAgencyStrategies] = useState(DEFAULT_UNBOUND_AGENCY_STRATEGIES);
    const [savedCustomTopicTemplates, setSavedCustomTopicTemplates] = useState([]);
    // 活跃事件数据（用于 inferAutoTopic 置信度加权 + Prompt 注入）
    const [activeEvents, setActiveEvents] = useState([]);
    const [allEvents, setAllEvents] = useState([]);

    const chatScrollRef = useRef(null);
    const inputRef = useRef(null);
    const mediaInputRef = useRef(null);
    const messageNodeRefs = useRef(new Map());
    const processedJumpRequestRef = useRef(null);
    const olderLoadCooldownRef = useRef(false);
    const jumpContextUntilRef = useRef(0);
    const prependInFlightRef = useRef(false);
    const [highlightedMessageKey, setHighlightedMessageKey] = useState(null);

    // 滚动到底部
    const scrollToBottom = useCallback(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, []);

    const unpackMessageResponse = useCallback((data) => {
        const msgs = Array.isArray(data) ? data : (data?.messages || []);
        const total = Array.isArray(data)
            ? msgs.length
            : Number.isFinite(Number(data?.total))
                ? Number(data.total)
                : msgs.length;
        return { msgs, total };
    }, []);

    const clearPendingImage = useCallback(() => {
        setPendingImage((prev) => {
            if (prev?.previewUrl) {
                try {
                    URL.revokeObjectURL(prev.previewUrl);
                } catch (_) {}
            }
            return null;
        });
        if (mediaInputRef.current) {
            mediaInputRef.current.value = '';
        }
    }, []);

    const fileToDataUrl = useCallback((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
    }), []);

    const fetchPolicyDocs = async () => {
        const cached = getCachedPolicyDocs();
        if (cached) return cached;
        try {
            const docs = await fetchJsonOrThrow(`${API_BASE}/policy-documents?active_only=true`, {
                signal: AbortSignal.timeout(15000),
            });
            if (Array.isArray(docs)) setCachedPolicyDocs(docs);
            return docs;
        } catch (_) {}
        return [];
    };

    const fetchUnboundAgencyStrategies = async () => {
        try {
            const data = await fetchJsonOrThrow(`${API_BASE}/strategy-config/unbound-agency`, {
                signal: AbortSignal.timeout(15000),
            });
            const normalized = normalizeUnboundAgencyStrategies(data?.strategies || []);
            return normalized.length > 0 ? normalized : DEFAULT_UNBOUND_AGENCY_STRATEGIES;
        } catch (_) {}
        return DEFAULT_UNBOUND_AGENCY_STRATEGIES;
    };

    const fetchCustomTopicTemplates = async () => {
        try {
            const data = await fetchJsonOrThrow(`${API_BASE}/custom-topic-templates`, {
                signal: AbortSignal.timeout(15000),
            });
            return Array.isArray(data?.templates) ? data.templates : [];
        } catch (e) {
            console.error('[customTopicTemplates] load failed:', e);
            return [];
        }
    };

    // 追踪最近一次互动时间（用于48小时话题切换）
    const lastActivityRef = useRef(null);

    // pendingCandidates ref：避免 cleanup 时的 stale closure 问题
    const pendingCandidatesRef = useRef(pendingCandidates);
    // 同步更新 ref（setState 之后）
    pendingCandidatesRef.current = pendingCandidates;
    const activePickerRef = useRef(activePicker);
    activePickerRef.current = activePicker;

    // generationRaceRef：防止切换达人后旧的生成结果覆盖新的
    const generationRaceRef = useRef(0);

    // 记录最近一次已生成过候选的 incoming 消息 key —— 防止 5s 轮询反复对同一条消息重新生成
    const lastGeneratedKeyRef = useRef(null);

    // messagesRef：同步 messages 状态，供 generateForIncoming 读当前对话而无需重新 fetch
    const messagesRef = useRef([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    // sideDataReady：副数据 (policyDocs + clientMemory) 首次加载完成的标记。
    // 自动 AI 生成 effect 会等这个 flag（保留 "未加载政策不自动生成" 的合规不变量）。
    const [sideDataReady, setSideDataReady] = useState(false);

    // Effect 1: 切换达人 → 重置所有会话级状态
    // 只依赖 phone；msg_count 不再作为依赖，避免 SSE/轮询更新总数时触发整屏重载。
    useEffect(() => {
        if (!client?.phone) return;
        setActivePicker(null);
        setPendingCandidates([]);
        setDismissedReplySignature(null);
        setMessages([]);
        setMessageTotal(
            Number.isFinite(Number(client?.msg_count))
                ? Number(client.msg_count)
                : Number.isFinite(Number(creator?.msg_count))
                    ? Number(creator.msg_count)
                    : 0
        );
        setLoadedServerCount(0);
        setLoadingOlder(false);
        setLastSyncSummary(null);
        setLastRepairSummary(null);
        setCurrentTopic(null);
        setAutoDetectedTopic(null);
        setAllEvents([]);
        setActiveEvents([]);
        setSideDataReady(false);
        clearPendingImage();
        jumpContextUntilRef.current = 0;
        pendingCandidatesRef.current = [];
        lastActivityRef.current = null;
        lastGeneratedKeyRef.current = null;
        // 每次切人 race 递增，让旧的 async 结果进不来
        generationRaceRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client?.phone]);

    // Effect 2: 切换达人 → 立刻拉消息（独立于副数据，不被阻塞）
    // 命中缓存时先渲染缓存再后台 revalidate（stale-while-revalidate）。
    useEffect(() => {
        if (!client?.id) return;
        const creatorId = client.id;
        const race = generationRaceRef.current;
        let cancelled = false;

        const cached = getCachedMessages(creatorId);
        if (cached && cached.msgs.length > 0) {
            setMessages(cached.msgs);
            setMessageTotal(cached.total);
            setLoadedServerCount(cached.msgs.length);
            const latestTs = getLatestMessageTimestamp(cached.msgs);
            if (latestTs > 0) lastActivityRef.current = latestTs;
        }

        (async () => {
            try {
                const data = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}/messages`, {
                    signal: AbortSignal.timeout(15000),
                });
                if (cancelled || race !== generationRaceRef.current) return;
                const { msgs, total } = unpackMessageResponse(data);
                setMessages(msgs);
                setMessageTotal(total);
                setLoadedServerCount(msgs.length);
                setCachedMessages(creatorId, msgs, total);
                const latestTs = getLatestMessageTimestamp(msgs);
                if (latestTs > 0) lastActivityRef.current = latestTs;
            } catch (e) {
                if (e?.name !== 'AbortError') console.error('[load-messages] error:', e);
            }
        })();

        return () => { cancelled = true; };
    }, [client?.id, unpackMessageResponse]);

    // Effect 3: 切换达人 → 并行拉副数据（policyDocs / client-memory / events / strategies）
    // 不阻塞消息渲染；拉完后 sideDataReady=true，解锁自动 AI 生成。
    useEffect(() => {
        if (!client?.phone) return;
        const creatorId = client?.id;
        const race = generationRaceRef.current;
        let cancelled = false;

        Promise.all([
            fetchPolicyDocs(),
            fetchJsonOrThrow(`${API_BASE}/client-memory/${client.phone}`, {
                signal: AbortSignal.timeout(15000),
            }).catch(() => []),
            creatorId
                ? fetchJsonOrThrow(`${API_BASE}/events/summary/${creatorId}`, {
                    signal: AbortSignal.timeout(15000),
                }).catch(() => ({ events: [] }))
                : Promise.resolve({ events: [] }),
            fetchUnboundAgencyStrategies(),
            fetchCustomTopicTemplates(),
        ]).then(([docs, mem, evtData, strategyConfig, customTemplates]) => {
            if (cancelled || race !== generationRaceRef.current) return;
            setPolicyDocs(docs);
            setClientMemory(mem || []);
            setAgencyStrategies(strategyConfig);
            setSavedCustomTopicTemplates(customTemplates);
            const events = evtData?.events || [];
            setAllEvents(events);
            setActiveEvents(events.filter(e => e.status === 'active'));
            setSideDataReady(true);
        });

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client?.phone, client?.id]);

    // 四槽位方案：不再对新 incoming 消息自动生成 AI 候选。op3/op4 由 🤖 按钮手动触发。

    // 为一条 incoming 消息生成候选
    // conversationMsgs: 可选,调用方传入已拉到的消息列表(避免重复 fetch)。
    // 不传时读 messagesRef.current(与 messages state 实时同步)。
    const generateForIncoming = useCallback(async (incomingMsg, conversationMsgs) => {
        if (!client?.id || !client?.phone) return null;
        setPickerLoading(true);
        setPickerError(null);
        try {
            const msgs = Array.isArray(conversationMsgs) && conversationMsgs.length > 0
                ? conversationMsgs
                : messagesRef.current;
            const conversation = buildConversation(msgs);

            const result = await generateViaExperienceRouter({
                conversation,
                client_id: client.phone,
                client,
                creator,
                policyDocs,
                clientMemory,
                agencyStrategies,
                currentTopic,
                autoDetectedTopic,
                setCurrentTopic,
            });

            return {
                incomingMsg,
                candidates: result,
                systemPrompt: result.systemPrompt,
                systemPromptVersion: result.systemPromptVersion,
                operator: result.operator,
                operatorDisplayName: result.operatorDisplayName,
                operatorConfigured: result.operatorConfigured,
                scene: result.scene,
                sceneSource: result.sceneSource || null,
                retrievalSnapshotId: result.retrievalSnapshotId || null,
                generationLogId: result.generationLogId || null,
                provider: result.provider || null,
                model: result.model || null,
                pipelineVersion: result.pipelineVersion || 'reply_generation_v2',
                generated_at: Date.now(),
                policyDocs,
            };
        } catch (e) {
            console.error('[generateForIncoming] error:', e);
            setPickerError(e.message || '生成失败，请重试');
            return null;
        } finally {
            setPickerLoading(false);
        }
    }, [client, creator, policyDocs, clientMemory, agencyStrategies, currentTopic, autoDetectedTopic]);

    // 弹出候选 picker（处理新候选）
    const pushPicker = useCallback((result) => {
        if (!result) return;
        setActivePicker(prev => {
            if (prev) {
                setPendingCandidates(p => [...p, result]);
                return prev;
            }
            return result;
        });
    }, []);

    useMessagePolling({
        client,
        setMessages: (freshMsgs) => {
            if (Date.now() < jumpContextUntilRef.current) return;
            setMessages((prev) => {
                const merged = mergeChronologicalMessages(prev, freshMsgs);
                // 增量 merge 时 loadedServerCount 应跟上已有消息数(用于 load-older 分页 offset)
                setLoadedServerCount((prevCount) => Math.max(prevCount, merged.length));
                // 同步缓存,SSE 到达后回切缓存不会丢新消息
                setCachedMessages(client?.id, merged, Math.max(merged.length, 0));
                return merged;
            });
        },
        setMessageTotal,
        lastActivityRef,
        onTopicTimeout: () => {
            const newTopic = startNewTopic({ trigger: 'time', newText: '', messages: [] });
            setCurrentTopic(newTopic);
        },
    });

    // 自动话题检测：messages 变化时重新推断（仅在无手动话题时更新显示）
    useEffect(() => {
        if (messages.length === 0) return;
        const detected = inferAutoTopic({ messages, activeEvents });
        setAutoDetectedTopic(detected);
    }, [messages, activeEvents]);

    // ==================== 四槽位方案：回复上下文 + 模板槽位 ====================
    // 根据消息、当前话题、事件推导出 reply 上下文（driving templateDeck + op3/op4 生成）
    const resolveReplyContext = useCallback(() => {
        const lastIncoming = getLatestIncomingMessage(messages);
        if (!lastIncoming && !currentTopic) return null;
        const text = lastIncoming?.text || '';
        const topicSeed = currentTopic || autoDetectedTopic;
        const topicMeta = resolveTopicContext({
            topic_group: topicSeed?.topic_group || topicSeed?.topic_key || null,
            intent_key: topicSeed?.intent_key || null,
            scene_key: topicSeed?.scene_key || null,
            text,
            trigger: topicSeed?.trigger || 'auto',
            detected_at: topicSeed?.detected_at || Date.now(),
            custom_topic_label: topicSeed?.custom_topic_label || '',
            custom_template_text: topicSeed?.custom_template_text || '',
            custom_template_id: topicSeed?.custom_template_id || null,
            custom_template_media_items: topicSeed?.custom_template_media_items || [],
        });
        return {
            incomingMsg: lastIncoming || null,
            topic_group: topicMeta.topic_group,
            intent_key: topicMeta.intent_key,
            scene_key: topicMeta.scene_key,
            operator: creator?.wa_owner || client?.wa_owner || null,
            messages,
            activeEvents,
            lifecycle: creator?._full?.lifecycle || creator?.lifecycle || null,
            topicMeta,
        };
    }, [activeEvents, autoDetectedTopic, client?.wa_owner, creator, currentTopic, messages]);

    const loadTemplateDeck = useCallback(async (replyContext) => {
        if (!client?.phone || !replyContext) {
            setTemplateDeck(null);
            setTemplateError(null);
            return;
        }
        setTemplateLoading(true);
        setTemplateError(null);
        try {
            const data = await fetchJsonOrThrow(`${API_BASE}/experience/retrieve-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: client.phone,
                    operator: replyContext.operator,
                    scene: replyContext.scene_key,
                    topic_group: replyContext.topic_group,
                    intent_key: replyContext.intent_key,
                    user_message: replyContext.incomingMsg?.text || '',
                    recent_messages: (messages || []).slice(-8).map((m) => ({
                        role: m?.role === 'me' ? 'assistant' : 'user',
                        text: String(m?.text || '').trim(),
                        timestamp: m?.timestamp || null,
                    })).filter((m) => m.text),
                    current_topic: currentTopic ? {
                        topic_key: currentTopic.topic_key,
                        topic_group: currentTopic.topic_group,
                        intent_key: currentTopic.intent_key,
                        scene_key: currentTopic.scene_key,
                        trigger: currentTopic.trigger,
                        label: currentTopic.label,
                        custom_topic_label: currentTopic.custom_topic_label,
                        custom_template_text: currentTopic.custom_template_text,
                        custom_template_id: currentTopic.custom_template_id,
                        custom_template_media_items: currentTopic.custom_template_media_items || [],
                    } : null,
                    auto_detected_topic: autoDetectedTopic ? {
                        topic_key: autoDetectedTopic.topic_key,
                        topic_group: autoDetectedTopic.topic_group,
                        intent_key: autoDetectedTopic.intent_key,
                        scene_key: autoDetectedTopic.scene_key,
                        confidence: autoDetectedTopic.confidence,
                    } : null,
                    active_events: activeEvents,
                    lifecycle: creator?._full?.lifecycle || creator?.lifecycle || null,
                    force_template_sources: true,
                }),
                signal: AbortSignal.timeout(10000),
            });
            setTemplateDeck(data || null);
        } catch (e) {
            console.error('[templateDeck] error:', e);
            setTemplateDeck(null);
            setTemplateError(e.message || '模板加载失败');
        } finally {
            setTemplateLoading(false);
        }
    }, [activeEvents, autoDetectedTopic, client?.phone, creator, currentTopic, messages]);

    const replyContextSignature = useMemo(() => JSON.stringify({
        clientPhone: client?.phone || null,
        latestIncomingKey: getMessageKey(getLatestIncomingMessage(messages)) || null,
        currentTopic: currentTopic ? [currentTopic.topic_key, currentTopic.intent_key, currentTopic.scene_key, currentTopic.trigger, currentTopic.custom_topic_label, currentTopic.custom_template_text, currentTopic.custom_template_id, currentTopic.custom_template_media_items?.length || 0] : null,
        autoTopic: autoDetectedTopic ? [autoDetectedTopic.topic_key, autoDetectedTopic.intent_key, autoDetectedTopic.scene_key, autoDetectedTopic.confidence] : null,
        activeEventKeys: (activeEvents || []).filter((e) => e?.status === 'active').map((e) => String(e?.event_key || '')),
    }), [activeEvents, autoDetectedTopic, client?.phone, currentTopic, messages]);

    useEffect(() => {
        // signature 发生变化（新来信 / 切 topic / 切 creator）→ 恢复 deck；
        // 只要 signature 没变化，就尊重用户按过的关闭按钮。
        if (dismissedReplySignature && dismissedReplySignature !== replyContextSignature) {
            setDismissedReplySignature(null);
        }
        if (dismissedReplySignature === replyContextSignature) {
            return;
        }
        const nextContext = resolveReplyContext();
        setActiveReplyContext(nextContext);
        // 切话题 / 新 incoming → 清 AI 槽位并刷新模板槽位（op3/op4 仍需手动点 🤖 才生成）
        setActivePicker(null);
        setPickerError(null);
        if (nextContext) {
            loadTemplateDeck(nextContext);
        } else {
            setTemplateDeck(null);
            setTemplateError(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [replyContextSignature]);

    // 从对话中提取并保存客户偏好
    const extractAndSaveMemory = async (incomingMsg, sentText) => {
        if (!client?.phone) return;
        const texts = [incomingMsg?.text || '', sentText || ''].join(' ').toLowerCase();

        const extractions = [];

        // preference 类型
        if (/\b(prefer|更喜欢|比较喜欢|like\s+(?:video|text|voice|audio))\b/.test(texts)) {
            if (/\bvideo\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'video' });
            if (/\btext\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'text' });
            if (/\b(voice|audio|call)\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'voice' });
        }
        if (/\b(don't like|不喜欢|prefer not|不想)\b/.test(texts)) {
            extractions.push({ memory_type: 'preference', memory_key: 'dislike', memory_value: 'inquiry' });
        }

        // style 类型
        if (/\b(please|would|could|kindly)\b/.test(texts)) {
            extractions.push({ memory_type: 'style', memory_key: 'tone', memory_value: 'formal' });
        }
        if (/\b(hey|great|awesome|cool|yeah|thanks?)\b/.test(texts)) {
            extractions.push({ memory_type: 'style', memory_key: 'tone', memory_value: 'casual' });
        }

        // decision 类型
        if (/\b(decide[sd]?|chose|going with|选择了|决定)\b/.test(texts)) {
            extractions.push({ memory_type: 'decision', memory_key: 'latest', memory_value: 'pending_review' });
        }

        // policy 类型
        if (/\b(policy|规则|不能|must not|cannot)\b/.test(texts)) {
            extractions.push({ memory_type: 'policy', memory_key: 'constraint', memory_value: 'mentioned' });
        }

        // 保存到 client_memory
        for (const mem of extractions) {
            try {
                await fetchOkOrThrow(`${API_BASE}/client-memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: client.phone, ...mem }),
                    signal: AbortSignal.timeout(15000),
                });
            } catch (_) {}
        }
    };

    // 插入 emoji 到 textarea 光标位置
    const handleEmojiClick = (emojiData) => {
        const emoji = emojiData.emoji;
        const textarea = inputRef.current;
        if (!textarea) {
            setInputText(prev => prev + emoji);
            return;
        }
        const { selectionStart, selectionEnd } = textarea;
        const before = inputText.slice(0, selectionStart);
        const after = inputText.slice(selectionEnd);
        const newText = before + emoji + after;
        setInputText(newText);
        // 光标移到 emoji 后
        setTimeout(() => {
            textarea.focus();
            const newPos = selectionStart + emoji.length;
            textarea.setSelectionRange(newPos, newPos);
        }, 0);
        setEmojiPickerOpen(false);
    };

    const handlePickImage = () => {
        mediaInputRef.current?.click();
    };

    const handleImageFileChange = (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        const mimeType = String(file.type || '').toLowerCase();
        if (!mimeType.startsWith('image/')) {
            toast.warning('仅支持图片文件（jpg/png/webp/gif）');
            if (mediaInputRef.current) mediaInputRef.current.value = '';
            return;
        }
        if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
            toast.warning(`图片过大：${formatBytes(file.size)}，上限 ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)}`);
            if (mediaInputRef.current) mediaInputRef.current.value = '';
            return;
        }
        setPendingImage((prev) => {
            if (prev?.previewUrl) {
                try {
                    URL.revokeObjectURL(prev.previewUrl);
                } catch (_) {}
            }
            return {
                file,
                previewUrl: URL.createObjectURL(file),
                fileName: file.name || `image_${Date.now()}`,
                mimeType,
                size: file.size || 0,
            };
        });
    };

    /**
     * 发送图片(可选 caption)。支持乐观 UI:
     *   1. 发送前立刻插入带 previewUrl 的"发送中"气泡,输入框/附件区同步清空。
     *   2. 成功:把 pending 气泡原地替换为 server 确认的 media_url + mime/file_name,
     *      保留 clientId,避免 polling 重复插入;随后 revoke 本地 blob URL。
     *   3. 失败:把 pending 气泡翻成 failed 态(保留 previewUrl + File 原件),用户
     *      可点"重试"重新走一遍上传/发送流程。
     *
     * __mediaFile 是只存在于内存中的字段(非 DB 持久化),供 retry 使用。
     */
    const handleDirectSendMedia = async () => {
        if (!pendingImage?.file || !client?.phone) return;
        if (sendLockRef.current) return;

        // 快照 + 同步清空 pendingImage 状态,但不 revoke blob URL — 所有权交给 optimistic 气泡。
        const snapshot = {
            file: pendingImage.file,
            previewUrl: pendingImage.previewUrl,
            fileName: pendingImage.fileName,
            mimeType: pendingImage.mimeType,
        };
        const caption = (inputText || '').trim();
        setPendingImage(null);
        setInputText('');

        await sendMediaOptimistic(snapshot, caption);
    };

    /**
     * 乐观发送实现。retry 场景也复用:会收到一个已有 clientId 的 failed 气泡
     * 被上层删掉之后再次调用,所以每次都重新生成 clientId + 插入新气泡。
     */
    const sendMediaOptimistic = async (snapshot, caption) => {
        const { file, previewUrl, fileName, mimeType } = snapshot;
        if (!file || !client?.phone) return;

        sendLockRef.current = true;
        setSendingMedia(true);

        const clientId = `pending_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const pendingAt = Date.now();
        const placeholderText = caption ? `🖼️ [Image] ${caption}` : '🖼️ [Image]';

        setMessages(prev => [...prev, {
            role: 'me',
            text: placeholderText,
            caption,
            timestamp: pendingAt,
            clientId,
            message_key: clientId,
            previewUrl,
            file_name: fileName || null,
            mime_type: mimeType || 'image/*',
            pending: true,
            // 仅内存中保留,供失败后"重试"重新走完整上传/发送
            __mediaFile: file,
            __mediaMime: mimeType,
            __mediaFileName: fileName,
            __caption: caption,
        }]);
        setMessageTotal(prev => prev + 1);

        const markFailed = (errorMsg) => {
            setMessages(prev => prev.map(m => m.clientId === clientId
                ? { ...m, pending: false, failed: true, failedReason: errorMsg }
                : m));
        };

        try {
            const dataBase64 = await fileToDataUrl(file);
            const uploadRes = await fetchWaAdmin(`${API_BASE}/wa/media-assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creator_id: client.id,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    uploaded_by: creator?.wa_owner || client.wa_owner || 'api_user',
                    file_name: fileName,
                    mime_type: mimeType,
                    data_base64: dataBase64,
                    meta: { source: 'manual_upload', scene: currentTopic?.topic_key || null },
                }),
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok || !uploadData?.ok || !uploadData?.media_asset?.id) {
                throw new Error(uploadData?.error || `upload failed: HTTP ${uploadRes.status}`);
            }

            const sendRes = await fetchWaAdmin(`${API_BASE}/wa/send-media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: client.phone,
                    creator_id: client.id,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    session_id: creator?.session_id || client.session_id || null,
                    media_id: uploadData.media_asset.id,
                    caption,
                    sent_by: creator?.wa_owner || client.wa_owner || 'api_user',
                }),
            });
            const sendData = await sendRes.json();
            if (!sendRes.ok || !sendData?.ok) {
                throw new Error(sendData?.error || `send media failed: HTTP ${sendRes.status}`);
            }

            const crmMessage = sendData?.crm_message || null;
            const timelineText = crmMessage?.text
                || (caption ? `🖼️ [Image] ${caption}` : '🖼️ [Image]');
            const sentAt = Number(crmMessage?.timestamp) > 0
                ? Number(crmMessage.timestamp)
                : Date.now();
            if (!crmMessage) {
                await persistCrmSentMessage(timelineText, sentAt);
            }

            // 原地替换 pending 气泡:server 字段覆盖 + 清掉 optimistic 专用 __* 字段。
            // clientId 保留用于 dedup;message_key 取 server(若有)覆盖掉 clientId,
            // 让下次 polling 走同一个 key 合并。
            setMessages(prev => prev.map(m => m.clientId === clientId
                ? {
                    ...(crmMessage || {}),
                    role: 'me',
                    text: timelineText,
                    caption,
                    timestamp: sentAt,
                    clientId,
                    pending: false,
                    failed: false,
                    media_url: uploadData?.media_asset?.file_url || crmMessage?.media_url || null,
                    mime_type: uploadData?.media_asset?.mime_type || mimeType || null,
                    file_name: uploadData?.media_asset?.file_name || fileName || null,
                    // previewUrl 保留一会儿,让替换不闪;revoke 放到下面 setTimeout
                    previewUrl,
                }
                : m));
            // server 确认后再 revoke blob URL,避免短暂的白屏
            setTimeout(() => {
                try { URL.revokeObjectURL(previewUrl); } catch (_) {}
            }, 1500);

            invalidateMessagesCache(client?.id);
            if (caption) {
                await extractAndSaveMemory(null, caption);
            }
            onMessageSent?.(client.id);
        } catch (e) {
            console.error('[WA Send Media] failed:', e);
            const msg = e?.message || '未知错误';
            markFailed(msg);
            toast.error(`发送图片失败: ${msg}`);
        } finally {
            sendLockRef.current = false;
            setSendingMedia(false);
        }
    };

    const sendTemplateMediaItem = useCallback(async (item, caption = '') => {
        const url = String(item?.url || item?.file_url || '').trim();
        if (!url || !client?.phone) return;
        if (sendLockRef.current) return;
        try {
            const resolvedUrl = url.startsWith('/')
                ? new URL(url, window.location.origin).toString()
                : url;
            const response = await fetch(resolvedUrl);
            if (!response.ok) throw new Error(`image fetch failed: HTTP ${response.status}`);
            const blob = await response.blob();
            const mimeType = blob.type || 'image/png';
            if (!String(mimeType).startsWith('image/')) throw new Error('素材不是图片');
            if (blob.size > MAX_IMAGE_UPLOAD_BYTES) {
                throw new Error(`图片过大：${formatBytes(blob.size)}，上限 ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)}`);
            }
            const fallbackName = String(url).split('/').filter(Boolean).pop() || `template_image_${Date.now()}.png`;
            const fileName = item?.label
                ? `${String(item.label).replace(/[^\w.-]+/g, '_')}.${String(mimeType).split('/')[1] || 'png'}`
                : fallbackName;
            const file = new File([blob], fileName, { type: mimeType });
            await sendMediaOptimistic({
                file,
                previewUrl: URL.createObjectURL(file),
                fileName,
                mimeType,
            }, caption);
        } catch (e) {
            toast.error(`发送模板图片失败：${e.message || '未知错误'}`);
        }
    }, [client?.phone, sendMediaOptimistic, toast]);

    // 点了 bot 图标 → 强制为最新 incoming 消息重新生成候选
    const handleBotIconClick = async () => {
        // 读最新 messages（SSE/增量拉已同步进 state；messagesRef 与 state 实时对齐）
        const freshMsgs = messagesRef.current;
        const incomingMsgs = freshMsgs.filter(m => m.role === 'user');
        const latestMsg = incomingMsgs[incomingMsgs.length - 1];
        if (!latestMsg) return;

        // 用户主动点 🤖 → 解除"已关闭"状态，让 activeReplyContext useEffect 重新挂 deck
        setDismissedReplySignature(null);
        setActivePicker(null);
        setPendingCandidates([]);
        setPickerLoading(true);

        try {
            const conversation = buildConversation(freshMsgs);
            const result = await generateViaExperienceRouter({
                conversation,
                client_id: client.phone,
                client,
                creator,
                policyDocs,
                clientMemory,
                agencyStrategies,
                currentTopic,
                autoDetectedTopic,
                setCurrentTopic,
            });
            setActivePicker({
                incomingMsg: latestMsg,
                candidates: result,
                systemPrompt: result.systemPrompt,
                systemPromptVersion: result.systemPromptVersion,
                operator: result.operator,
                operatorDisplayName: result.operatorDisplayName,
                operatorConfigured: result.operatorConfigured,
                scene: result.scene,
                topicGroup: result.topicGroup || null,
                intentKey: result.intentKey || null,
                sceneSource: result.sceneSource || null,
                retrievalSnapshotId: result.retrievalSnapshotId || null,
                generationLogId: result.generationLogId || null,
                provider: result.provider || null,
                model: result.model || null,
                pipelineVersion: result.pipelineVersion || 'reply_generation_v2',
                generated_at: Date.now(),
                policyDocs,
            });
            // 标记：这条 incoming 已手动生成过，后续 5s 轮询不再自动重复生成
            lastGeneratedKeyRef.current = getMessageKey(latestMsg);
        } catch (e) {
            console.error('[Regenerate] error:', e);
        } finally {
            setPickerLoading(false);
        }
    };

    // 翻译最近20条消息（一次批量请求），翻译结果显示在对应气泡下方
    const handleTranslate = async () => {
        const last20 = messages.slice(-20);
        if (last20.length === 0) return;
        // 如果已有翻译，先清除（切换时重新翻译）
        if (Object.keys(translationMap).length > 0) {
            setTranslationMap({});
            setTranslateProgress(null);
            return;
        }
        setTranslating(true);
        setTranslateProgress('0/' + last20.length);
        try {
            const response = await fetchAppAuth(`${API_BASE}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    texts: last20.map(m => ({ text: m.text, role: m.role })),
                    mode: 'auto',
                    provider: 'deepl',
                }),
                signal: AbortSignal.timeout(60000),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
            }
            const newMap = {};
            if (data.translations && Array.isArray(data.translations)) {
                for (const t of data.translations) {
                    const idx = t.idx - 1; // idx 是 1-based
                    if (idx >= 0 && idx < last20.length) {
                        const key = getTranslationKey(last20[idx], `translate_${idx}`);
                        const translated = String(t.translation || '').trim();
                        const original = String(last20[idx].text || '').trim();
                        if (translated && translated !== original) {
                            newMap[key] = translated;
                        }
                    }
                }
            }
            setTranslateProgress(`${last20.length}/${last20.length}`);
            setTranslationMap(newMap);
        } catch (e) {
            console.error('[Translate] batch error:', e);
            setTranslationMap({});
            setTranslateProgress(null);
        } finally {
            setTranslating(false);
        }
    };

    const handleTranslateMessage = async (message) => {
        const key = message?.translationKey || getTranslationKey(message);
        const source = String(message?.text || '').trim();
        if (!key || !source) return;

        if (translationMap[key]) {
            setTranslationMap((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
            return;
        }

        setTranslatingMessageKey(key);
        try {
            const response = await fetchAppAuth(`${API_BASE}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: source,
                    mode: 'auto',
                    provider: 'deepl',
                }),
                signal: AbortSignal.timeout(30000),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
            }
            const translation = String(data?.translation || '').trim();
            if (!translation || translation === source) {
                toast.warning('这条消息没有可显示的译文');
                return;
            }
            setTranslationMap((prev) => ({ ...prev, [key]: translation }));
        } catch (e) {
            console.error('[TranslateMessage] error:', e);
            toast.error(`单条翻译失败：${e.message || '未知错误'}`);
        } finally {
            setTranslatingMessageKey(null);
        }
    };

    // 主输入框独立翻译（走 DeepL，与"生成候选"解耦）
    //   - 无翻译快照时：把 inputText 翻译后写回 textarea
    //   - 有翻译快照且 inputText 与上次译文一致：视为 undo，还原原文
    //   - 用户手动编辑过译文（inputText !== lastTranslatedInputText）：视为一次新的翻译，不做 undo
    const handleTranslateInput = async () => {
        if (translatingInput || writeBlocked) return;

        // Undo 分支：当前 inputText 正好是上次的译文 → 还原
        if (
            inputOriginalBeforeTranslate !== null &&
            lastTranslatedInputText !== null &&
            inputText === lastTranslatedInputText
        ) {
            setInputText(inputOriginalBeforeTranslate);
            setInputOriginalBeforeTranslate(null);
            setLastTranslatedInputText(null);
            return;
        }

        const source = inputText.trim();
        if (!source) return;

        setTranslatingInput(true);
        const snapshot = inputText;
        try {
            const response = await fetchAppAuth(`${API_BASE}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: source,
                    mode: 'auto',
                    provider: 'deepl',
                }),
                signal: AbortSignal.timeout(30000),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            const translation = String(data?.translation || '').trim();
            if (!translation || translation === snapshot) {
                // 译文与原文一致（DeepL 认定无需翻译） — 不视为"已翻译"状态，避免下次 undo 触发
                return;
            }
            setInputOriginalBeforeTranslate(snapshot);
            setLastTranslatedInputText(translation);
            setInputText(translation);
        } catch (e) {
            console.error('[TranslateInput] error:', e);
        } finally {
            setTranslatingInput(false);
        }
    };

    // 重新生成（picker 内部的刷新按钮）
    const handleRegenerate = async () => {
        const incomingMsg = activePicker?.incomingMsg || (() => {
            const incomingMsgs = messages.filter(m => m.role === 'user');
            return incomingMsgs[incomingMsgs.length - 1];
        })();
        if (!incomingMsg) return;

        setPickerLoading(true);
        setPickerError(null);
        try {
            const conversation = buildConversation(messages);
            const result = await generateViaExperienceRouter({
                conversation,
                client_id: client.phone,
                client,
                creator,
                policyDocs,
                clientMemory,
                agencyStrategies,
                currentTopic,
                autoDetectedTopic,
                setCurrentTopic,
            });
            setActivePicker(prev => ({
                ...prev,
                incomingMsg,
                candidates: result,
                systemPrompt: result.systemPrompt,
                systemPromptVersion: result.systemPromptVersion,
                operator: result.operator,
                operatorDisplayName: result.operatorDisplayName,
                operatorConfigured: result.operatorConfigured,
                scene: result.scene,
                sceneSource: result.sceneSource || null,
                retrievalSnapshotId: result.retrievalSnapshotId || null,
                generationLogId: result.generationLogId || null,
                provider: result.provider || null,
                model: result.model || null,
                pipelineVersion: result.pipelineVersion || 'reply_generation_v2',
                generated_at: Date.now(),
                policyDocs,
            }));
        } catch (e) {
            console.error('[Regenerate] error:', e);
            setPickerError(e.message || '生成失败，请重试');
        } finally {
            setPickerLoading(false);
        }
    };

    // 主输入框 Emoji 润色:读 inputText,走 AI 润色后写回 inputText。
    // 翻译走已有的 handleTranslateInput(DeepL + undo 支持),本函数只做 emoji。
    const handleEmojiInput = async () => {
        if (emojiEnhancingInput || translatingInput || writeBlocked) return;
        const sourceText = (inputText || '').trim();
        if (!sourceText) return;

        setEmojiEnhancingInput(true);
        try {
            const systemPrompt = [
                '你是 WhatsApp 客服文案润色助手。',
                '任务：在不改变原意的前提下，为文本添加自然 emoji 风格。',
                '规则：',
                '1) 保持原语言，不翻译。',
                '2) 总共只加 1-3 个 emoji，每句最多 1 个。',
                '3) 不改变承诺、价格、时限等业务事实。',
                '4) 只输出改写后的文本，不要解释。',
            ].join('\n');

            const response = await fetchAppAuth(`${API_BASE}/ai/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt,
                    messages: [{ role: 'user', content: sourceText }],
                    temperatures: [0.2, 0.4],
                }),
                signal: AbortSignal.timeout(30000),
            });
            const data = await response.json();
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }

            const transformed = String(data?.candidates?.opt1 || '').trim();
            if (transformed) setInputText(transformed);
        } catch (e) {
            console.error('[EmojiInput] error:', e);
            toast.error(`Emoji 润色失败：${e.message || '未知错误'}`);
        } finally {
            setEmojiEnhancingInput(false);
        }
    };

    const persistCrmSentMessage = async (sentText, sentAt) => {
        try {
            await fetchOkOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: 'me',
                    text: sentText,
                    timestamp: sentAt
                }),
                signal: AbortSignal.timeout(15000),
            });
        } catch (e) {
            console.error('[CRM DB] 保存失败:', e);
        }
    };

    const reloadMessagesFromApi = useCallback(async () => {
        if (!client?.id) return [];
        const data = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
            signal: AbortSignal.timeout(15000),
        });
        const { msgs, total } = unpackMessageResponse(data);
        setMessages(msgs);
        setMessageTotal(total);
        setLoadedServerCount(msgs.length);
        const latestTs = getLatestMessageTimestamp(msgs);
        if (latestTs > 0) lastActivityRef.current = latestTs;
        return msgs;
    }, [client?.id, unpackMessageResponse]);

    const loadOlderMessages = useCallback(async () => {
        if (!client?.id || loadingOlder) return;
        if (loadedServerCount >= messageTotal) return;

        const container = chatScrollRef.current;
        const previousHeight = container?.scrollHeight || 0;
        const previousTop = container?.scrollTop || 0;

        setLoadingOlder(true);
        try {
            const data = await fetchJsonOrThrow(
                `${API_BASE}/creators/${client.id}/messages?limit=100&offset=${loadedServerCount}`,
                { signal: AbortSignal.timeout(20000) }
            );
            const { msgs, total } = unpackMessageResponse(data);
            if (msgs.length === 0) {
                setMessageTotal(total);
                return;
            }

            prependInFlightRef.current = true;
            setMessages((prev) => mergeChronologicalMessages(msgs, prev));
            setMessageTotal(total);
            setLoadedServerCount((prev) => prev + msgs.length);

            requestAnimationFrame(() => {
                const node = chatScrollRef.current;
                if (!node) return;
                const delta = node.scrollHeight - previousHeight;
                node.scrollTop = previousTop + delta;
                prependInFlightRef.current = false;
            });
        } catch (e) {
            console.error('[loadOlderMessages] error:', e);
        } finally {
            setLoadingOlder(false);
        }
    }, [client?.id, loadedServerCount, loadingOlder, messageTotal, unpackMessageResponse]);

    const reloadCreatorDetail = useCallback(async () => {
        if (!client?.id) return null;
        const detail = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}`, {
            signal: AbortSignal.timeout(15000),
        });
        onCreatorUpdated?.(detail);
        if (Number.isFinite(Number(detail?.msg_count))) {
            setMessageTotal(Number(detail.msg_count));
        }
        return detail;
    }, [client?.id, onCreatorUpdated]);

    const handleRepairMessages = async () => {
        if (!client?.id || !client?.phone) return;
        setRepairingMessages(true);
        setLastRepairSummary(null);
        try {
            const payload = {
                creator_id: client.id,
                phone: client.phone,
                operator: creator?.wa_owner || client.wa_owner || null,
                session_id: creator?.session_id || client.session_id || null,
                fetch_limit: 500,
            };
            let res = await fetchWaAdmin(`${API_BASE}/wa/repair-baileys-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            let data = await res.json();
            if (!res.ok && /requires baileys driver/i.test(String(data?.error || ''))) {
                res = await fetchWaAdmin(`${API_BASE}/wa/reconcile-contact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                data = await res.json();
            }
            if (!res.ok || !data?.ok) {
                if (data?.error === 'session syncing') {
                    throw new Error('后台正在全量同步中，请稍后再试');
                }
                throw new Error(data?.error || `HTTP ${res.status}`);
            }

            if (data?.queued) {
                setLastRepairSummary({
                    checked: 0,
                    inserted: 0,
                    updated: 0,
                    deleted: 0,
                    sessionId: data.routed_session_id || null,
                    queued: true,
                    lastActive: null,
                });
                return;
            }

            const freshMsgs = await reloadMessagesFromApi();
            const detail = await reloadCreatorDetail().catch(() => null);
            const summary = data.reconciliation || {};
            setLastRepairSummary({
                checked: summary.checked_messages || 0,
                inserted: summary.inserted_count || 0,
                updated: summary.updated_count || 0,
                deleted: summary.deleted_count || 0,
                sessionId: data.routed_session_id || null,
                lastActive: detail?.last_active || getLatestMessageTimestamp(freshMsgs),
            });
        } catch (e) {
            console.error('[repairMessages] error:', e);
            toast.error(`修复消息失败: ${e.message || '未知错误'}`);
        } finally {
            setRepairingMessages(false);
        }
    };

    const handleIncrementalSync = async () => {
        if (!client?.id || !client?.phone) return;
        setSyncingMessages(true);
        setLastSyncSummary(null);
        try {
            const res = await fetchWaAdmin(`${API_BASE}/wa/sync-contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creator_id: client.id,
                    phone: client.phone,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    session_id: creator?.session_id || client.session_id || null,
                    fetch_limit: 200,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data?.ok) {
                if (data?.error === 'session syncing') {
                    throw new Error('后台正在全量同步中，请稍后再试');
                }
                throw new Error(data?.error || `HTTP ${res.status}`);
            }

            const freshMsgs = await reloadMessagesFromApi();
            const detail = await reloadCreatorDetail().catch(() => null);
            const summary = data.synchronization || {};
            setLastSyncSummary({
                checked: summary.checked_messages || 0,
                inserted: summary.inserted_count || 0,
                skipped: summary.skipped_count || 0,
                sessionId: data.routed_session_id || null,
                lastActive: detail?.last_active || getLatestMessageTimestamp(freshMsgs),
            });
        } catch (e) {
            console.error('[incrementalSync] error:', e);
            toast.error(`增量更新失败: ${e.message || '未知错误'}`);
        } finally {
            setSyncingMessages(false);
        }
    };

    const sendOutboundMessage = async (sentText, { onError } = {}) => {
        const reportError = onError || ((message) => toast.error(`发送失败: ${message}`));

        // 生成 clientId，乐观插入 pending 气泡到聊天列表
        // message_key 同时设为 clientId，避免 polling/SSE 回来的同文本消息被 merge 判为不同条
        const clientId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const pendingAt = Date.now();
        setMessages(prev => [...prev, {
            role: 'me',
            text: sentText,
            timestamp: pendingAt,
            clientId,
            message_key: clientId,
            pending: true,
        }]);
        setMessageTotal((prev) => prev + 1);

        const markFailed = (errorMsg) => {
            setMessages(prev => prev.map(m => m.clientId === clientId
                ? { ...m, pending: false, failed: true, failedReason: errorMsg }
                : m));
        };

        let data;
        try {
            const res = await fetchWaAdmin(`${API_BASE}/wa/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: client.phone,
                    text: sentText,
                    creator_id: client.id,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    session_id: creator?.session_id || client.session_id || null,
                })
            });
            data = await res.json();
            if (!data.ok) {
                markFailed(data.error || '未知错误');
                reportError(data.error || '未知错误');
                return { ok: false, error: data.error || '未知错误', clientId };
            }
        } catch (e) {
            console.error('[WA Send] 发送失败:', e);
            markFailed(e.message || '请求失败');
            reportError(e.message || '请求失败');
            return { ok: false, error: e.message || '请求失败', clientId };
        }

        const crmMessage = data?.crm_message || null;
        const sentAt = Number(crmMessage?.timestamp) > 0
            ? Number(crmMessage.timestamp)
            : Date.now();
        if (!crmMessage) {
            await persistCrmSentMessage(sentText, sentAt);
        }
        // 把 pending 气泡原地替换为 server 确认后的消息；clientId 留下防止 polling 再次插入
        setMessages(prev => prev.map(m => m.clientId === clientId
            ? {
                ...(crmMessage || {}),
                role: 'me',
                text: crmMessage?.text || sentText,
                timestamp: sentAt,
                clientId,
                pending: false,
                failed: false,
            }
            : m));
        invalidateMessagesCache(client?.id);
        onMessageSent?.(client.id);
        return { ok: true, sentAt, crmMessage, clientId };
    };

    const persistSftRecord = async ({
        sentText,
        incomingMsg = null,
        modelCandidates,
        humanSelected,
        diffAnalysis,
        extraContext = null,
        promptUsed = null,
        promptVersion = 'v2',
        retrievalSnapshotId = null,
        generationLogId = null,
        provider = null,
        model = null,
        sceneSource = null,
        pipelineVersion = null,
    }) => {
        try {
            const richContext = buildRichContext({
                incomingMsg,
                client,
                creator,
                policyDocs: activePicker?.policyDocs || policyDocs,
                clientMemory,
                agencyStrategies,
                messages,
            });

            await fetchOkOrThrow(`${API_BASE}/sft-memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_candidates: modelCandidates,
                    human_selected: humanSelected,
                    human_output: sentText,
                    diff_analysis: diffAnalysis,
                    context: {
                        ...richContext,
                        ...(extraContext || {}),
                        retrieval_snapshot_id: retrievalSnapshotId,
                        generation_log_id: generationLogId,
                        provider,
                        model,
                        scene_source: sceneSource,
                        pipeline_version: pipelineVersion,
                    },
                    messages,
                    system_prompt_used: promptUsed,
                    system_prompt_version: promptVersion,
                    retrieval_snapshot_id: retrievalSnapshotId,
                    generation_log_id: generationLogId,
                    provider,
                    model,
                    scene_source: sceneSource,
                    pipeline_version: pipelineVersion,
                }),
                signal: AbortSignal.timeout(15000),
            });
        } catch (e) {
            console.error('[SFT] record failed:', e);
        }
    };

    // 选择了候选 → 发送（支持模板槽位 op1/op2 + AI 槽位 op3/op4 + 自定义）
    const handleSelectCandidate = async (selectedOpt, payload = null) => {
        if (sendLockRef.current) return;
        const selectedTemplate = selectedOpt === 'template_op1'
            ? templateDeck?.slots?.op1
            : selectedOpt === 'template_op2'
                ? templateDeck?.slots?.op2
                : null;
        const selectedAi = selectedOpt === 'opt1'
            ? activePicker?.candidates?.opt1
            : selectedOpt === 'opt2'
                ? activePicker?.candidates?.opt2
                : null;
        // 'custom' 分支从主输入框取文,不再维护单独的 picker 内 textarea
        const sentText = selectedTemplate?.text
            || selectedAi
            || (inputText || '').trim();

        if (!sentText) return;

        setPickerError(null);
        sendLockRef.current = true;
        setSendingText(true);
        try {
        const sendResult = await sendOutboundMessage(sentText, {
            onError: (message) => setPickerError(message),
        });
        if (!sendResult?.ok) return;

        const sim1 = computeSimilarity(activePicker?.candidates?.opt1 || '', sentText);
        const sim2 = computeSimilarity(activePicker?.candidates?.opt2 || '', sentText);
        const bestSim = Math.max(sim1, sim2);
        const bestOpt = sim1 >= sim2 ? 'opt1' : 'opt2';
        const isTemplateSelection = selectedOpt === 'template_op1' || selectedOpt === 'template_op2';
        const resolvedHumanSelected = isTemplateSelection || selectedOpt === 'custom' ? 'custom' : selectedOpt;
        const isCustomSelection = isTemplateSelection || selectedOpt === 'custom' || bestSim < 85;

        const diffAnalysis = {
            model_predicted: bestSim >= 85 ? activePicker?.candidates?.[bestOpt] || null : null,
            model_rejected: bestSim >= 85 ? activePicker?.candidates?.[bestOpt === 'opt1' ? 'opt2' : 'opt1'] || null : null,
            is_custom: isCustomSelection,
            human_reason: isCustomSelection
                ? isTemplateSelection
                    ? `模板槽位${selectedOpt === 'template_op1' ? 'op1' : 'op2'}发送`
                    : `人工编辑发送（与AI候选最高相似度${bestSim}%）`
                : `直接采用方案${selectedOpt === 'opt1' ? 'A' : 'B'}（相似度${bestSim}%）`,
            similarity: bestSim
        };

        await persistSftRecord({
            sentText,
            incomingMsg: activeReplyContext?.incomingMsg || activePicker?.incomingMsg || null,
            modelCandidates: { opt1: activePicker?.candidates?.opt1 || null, opt2: activePicker?.candidates?.opt2 || null },
            humanSelected: resolvedHumanSelected,
            diffAnalysis,
            extraContext: {
                topic_group: activeReplyContext?.topic_group || activePicker?.topicGroup || null,
                intent_key: activeReplyContext?.intent_key || activePicker?.intentKey || null,
                scene_key: activeReplyContext?.scene_key || activePicker?.scene || null,
                template_slot_used: isTemplateSelection ? selectedOpt.replace('template_', '') : null,
                template_section_id: selectedTemplate?.section_id || payload?.slot?.section_id || null,
                template_source: selectedTemplate?.source || payload?.slot?.source || null,
                template_section_ids: [
                    templateDeck?.slots?.op1?.section_id || null,
                    templateDeck?.slots?.op2?.section_id || null,
                ].filter(Boolean),
            },
            promptUsed: activePicker?.systemPrompt || null,
            promptVersion: activePicker?.systemPromptVersion || 'v2',
            retrievalSnapshotId: activePicker?.retrievalSnapshotId || null,
            generationLogId: activePicker?.generationLogId || null,
            provider: activePicker?.provider || null,
            model: activePicker?.model || null,
            sceneSource: activePicker?.sceneSource || null,
            pipelineVersion: activePicker?.pipelineVersion || 'reply_generation_v2',
        });

        await extractAndSaveMemory(activeReplyContext?.incomingMsg || activePicker?.incomingMsg || null, sentText);

        setActivePicker(null);
        setInputText('');
        } finally {
            sendLockRef.current = false;
            setSendingText(false);
        }
    };

    // 跳过 — 记录 feedback
    const handleSkip = async () => {
        // 记录 skip feedback（不阻塞 UI，失败静默忽略）
        if (activePicker?.incomingMsg) {
            fetchOkOrThrow(`${API_BASE}/sft-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: client.phone,
                    feedback_type: 'skip',
                    input_text: activePicker.incomingMsg.text,
                    opt1: activePicker.candidates?.opt1,
                    opt2: activePicker.candidates?.opt2,
                    scene: activePicker.scene || 'unknown',
                    reject_reason: '运营跳过 AI 候选，未提供原因',
                }),
                signal: AbortSignal.timeout(15000),
            }).catch(() => {});
        }
        setPickerError(null);

        // 如果还有排队候选就切到下一条；否则真正关闭整个 Reply Deck
        const [next, ...rest] = pendingCandidates;
        setPendingCandidates(rest);
        if (next) {
            setActivePicker(next);
            return;
        }
        setActivePicker(null);
        setActiveReplyContext(null);
        setTemplateDeck(null);
        setTemplateError(null);
        setDismissedReplySignature(replyContextSignature);
    };

    // 编辑候选 — 填充到输入框，关闭 picker
    const handleEditCandidate = (text) => {
        if (!text) return;
        setInputText(text);
        setActivePicker(null);
        setPendingCandidates([]);
        setPickerError(null);
    };

    // 手动 AI 生成（输入框有文字时按 Enter 触发）
    const handleManualGenerate = async () => {
        if (!inputText.trim()) return;
        if (sendLockRef.current) return;
        // 用户主动触发生成 → 解除"已关闭"状态
        setDismissedReplySignature(null);
        sendLockRef.current = true;
        setGenerating(true);
        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: inputText });
            const result = await generateViaExperienceRouter({
                conversation,
                client_id: client.phone,
                client,
                creator,
                policyDocs,
                clientMemory,
                agencyStrategies,
                currentTopic,
                autoDetectedTopic,
                setCurrentTopic,
            });

            setActivePicker({
                incomingMsg: { text: inputText, timestamp: Date.now() },
                candidates: result,
                systemPrompt: result.systemPrompt,
                systemPromptVersion: result.systemPromptVersion,
                operator: result.operator,
                operatorDisplayName: result.operatorDisplayName,
                operatorConfigured: result.operatorConfigured,
                scene: result.scene,
                topicGroup: result.topicGroup || null,
                intentKey: result.intentKey || null,
                sceneSource: result.sceneSource || null,
                retrievalSnapshotId: result.retrievalSnapshotId || null,
                generationLogId: result.generationLogId || null,
                provider: result.provider || null,
                model: result.model || null,
                pipelineVersion: result.pipelineVersion || 'reply_generation_v2',
                generated_at: Date.now(),
                policyDocs,
            });
        } catch (e) {
            console.error('生成失败:', e);
            toast.error(`生成失败: ${e.message || '未知错误'}`);
        } finally {
            sendLockRef.current = false;
            setGenerating(false);
        }
    };

    // 失败气泡的"重试"：先从列表中删掉这条 failed 消息，再走一遍发送流程
    const handleRetryFailedMessage = async (failedItem) => {
        if (!failedItem) return;
        if (sendLockRef.current) return;

        const isMediaRetry = !!failedItem.__mediaFile;
        if (!isMediaRetry && !failedItem.text) return;

        setMessages(prev => prev.filter(m => m.clientId !== failedItem.clientId));
        // 总条数在乐观插入时已 +1，这里先 -1，避免乐观重插时重复计数
        setMessageTotal(prev => Math.max(0, prev - 1));

        if (isMediaRetry) {
            // 媒体重试:复用 sendMediaOptimistic,自己已经管 lock/setSendingMedia
            await sendMediaOptimistic(
                {
                    file: failedItem.__mediaFile,
                    previewUrl: failedItem.previewUrl,
                    fileName: failedItem.__mediaFileName || failedItem.file_name,
                    mimeType: failedItem.__mediaMime || failedItem.mime_type,
                },
                failedItem.__caption || failedItem.caption || ''
            );
            return;
        }

        sendLockRef.current = true;
        setSendingText(true);
        try {
            await sendOutboundMessage(failedItem.text);
        } finally {
            sendLockRef.current = false;
            setSendingText(false);
        }
    };

    // 直接发送人工输入（不经过 AI 候选）
    const handleDirectSend = async (text) => {
        if (!text?.trim() || !client?.id) return;
        if (sendLockRef.current) return;
        const sentText = text.trim();

        sendLockRef.current = true;
        setSendingText(true);
        try {
            const sendResult = await sendOutboundMessage(sentText);
            if (!sendResult?.ok) {
                // 失败保留输入框原文，供用户重试；错误已通过 toast 反馈
                return;
            }

            // 成功后立即清空输入框，避免用户误以为没发出去再点一次
            setInputText('');

            await persistSftRecord({
                sentText,
                incomingMsg: null,
                modelCandidates: { opt1: sentText, opt2: '' },
                humanSelected: 'custom',
                diffAnalysis: { is_custom: true, human_reason: '人工直接发送', similarity: 100 },
            });

            await extractAndSaveMemory(null, sentText);
        } finally {
            sendLockRef.current = false;
            setSendingText(false);
        }
    };

    // messages from state (updated by checkNewMessages polling)

    const formatTime = (ts) => {
        if (!ts) return '';
        const d = new Date(toTimestampMs(ts));
        return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const formatDate = (ts) => {
        if (!ts) return '';
        const d = new Date(toTimestampMs(ts));
        return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
    };

    // 消息按日期分组 — 最新消息在底部（自然顺序）
    const groupedMessages = [];
    let lastDate = null;
    const msgsToShow = messages;
    const hasOlderMessages = loadedServerCount < messageTotal;
    const conversationStatusMeta = getConversationStatusMeta(creator);
    const trialPhaseMeta = getCreatorTrialPhaseMeta(creator);
    const signalBadges = getCreatorSignalBadges(creator);
    msgsToShow.forEach((msg, index) => {
        const normalizedTimestamp = toTimestampMs(msg.timestamp);
        const date = formatDate(normalizedTimestamp);
        if (date !== lastDate) {
            groupedMessages.push({ type: 'date', date, id: 'date_' + date });
            lastDate = date;
        }
        groupedMessages.push({
            ...msg,
            uiKey: getMessageRenderKey(msg, `message_${index}`),
            translationKey: getTranslationKey(msg, `translation_${index}`),
            normalizedTimestamp,
        });
    });

    // 初始滚动到底部
    useEffect(() => {
        if (prependInFlightRef.current) return;
        scrollToBottom();
    }, [messages.length]);

    useEffect(() => {
        if (!jumpTarget?.requestId || Number(jumpTarget?.creatorId) !== Number(client?.id)) return;
        if (processedJumpRequestRef.current === jumpTarget.requestId) return;

        let cancelled = false;

        const highlightMatch = (match) => {
            if (!match) return false;
            const scroll = () => {
                const node = messageNodeRefs.current.get(match.renderKey);
                if (!node || cancelled) return;
                node.scrollIntoView({ block: 'center', behavior: 'smooth' });
                setHighlightedMessageKey(match.renderKey);
                window.setTimeout(() => {
                    setHighlightedMessageKey((current) => current === match.renderKey ? null : current);
                }, 2400);
            };
            window.requestAnimationFrame(scroll);
            processedJumpRequestRef.current = jumpTarget.requestId;
            return true;
        };

        const run = async () => {
            const localMatch = findMessageMatch(messages, jumpTarget);
            if (highlightMatch(localMatch)) return;

            try {
                if (jumpTarget?.sourceMessageId || jumpTarget?.sourceMessageTimestamp) {
                    const anchorParams = new URLSearchParams();
                    if (jumpTarget?.sourceMessageId) anchorParams.set('around_message_id', String(jumpTarget.sourceMessageId));
                    if (jumpTarget?.sourceMessageTimestamp) anchorParams.set('around_timestamp', String(jumpTarget.sourceMessageTimestamp));
                    anchorParams.set('window_before', '5');
                    anchorParams.set('window_after', '4');
                    const anchorData = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages?${anchorParams.toString()}`, {
                        signal: AbortSignal.timeout(15000),
                    });
                    if (cancelled) return;
                    const { msgs, total } = unpackMessageResponse(anchorData);
                    if (msgs.length > 0) {
                        jumpContextUntilRef.current = Date.now() + 12000;
                        setMessages(msgs);
                        setMessageTotal(total);
                        setLoadedServerCount(Math.max(total, msgs.length));

                        const anchorMatch = findMessageMatch(msgs, jumpTarget);
                        if (highlightMatch(anchorMatch)) return;
                    }
                }

                const fetchLimit = Math.max(300, Math.min(Math.max(messageTotal, loadedServerCount, 300), 500));
                const data = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages?limit=${fetchLimit}`, {
                    signal: AbortSignal.timeout(15000),
                });
                if (cancelled) return;
                const { msgs, total } = unpackMessageResponse(data);
                setMessages(msgs);
                setMessageTotal(total);
                setLoadedServerCount(msgs.length);

                const remoteMatch = findMessageMatch(msgs, jumpTarget);
                if (highlightMatch(remoteMatch)) return;
            } catch (e) {
                console.error('[jumpToSourceMessage] error:', e);
            }

            processedJumpRequestRef.current = jumpTarget.requestId;
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [jumpTarget, client?.id, loadedServerCount, messageTotal, messages, unpackMessageResponse]);

    const handleChatScroll = useCallback(() => {
        const node = chatScrollRef.current;
        if (!node || loadingOlder || !hasOlderMessages) return;
        if (node.scrollTop > 80) return;
        if (olderLoadCooldownRef.current) return;

        olderLoadCooldownRef.current = true;
        loadOlderMessages().finally(() => {
            setTimeout(() => {
                olderLoadCooldownRef.current = false;
            }, 400);
        });
    }, [hasOlderMessages, loadOlderMessages, loadingOlder]);

    // 同步 textarea 高度（inputText 可能在 handleEditCandidate 中被程序化设置）
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 240) + 'px';
        }
    }, [inputText]);

    useEffect(() => () => {
        clearPendingImage();
    }, [clearPendingImage]);

    // 点击外部关闭 emoji picker（跳过打开按钮的那次点击）
    const emojiSkipCloseRef = useRef(false);
    useEffect(() => {
        if (!emojiPickerOpen) return;
        const handler = (e) => {
            if (emojiSkipCloseRef.current) {
                emojiSkipCloseRef.current = false;
                return;
            }
            if (!e.target.closest('.emoji-picker-wrapper')) {
                setEmojiPickerOpen(false);
            }
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [emojiPickerOpen]);

    // 键盘弹出时通过 visualViewport 动态调整输入框位置
    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return;
        const handler = () => {
            const vp = window.visualViewport;
            // 当键盘弹出时，visualViewport.height < window.innerHeight，offset 为正
            const offset = Math.max(0, window.innerHeight - vp.height - vp.offsetTop);
            setViewportOffset(offset);
        };
        window.visualViewport.addEventListener('resize', handler);
        window.visualViewport.addEventListener('scroll', handler);
        return () => {
            window.visualViewport?.removeEventListener('resize', handler);
            window.visualViewport?.removeEventListener('scroll', handler);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onResize = () => setIsMobileViewport(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        if (activePicker && isMobileViewport) {
            setPickerCollapsed(false);
        }
    }, [activePicker?.generated_at, isMobileViewport]);

    const handleReplyDeckResizeStart = useCallback((event) => {
        event.preventDefault();
        const startY = event.touches?.[0]?.clientY ?? event.clientY;
        const startHeight = replyDeckHeight || 420;
        const onMove = (moveEvent) => {
            moveEvent.preventDefault?.();
            const currentY = moveEvent.touches?.[0]?.clientY ?? moveEvent.clientY;
            const maxHeight = typeof window === 'undefined' ? 680 : Math.min(680, Math.floor(window.innerHeight * 0.72));
            const nextHeight = Math.max(220, Math.min(maxHeight, startHeight + (startY - currentY)));
            setReplyDeckHeight(nextHeight);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
    }, [replyDeckHeight]);

    useEffect(() => {
        if (!topicDropdownOpen) return;
        let cancelled = false;
        fetchCustomTopicTemplates().then((templates) => {
            if (!cancelled) setSavedCustomTopicTemplates(templates);
        });
        return () => { cancelled = true; };
    }, [topicDropdownOpen]);

    const handleSelectTopicTemplate = useCallback(({
        topicGroup,
        intentKey = null,
        sceneKey = null,
        label = '',
        customTemplateText = '',
        customTemplateId = null,
        customTemplateMediaItems = [],
    }) => {
        const topicLabel = label || getIntentLabel(intentKey, TOPIC_GROUP_LABELS[topicGroup] || '自定义话题');
        const lastIncoming = getLatestIncomingMessage(messages);
        const newTopic = resolveTopicContext({
            topic_group: topicGroup,
            intent_key: intentKey,
            scene_key: sceneKey,
            text: (inputText || '').trim() || lastIncoming?.text || topicLabel,
            trigger: 'manual',
            detected_at: Date.now(),
            custom_topic_label: (customTemplateId || customTemplateText || customTemplateMediaItems.length > 0 || topicGroup === 'custom_topic')
                ? topicLabel
                : '',
            custom_template_text: customTemplateText,
            custom_template_id: customTemplateId,
            custom_template_media_items: customTemplateMediaItems,
        });
        setCurrentTopic(newTopic);
        setTopicDropdownOpen(false);
    }, [inputText, messages]);

    const upsertSavedCustomTemplate = useCallback((saved) => {
        if (!saved) return;
        setSavedCustomTopicTemplates((prev) => {
            const withoutSame = (prev || []).filter((item) => item.id !== saved.id && item.label !== saved.label);
            return [saved, ...withoutSame].slice(0, 100);
        });
    }, []);

    const resolveTemplateCardMeta = useCallback((draft = {}, slot = {}) => {
        const topicLabel = currentTopic?.custom_topic_label || currentTopic?.label || slot?.title || '自定义模板';
        return {
            label: String(draft.label || topicLabel).trim(),
            template_text: String(draft.template_text || draft.template || slot?.text || '').trim(),
            topic_group: draft.topic_group || currentTopic?.topic_group || slot?.topic_group || activeReplyContext?.topic_group || 'custom_topic',
            intent_key: draft.intent_key || currentTopic?.intent_key || slot?.intent_key || activeReplyContext?.intent_key || 'custom_template',
            scene_key: draft.scene_key || currentTopic?.scene_key || slot?.scene_keys?.[0] || activeReplyContext?.scene_key || 'follow_up',
            media_items: Array.isArray(draft.media_items) ? draft.media_items : [],
        };
    }, [activeReplyContext?.intent_key, activeReplyContext?.scene_key, activeReplyContext?.topic_group, currentTopic]);

    const buildTemplateModalSeed = useCallback((mode, slot = {}, slotKey = '') => {
        const fallbackGroup = currentTopic?.topic_group || slot?.topic_group || activeReplyContext?.topic_group || 'custom_topic';
        const fallbackIntent = currentTopic?.intent_key || slot?.intent_key || activeReplyContext?.intent_key || (TOPIC_GROUP_SUBTOPICS[fallbackGroup] || [])[0] || 'custom_template';
        const fallbackScene = currentTopic?.scene_key || slot?.scene_keys?.[0] || activeReplyContext?.scene_key || 'follow_up';
        return {
            mode,
            slot,
            slotKey,
            label: slot?.custom_template_label || currentTopic?.custom_topic_label || currentTopic?.label || slot?.title || '自定义模板',
            template_text: slot?.text || '',
            mediaUrls: (slot?.media_items || [])
                .map((item) => item?.url || item?.file_url || '')
                .filter(Boolean)
                .join('\n'),
            topic_group: fallbackGroup,
            intent_key: fallbackIntent,
            scene_key: fallbackScene,
        };
    }, [activeReplyContext?.intent_key, activeReplyContext?.scene_key, activeReplyContext?.topic_group, currentTopic]);

    const openTemplateManageModal = useCallback((mode, { slot, slotKey } = {}) => {
        setTemplateManageModal(buildTemplateModalSeed(mode, slot || {}, slotKey || ''));
    }, [buildTemplateModalSeed]);

    const resolveTemplateModalPayload = useCallback(() => {
        if (!templateManageModal) return null;
        return resolveTemplateCardMeta({
            label: templateManageModal.label,
            template_text: templateManageModal.template_text,
            topic_group: templateManageModal.topic_group,
            intent_key: templateManageModal.intent_key,
            scene_key: templateManageModal.scene_key,
            media_items: String(templateManageModal.mediaUrls || '')
                .split(/\n+/)
                .map((url) => url.trim())
                .filter(Boolean)
                .map((url) => ({ url, label: '对应图片' })),
        }, {
            ...templateManageModal.slot,
            topic_group: templateManageModal.topic_group,
            intent_key: templateManageModal.intent_key,
            scene_keys: [templateManageModal.scene_key].filter(Boolean),
        });
    }, [resolveTemplateCardMeta, templateManageModal]);

    const hydrateTemplateModalFromRoute = useCallback(async ({
        topicGroup,
        intentKey,
        sceneKey,
        preserveDraft = false,
    }) => {
        const resolvedIntent = intentKey || (TOPIC_GROUP_SUBTOPICS[topicGroup] || [])[0] || 'custom_template';
        const resolvedScene = sceneKey || inferSceneKeyFromTopicGroup(topicGroup, getIntentLabel(resolvedIntent, ''));
        const fallbackLabel = getIntentLabel(resolvedIntent, TOPIC_GROUP_LABELS[topicGroup] || '自定义话题');

        setTemplateManageModal((prev) => prev ? {
            ...prev,
            topic_group: topicGroup,
            intent_key: resolvedIntent,
            scene_key: resolvedScene,
            routeLoading: true,
            routeError: null,
            routeSourceTitle: null,
        } : prev);

        if (!client?.phone) {
            setTemplateManageModal((prev) => prev ? {
                ...prev,
                routeLoading: false,
                routeError: '缺少当前达人，无法检索模板',
            } : prev);
            return;
        }

        try {
            const lastIncoming = getLatestIncomingMessage(messages);
            const data = await fetchJsonOrThrow(`${API_BASE}/experience/retrieve-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: client.phone,
                    operator: activeReplyContext?.operator || creator?.wa_owner || client?.wa_owner || null,
                    scene: resolvedScene,
                    topic_group: topicGroup,
                    intent_key: resolvedIntent,
                    user_message: lastIncoming?.text || inputText || fallbackLabel,
                    recent_messages: (messages || []).slice(-8).map((m) => ({
                        role: m?.role === 'me' ? 'assistant' : 'user',
                        text: String(m?.text || '').trim(),
                        timestamp: m?.timestamp || null,
                    })).filter((m) => m.text),
                    current_topic: {
                        topic_group: topicGroup,
                        intent_key: resolvedIntent,
                        scene_key: resolvedScene,
                        trigger: 'manual',
                        label: fallbackLabel,
                    },
                    auto_detected_topic: null,
                    active_events: activeEvents,
                    lifecycle: creator?._full?.lifecycle || creator?.lifecycle || null,
                    force_template_sources: true,
                }),
                signal: AbortSignal.timeout(10000),
            });
            const slot = data?.slots?.op1 || data?.slots?.op2 || data?.alternatives?.[0] || null;
            const nextMediaUrls = (slot?.media_items || [])
                .map((item) => item?.url || item?.file_url || '')
                .filter(Boolean)
                .join('\n');

            setTemplateManageModal((prev) => {
                if (!prev || prev.topic_group !== topicGroup || prev.intent_key !== resolvedIntent) return prev;
                const shouldPreserveDraft = preserveDraft && (prev.template_text?.trim() || prev.label?.trim());
                return {
                    ...prev,
                    topic_group: data?.context?.topic_group || topicGroup,
                    intent_key: data?.context?.intent_key || resolvedIntent,
                    scene_key: data?.context?.scene_key || resolvedScene,
                    label: shouldPreserveDraft
                        ? prev.label
                        : (slot?.custom_template_label || slot?.title || fallbackLabel),
                    template_text: shouldPreserveDraft
                        ? prev.template_text
                        : (slot?.text || prev.template_text || ''),
                    mediaUrls: shouldPreserveDraft
                        ? prev.mediaUrls
                        : (nextMediaUrls || prev.mediaUrls || ''),
                    routeLoading: false,
                    routeError: (slot?.text || (slot?.media_items || []).length > 0)
                        ? null
                        : '这个子话题暂无标准模板，可手动填写后保存',
                    routeSourceTitle: slot?.title || slot?.source || null,
                };
            });
        } catch (e) {
            setTemplateManageModal((prev) => {
                if (!prev || prev.topic_group !== topicGroup || prev.intent_key !== resolvedIntent) return prev;
                return {
                    ...prev,
                    routeLoading: false,
                    routeError: `模板检索失败：${e.message || '未知错误'}`,
                };
            });
        }
    }, [activeEvents, activeReplyContext?.operator, client, creator, inputText, messages]);

    const handleTemplateRouteSelect = useCallback((topicGroup, intentKey = null) => {
        const resolvedIntent = intentKey || (TOPIC_GROUP_SUBTOPICS[topicGroup] || [])[0] || 'custom_template';
        const sceneKey = inferSceneKeyFromTopicGroup(topicGroup, getIntentLabel(resolvedIntent, TOPIC_GROUP_LABELS[topicGroup] || ''));
        hydrateTemplateModalFromRoute({
            topicGroup,
            intentKey: resolvedIntent,
            sceneKey,
            preserveDraft: false,
        });
    }, [hydrateTemplateModalFromRoute]);

    const loadSavedTemplateIntoModal = useCallback((item) => {
        setTemplateManageModal((prev) => ({
            ...prev,
            mode: 'update',
            slot: {
                ...(prev?.slot || {}),
                custom_template_id: item.id || null,
                section_id: item.id ? `operator-custom-topic::${item.id}` : null,
            },
            label: item.label || '',
            template_text: item.template_text || '',
            mediaUrls: (item.media_items || [])
                .map((media) => media?.url || media?.file_url || '')
                .filter(Boolean)
                .join('\n'),
            topic_group: item.topic_group || 'custom_topic',
            intent_key: item.intent_key || 'custom_template',
            scene_key: item.scene_key || 'follow_up',
            routeLoading: false,
            routeError: null,
            routeSourceTitle: '已保存话题模板',
        }));
    }, []);

    const loadSopImageTopicIntoModal = useCallback((item) => {
        setTemplateManageModal((prev) => ({
            ...prev,
            mode: 'save',
            slot: {},
            slotKey: 'sop_image_topic',
            label: item.label,
            template_text: '',
            mediaUrls: item.image,
            topic_group: item.topic_group,
            intent_key: item.intent_key,
            scene_key: item.scene_key,
            routeLoading: false,
            routeError: null,
            routeSourceTitle: '4月版 SOP 图片',
        }));
    }, []);

    const openCreateTopicModal = useCallback((seed = {}) => {
        const topicGroup = seed.topic_group || currentTopic?.topic_group || activeReplyContext?.topic_group || 'signup_onboarding';
        const intentKey = seed.intent_key || currentTopic?.intent_key || (TOPIC_GROUP_SUBTOPICS[topicGroup] || [])[0] || 'custom_template';
        const sceneKey = seed.scene_key || inferSceneKeyFromTopicGroup(topicGroup, getIntentLabel(intentKey, TOPIC_GROUP_LABELS[topicGroup] || ''));
        setTopicDropdownOpen(false);
        setTemplateManageModal({
            mode: 'save',
            slot: {},
            slotKey: 'new_topic',
            label: seed.label || getIntentLabel(intentKey, TOPIC_GROUP_LABELS[topicGroup] || '新话题模板'),
            template_text: seed.template_text || '',
            mediaUrls: '',
            topic_group: topicGroup,
            intent_key: intentKey,
            scene_key: sceneKey,
            routeLoading: true,
            routeError: null,
            routeSourceTitle: null,
        });
        hydrateTemplateModalFromRoute({
            topicGroup,
            intentKey,
            sceneKey,
            preserveDraft: Boolean(seed.template_text || seed.label),
        });
    }, [activeReplyContext?.topic_group, currentTopic, hydrateTemplateModalFromRoute]);

    const submitTemplateManageModal = useCallback(async () => {
        const payload = resolveTemplateModalPayload();
        if (!payload || !payload.label || (!payload.template_text && !(payload.media_items || []).length)) return;
        const mode = templateManageModal?.mode || 'save';
        const slot = templateManageModal?.slot || {};
        const id = slot?.custom_template_id
            || String(slot?.section_id || '').match(/operator-custom-topic::(\d+)/)?.[1];
        if (mode === 'update' && !id) {
            setTemplateError('请先保存为自定义模板后再更新');
            return;
        }
        try {
            const data = await fetchJsonOrThrow(
                mode === 'update'
                    ? `${API_BASE}/custom-topic-templates/${id}`
                    : `${API_BASE}/custom-topic-templates`,
                {
                method: mode === 'update' ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000),
                }
            );
            const saved = data?.template || {
                ...payload,
                id,
                template_text: payload.template_text,
            };
            upsertSavedCustomTemplate(saved);
            setSavedCustomTopicTemplates((prev) => {
                const withoutSame = (prev || []).filter((item) => item.id !== saved.id && item.label !== saved.label);
                return [saved, ...withoutSame].slice(0, 100);
            });
            handleSelectTopicTemplate({
                topicGroup: saved.topic_group || payload.topic_group,
                intentKey: saved.intent_key || 'custom_template',
                sceneKey: saved.scene_key || 'follow_up',
                label: saved.label || payload.label,
                customTemplateText: saved.template_text || payload.template_text,
                customTemplateId: saved.id || null,
                customTemplateMediaItems: saved.media_items || payload.media_items || [],
            });
            fetchCustomTopicTemplates().then((templates) => {
                setSavedCustomTopicTemplates(templates);
            });
            toast.success(`${mode === 'update' ? '模板已更新' : '话题模板已保存'}：${saved.label || payload.label}`);
            setTemplateManageModal(null);
        } catch (e) {
            console.error('[customTopicTemplates] submit failed:', e);
            setTemplateError(`自定义模板${mode === 'update' ? '更新' : '保存'}失败：${e.message || '未知错误'}`);
        }
    }, [handleSelectTopicTemplate, resolveTemplateModalPayload, templateManageModal, toast, upsertSavedCustomTemplate]);

    const handleReadTemplateImagesFromClipboard = useCallback(async () => {
        if (!templateManageModal) return;
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
                throw new Error('当前浏览器不支持读取剪贴板');
            }
            const text = await navigator.clipboard.readText();
            const urls = extractImageUrls(text);
            if (urls.length === 0) {
                toast.warning('剪贴板里没有可用的图片链接');
                return;
            }
            setTemplateManageModal((prev) => ({
                ...prev,
                mediaUrls: mergeMediaUrls(prev.mediaUrls, urls.join('\n')),
            }));
        } catch (e) {
            toast.error(`读取剪贴板失败：${e.message || '请直接 Ctrl/Cmd+V 粘贴'}`);
        }
    }, [templateManageModal, toast]);

    const handlePasteTemplateImages = useCallback((event) => {
        const text = [
            event.clipboardData?.getData('text') || '',
            event.clipboardData?.getData('text/html') || '',
        ].filter(Boolean).join('\n');
        const urls = extractImageUrls(text);
        if (urls.length === 0) return;
        event.preventDefault();
        setTemplateManageModal((prev) => ({
            ...prev,
            mediaUrls: mergeMediaUrls(prev.mediaUrls, urls.join('\n')),
        }));
    }, []);

    useEffect(() => {
        if (!templateManageModal) return undefined;
        const onPaste = (event) => {
            const text = [
                event.clipboardData?.getData('text') || '',
                event.clipboardData?.getData('text/html') || '',
            ].filter(Boolean).join('\n');
            const urls = extractImageUrls(text);
            if (urls.length === 0) return;
            const target = event.target;
            const isTextField = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable;
            if (isTextField && !target?.dataset?.templateMediaPaste) return;
            event.preventDefault();
            setTemplateManageModal((prev) => prev ? {
                ...prev,
                mediaUrls: mergeMediaUrls(prev.mediaUrls, urls.join('\n')),
            } : prev);
            toast.success(`已从剪贴板加入 ${urls.length} 张图片`);
        };
        window.addEventListener('paste', onPaste, true);
        return () => window.removeEventListener('paste', onPaste, true);
    }, [templateManageModal, toast]);

    const handleSaveTemplateFromCard = useCallback((payload) => {
        openTemplateManageModal('save', payload);
    }, [openTemplateManageModal]);

    const handleUpdateTemplateFromCard = useCallback((payload) => {
        openTemplateManageModal('update', payload);
    }, [openTemplateManageModal]);

    const templateModalMediaUrls = templateManageModal
        ? extractImageUrls(templateManageModal.mediaUrls || '')
        : [];
    const canSaveTemplateModal = Boolean(
        templateManageModal
        && templateManageModal.label.trim()
        && (
            templateManageModal.template_text.trim()
            || templateModalMediaUrls.length > 0
        )
    );

    const templateManageModalView = templateManageModal ? (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 3000,
                background: 'rgba(31,29,26,0.38)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: isMobileViewport ? '12px' : '32px',
            }}
            onClick={() => setTemplateManageModal(null)}
        >
            <div
                className="shadow-2xl"
                style={{
                    width: isMobileViewport ? '100%' : 'min(1120px, 92vw)',
                    height: isMobileViewport ? '92vh' : 'min(760px, 84vh)',
                    background: WA.white,
                    border: `1px solid ${WA.borderLight}`,
                    borderRadius: isMobileViewport ? 18 : 24,
                    overflow: 'hidden',
                    display: 'grid',
                    gridTemplateColumns: isMobileViewport ? '1fr' : 'minmax(0, 1fr) 320px',
                    boxShadow: '0 28px 80px rgba(31,29,26,0.22)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col min-h-0">
                    <div className="px-6 py-5 border-b flex items-center justify-between gap-4" style={{ borderColor: WA.borderLight }}>
                        <div className="min-w-0">
                            <div className="text-xs font-semibold tracking-[0.1em] uppercase" style={{ color: WA.textMuted }}>
                                {templateManageModal.mode === 'update'
                                    ? 'Update Template'
                                    : templateManageModal.slotKey === 'new_topic'
                                        ? 'New Topic Template'
                                        : 'Save Template'}
                            </div>
                            <div className="text-xl font-semibold truncate mt-1" style={{ color: WA.textDark }}>
                                {templateManageModal.mode === 'update'
                                    ? '更新模板数据库'
                                    : templateManageModal.slotKey === 'new_topic'
                                        ? '新建话题模板'
                                        : '保存为当前话题模板'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setTemplateManageModal(null)}
                            className="w-10 h-10 rounded-full flex items-center justify-center"
                            style={{ color: WA.textMuted, border: `1px solid ${WA.borderLight}`, background: WA.shellPanelMuted }}
                            title="关闭"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
                        <label className="block">
                            <div className="text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>模板名称</div>
                            <input
                                value={templateManageModal.label}
                                onChange={(e) => setTemplateManageModal((prev) => ({ ...prev, label: e.target.value }))}
                                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                                style={{ color: WA.textDark, border: `1px solid ${WA.borderLight}`, background: WA.shellPanelMuted }}
                            />
                        </label>
                        <label className="block">
                            <div className="text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>模板内容（可选）</div>
                            {(templateManageModal.routeLoading || templateManageModal.routeError || templateManageModal.routeSourceTitle) && (
                                <div
                                    className="mb-2 rounded-lg px-3 py-2 text-xs"
                                    style={{
                                        color: templateManageModal.routeError ? '#b45309' : WA.textMuted,
                                        background: templateManageModal.routeError ? 'rgba(245,158,11,0.10)' : WA.shellPanelMuted,
                                        border: `1px solid ${WA.borderLight}`,
                                    }}
                                >
                                    {templateManageModal.routeLoading
                                        ? '正在同步该子话题模板...'
                                        : templateManageModal.routeError
                                            ? templateManageModal.routeError
                                            : `已同步：${templateManageModal.routeSourceTitle}`}
                                </div>
                            )}
                            <textarea
                                value={templateManageModal.template_text}
                                onChange={(e) => setTemplateManageModal((prev) => ({ ...prev, template_text: e.target.value }))}
                                rows={12}
                                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none resize-y"
                                style={{ color: WA.textDark, border: `1px solid ${WA.borderLight}`, background: WA.shellPanelMuted, minHeight: 280 }}
                            />
                        </label>
                        <div className="block">
                            <div className="flex items-center justify-between gap-3 mb-1.5">
                                <div className="text-xs font-semibold" style={{ color: WA.textMuted }}>图片素材</div>
                                <div className="flex items-center gap-2">
                                    {templateModalMediaUrls.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setTemplateManageModal((prev) => ({ ...prev, mediaUrls: '' }))}
                                            className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                            style={{ color: WA.textMuted, border: `1px solid ${WA.borderLight}`, background: WA.white }}
                                        >
                                            清空
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleReadTemplateImagesFromClipboard}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold"
                                        style={{ color: WA.teal, border: `1px solid rgba(15,118,110,0.22)`, background: 'rgba(15,118,110,0.08)' }}
                                    >
                                        读剪贴板
                                    </button>
                                </div>
                            </div>
                            <div className="text-[11px] mb-2" style={{ color: WA.textMuted }}>
                                图片会作为独立素材保存，可在 Reply Deck 里单独发送，不会自动绑在文字后面。
                            </div>
                            <div
                                className="rounded-xl px-3 py-3"
                                style={{ color: WA.textDark, border: `1px dashed ${templateModalMediaUrls.length ? 'rgba(15,118,110,0.35)' : WA.borderLight}`, background: WA.shellPanelMuted }}
                                onPaste={handlePasteTemplateImages}
                                data-template-media-paste="true"
                                tabIndex={0}
                            >
                                {templateModalMediaUrls.length > 0 ? (
                                    <div className="space-y-2">
                                        {templateModalMediaUrls.map((url) => (
                                            <div
                                                key={url}
                                                className="flex items-center gap-3 rounded-lg px-2.5 py-2"
                                                style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
                                            >
                                                <img
                                                    src={url}
                                                    alt=""
                                                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                                                    style={{ border: `1px solid ${WA.borderLight}` }}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-semibold truncate" style={{ color: WA.textDark }}>
                                                        {formatMediaUrlLabel(url)}
                                                    </div>
                                                    <div className="text-[11px] truncate" style={{ color: WA.textMuted }}>
                                                        {url}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setTemplateManageModal((prev) => ({
                                                            ...prev,
                                                            mediaUrls: extractImageUrls(prev.mediaUrls)
                                                                .filter((item) => item !== url)
                                                                .join('\n'),
                                                        }));
                                                    }}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                                                    style={{ color: WA.textMuted, background: WA.shellPanelMuted }}
                                                    title="移除"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <textarea
                                        value={templateManageModal.mediaUrls}
                                        onChange={(e) => setTemplateManageModal((prev) => ({ ...prev, mediaUrls: e.target.value }))}
                                        onPaste={handlePasteTemplateImages}
                                        data-template-media-paste="true"
                                        rows={3}
                                        placeholder="粘贴图片链接，或在弹窗内直接 Ctrl/Cmd+V"
                                        className="w-full bg-transparent text-sm focus:outline-none resize-none"
                                        style={{ color: WA.textDark }}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: WA.borderLight, background: WA.shellPanelStrong }}>
                        <button
                            type="button"
                            onClick={() => setTemplateManageModal(null)}
                            className="px-5 py-2.5 rounded-full text-sm font-semibold"
                            style={{ color: WA.textDark, border: `1px solid ${WA.borderLight}`, background: WA.white }}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={submitTemplateManageModal}
                            disabled={templateManageModal.routeLoading || !canSaveTemplateModal}
                            className="px-5 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: templateManageModal.mode === 'update' ? '#b45309' : WA.teal }}
                        >
                            {templateManageModal.mode === 'update'
                                ? '更新模板'
                                : templateManageModal.slotKey === 'new_topic'
                                    ? '保存到话题库'
                                    : '保存模板'}
                        </button>
                    </div>
                </div>

                <aside
                    className="min-h-0 overflow-y-auto border-l"
                    style={{ borderColor: WA.borderLight, background: '#fffbeb' }}
                >
                    <div className="sticky top-0 px-5 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: WA.borderLight, background: '#fffbeb' }}>
                        <div className="min-w-0">
                            <div className="text-xs font-semibold tracking-[0.1em] uppercase" style={{ color: WA.textMuted }}>Topic Route</div>
                            <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>选择话题分类</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => openCreateTopicModal({
                                topic_group: templateManageModal.topic_group,
                                intent_key: templateManageModal.intent_key,
                                scene_key: templateManageModal.scene_key,
                            })}
                            className="px-3 py-2 rounded-full text-xs font-semibold shrink-0"
                            style={{ color: WA.teal, border: `1px solid rgba(15,118,110,0.24)`, background: 'rgba(15,118,110,0.08)' }}
                        >
                            新增话题
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        {TOPIC_GROUP_ORDER.map((groupKey) => {
                            const groupActive = templateManageModal.topic_group === groupKey;
                            const subtopics = TOPIC_GROUP_SUBTOPICS[groupKey] || [];
                            const savedInGroup = savedCustomTopicTemplates
                                .filter((item) => (item.topic_group || 'custom_topic') === groupKey)
                                .slice(0, 10);
                            const sopImagesInGroup = SOP_IMAGE_TOPIC_TEMPLATES
                                .filter((item) => item.topic_group === groupKey);
                            return (
                                <div key={groupKey} className="rounded-xl p-2" style={{ background: groupActive ? 'rgba(15,118,110,0.08)' : 'rgba(255,255,255,0.62)', border: `1px solid ${groupActive ? 'rgba(15,118,110,0.22)' : WA.borderLight}` }}>
                                    <button
                                        type="button"
                                        onClick={() => handleTemplateRouteSelect(groupKey, subtopics[0] || templateManageModal.intent_key || 'custom_template')}
                                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold"
                                        style={{ color: groupActive ? WA.teal : WA.textDark }}
                                    >
                                        {TOPIC_GROUP_LABELS[groupKey]}
                                    </button>
                                    {subtopics.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 px-2 pb-1">
                                            {subtopics.map((intentKey) => {
                                                const active = groupActive && templateManageModal.intent_key === intentKey;
                                                return (
                                                    <button
                                                        key={intentKey}
                                                        type="button"
                                                        onClick={() => handleTemplateRouteSelect(groupKey, intentKey)}
                                                        className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                                                        style={{
                                                            background: active ? 'rgba(15,118,110,0.14)' : WA.white,
                                                            color: active ? WA.teal : WA.textMuted,
                                                            border: `1px solid ${active ? 'rgba(15,118,110,0.25)' : WA.borderLight}`,
                                                        }}
                                                    >
                                                        {getIntentLabel(intentKey)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {savedInGroup.length > 0 && (
                                        <div className="mt-2 px-2 pb-1">
                                            <div className="text-[10px] font-semibold mb-1.5" style={{ color: WA.textMuted }}>
                                                已保存
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {savedInGroup.map((item) => {
                                                    const active = templateManageModal.slot?.custom_template_id === item.id
                                                        || (templateManageModal.label === item.label && templateManageModal.template_text === item.template_text);
                                                    return (
                                                        <button
                                                            key={item.id || item.label}
                                                            type="button"
                                                            onClick={() => loadSavedTemplateIntoModal(item)}
                                                            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                                                            style={{
                                                                background: active ? 'rgba(15,118,110,0.14)' : WA.white,
                                                                color: active ? WA.teal : WA.textMuted,
                                                                border: `1px solid ${active ? 'rgba(15,118,110,0.25)' : WA.borderLight}`,
                                                            }}
                                                            title={getIntentLabel(item.intent_key, TOPIC_GROUP_LABELS[item.topic_group] || '已保存模板')}
                                                        >
                                                            {item.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {sopImagesInGroup.length > 0 && (
                                        <div className="mt-2 px-2 pb-1">
                                            <div className="text-[10px] font-semibold mb-1.5" style={{ color: WA.textMuted }}>
                                                SOP图片
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {sopImagesInGroup.map((item) => {
                                                    const active = templateManageModal.slotKey === 'sop_image_topic'
                                                        && templateManageModal.mediaUrls === item.image;
                                                    return (
                                                        <button
                                                            key={`${item.topic_group}:${item.label}:${item.image}`}
                                                            type="button"
                                                            onClick={() => loadSopImageTopicIntoModal(item)}
                                                            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                                                            style={{
                                                                background: active ? 'rgba(15,118,110,0.14)' : 'rgba(15,118,110,0.06)',
                                                                color: active ? WA.teal : '#0f766e',
                                                                border: `1px solid ${active ? 'rgba(15,118,110,0.25)' : 'rgba(15,118,110,0.14)'}`,
                                                            }}
                                                            title={item.summary}
                                                        >
                                                            {item.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    ) : null;

    return (
        <>
            <div className="flex flex-col h-full">

                {/* Desktop Header — hidden on mobile (mobile has its own top bar in App.jsx) */}
                <div
                    className="hidden md:flex items-center gap-4 px-6 py-3.5 border-b"
                    style={{ background: WA.shellPanelStrong, borderColor: WA.borderLight }}
                >
                    <button onClick={onClose} className="shrink-0 transition-colors" style={{ color: WA.textMuted }} title="返回">
                        <ArrowLeftIcon />
                    </button>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0" style={{ background: WA.teal }}>
                        {(client.name || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base" style={{ color: WA.textDark }}>{client.name || client.phone}</div>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="inline-flex items-center gap-1 text-xs" style={{ color: WA.textMuted }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: WA.teal }} />
                                {client.wa_owner || creator?.wa_owner || '在线工作台'} · {messageTotal} 条消息
                            </span>
                            {/* 自动检测话题 — 右侧联系人信息区，显示在二级信息行 */}
                            {autoDetectedTopic && !currentTopic && (
                                <span
                                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        background: autoDetectedTopic.confidence === 'high'
                                            ? 'rgba(16,185,129,0.2)'
                                            : autoDetectedTopic.confidence === 'medium'
                                                ? 'rgba(245,158,11,0.2)'
                                                : WA.shellPanelMuted,
                                        color: autoDetectedTopic.confidence === 'high'
                                            ? '#047857'
                                            : autoDetectedTopic.confidence === 'medium'
                                                ? '#b45309'
                                                : WA.textMuted,
                                    }}
                                    title={`自动检测 · 置信度: ${autoDetectedTopic.confidence} · 根据最新 ${Math.min(messages.length, 20)} 条消息`}
                                >
                                    🔍 {autoDetectedTopic.label}
                                </span>
                            )}
                            {/* 手动设置的话题（优先于自动检测显示） */}
                            {currentTopic && (
                                <span
                                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        background: 'rgba(59,130,246,0.12)',
                                        color: '#2563eb',
                                    }}
                                    title={`手动标记 · ${currentTopic.detected_at ? new Date(currentTopic.detected_at).toLocaleString('zh-CN') : ''}`}
                                >
                                    📌 {currentTopic.label || getTopicLabel(currentTopic.intent_key, getTopicLabel(currentTopic.topic_group || currentTopic.topic_key))}
                                </span>
                            )}
                        </div>
                    </div>
                    {pendingCandidates.length > 0 && (
                        <span className="text-xs px-3 py-1 rounded-full font-bold shrink-0" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>
                            待处理 {pendingCandidates.length}
                        </span>
                    )}
                    <IconButton
                        onClick={handleIncrementalSync}
                        disabled={syncingMessages}
                        title="按手机号抓取最近原始聊天，只补齐最新消息，不做深度修复"
                        active={syncingMessages}
                    >
                        {syncingMessages ? <SpinnerIcon /> : <RefreshIcon />}
                    </IconButton>
                    <IconButton
                        onClick={handleRepairMessages}
                        disabled={repairingMessages}
                        title="按手机号在对应 session 里重新爬取该达人的原始聊天，并修复 role / 缺失 / 重复记录"
                        active={repairingMessages}
                    >
                        {repairingMessages ? <SpinnerIcon /> : <RepairIcon />}
                    </IconButton>
                    <IconButton
                        onClick={handleTranslate}
                        disabled={translating}
                        title={Object.keys(translationMap).length > 0 ? '关闭翻译' : '翻译最近20条消息'}
                        active={translating || Object.keys(translationMap).length > 0}
                    >
                        {translating ? <SpinnerIcon /> : <GlobeIcon />}
                    </IconButton>
                </div>
                {topSlot && (
                    <div
                        className="hidden md:block px-4 py-2 border-b"
                        style={{ background: WA.shellPanelStrong, borderColor: WA.borderLight }}
                    >
                        {topSlot}
                    </div>
                )}

                {/* Mobile Header with Tags toggle — only shown when NOT used as panel in App.jsx */}
                {!asPanel && (
                    <>
                        <div
                            className="flex md:hidden items-center gap-3 px-4 py-3 border-b"
                            style={{ background: WA.shellPanelStrong, borderColor: WA.borderLight }}
                        >
                            <button onClick={onClose} className="text-xl shrink-0" style={{ color: WA.textMuted }}>←</button>
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: WA.teal }}>
                                {(client.name || '?')[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate" style={{ color: WA.textDark }}>{client.name || client.phone}</div>
                                {/* 自动检测话题（移动端） */}
                                {autoDetectedTopic && !currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span
                                            className="text-xs px-1.5 py-0.5 rounded-full"
                                            style={{
                                                background: autoDetectedTopic.confidence === 'high'
                                                    ? 'rgba(16,185,129,0.2)'
                                                    : autoDetectedTopic.confidence === 'medium'
                                                        ? 'rgba(245,158,11,0.2)'
                                                        : WA.shellPanelMuted,
                                                color: autoDetectedTopic.confidence === 'high'
                                                    ? '#047857'
                                                    : autoDetectedTopic.confidence === 'medium'
                                                        ? '#b45309'
                                                        : WA.textMuted,
                                            }}
                                        >
                                            🔍 {autoDetectedTopic.label}
                                        </span>
                                    </div>
                                )}
                                {/* 手动话题（移动端） */}
                                {currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>
                                            📌 {currentTopic.label || getTopicLabel(currentTopic.intent_key, getTopicLabel(currentTopic.topic_group || currentTopic.topic_key))}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleIncrementalSync}
                                disabled={syncingMessages}
                                className="text-base shrink-0 px-2 py-1 rounded-lg disabled:opacity-50"
                                style={{ color: WA.textMuted, background: WA.white, border: `1px solid ${WA.borderLight}` }}
                                title="按手机号抓取最近原始聊天，只补齐最新消息"
                            >
                                {syncingMessages ? '⏳' : '🔄'}
                            </button>
                            <button
                                onClick={handleRepairMessages}
                                disabled={repairingMessages}
                                className="text-base shrink-0 px-2 py-1 rounded-lg disabled:opacity-50"
                                style={{ color: WA.textMuted, background: WA.white, border: `1px solid ${WA.borderLight}` }}
                                title="重新爬取并修复当前联系人消息"
                            >
                                {repairingMessages ? '⏳' : '🩺'}
                            </button>
                            <button
                                onClick={() => setTagsVisible(v => !v)}
                                className="text-base shrink-0 px-2 py-1 rounded-lg"
                                style={{ color: WA.textMuted, background: WA.white, border: `1px solid ${WA.borderLight}` }}
                                title={tagsVisible ? '隐藏标签' : '显示标签'}
                            >
                                🏷
                            </button>
                        </div>

                        {/* Floating event bar — mobile only, toggleable */}
                        <div
                            className="flex md:hidden overflow-x-auto px-4 py-2 gap-2 transition-all duration-200"
                            style={{
                                background: WA.white,
                                borderBottom: `1px solid ${WA.borderLight}`,
                                maxHeight: tagsVisible ? '60px' : '0',
                                overflowX: 'auto',
                                overflowY: 'hidden',
                                opacity: tagsVisible ? 1 : 0,
                            }}
                        >
                            {creator && creator.joinbrands && (
                                <>
                                    {conversationStatusMeta?.label && <EventPill label={conversationStatusMeta.label} color={conversationStatusMeta.color} bg={conversationStatusMeta.bg} />}
                                    {trialPhaseMeta && <EventPill label={trialPhaseMeta.label} color={trialPhaseMeta.color} bg={trialPhaseMeta.bg} />}
                                    {signalBadges.map((badge) => (
                                        <EventPill key={badge.key} label={badge.label} color={badge.color} bg={badge.bg} />
                                    ))}
                                </>
                            )}
                        </div>
                    </>
                )}

                {/* Translation Progress Bar */}
                {translating && translateProgress && typeof translateProgress === 'string' && (
                    <div className="px-4 py-2 flex items-center gap-3" style={{ background: 'rgba(0,168,132,0.15)', borderBottom: `1px solid rgba(0,168,132,0.3)` }}>
                        <span className="text-xs" style={{ color: WA.teal }}>🌐 翻译中</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,168,132,0.2)' }}>
                            <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                    background: WA.teal,
                                    width: `${(parseInt(translateProgress.split('/')[0]) / parseInt(translateProgress.split('/')[1])) * 100}%`,
                                }}
                            />
                        </div>
                        <span className="text-xs font-mono" style={{ color: WA.teal }}>{translateProgress}</span>
                    </div>
                )}

                {lastRepairSummary && (
                    <div className="px-4 py-2 flex items-center gap-3 text-xs" style={{ background: 'rgba(59,130,246,0.10)', borderBottom: `1px solid rgba(59,130,246,0.18)`, color: '#1d4ed8' }}>
                        <span>{lastRepairSummary.queued ? '🩺 已排队，等待同步完成后自动修复' : '🩺 已按手机号重爬修复'}</span>
                        {!lastRepairSummary.queued && (
                            <>
                                <span>检查 {lastRepairSummary.checked} 条</span>
                                <span>补齐 {lastRepairSummary.inserted}</span>
                                <span>修正 role {lastRepairSummary.updated}</span>
                                <span>删除重复 {lastRepairSummary.deleted}</span>
                            </>
                        )}
                        {lastRepairSummary.sessionId && <span>via {lastRepairSummary.sessionId}</span>}
                    </div>
                )}

                {lastSyncSummary && (
                    <div className="px-4 py-2 flex items-center gap-3 text-xs" style={{ background: 'rgba(16,185,129,0.10)', borderBottom: `1px solid rgba(16,185,129,0.18)`, color: '#047857' }}>
                        <span>🔄 已完成增量更新</span>
                        <span>检查 {lastSyncSummary.checked} 条</span>
                        <span>新增 {lastSyncSummary.inserted}</span>
                        <span>跳过 {lastSyncSummary.skipped}</span>
                        {lastSyncSummary.sessionId && <span>via {lastSyncSummary.sessionId}</span>}
                    </div>
                )}

                {/* Chat area — 最新消息在底部 */}
                <div
                    ref={chatScrollRef}
                    className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3"
                    style={{
                        backgroundColor: WA.chatBg,
                        backgroundImage: CHAT_PATTERN,
                        backgroundSize: '24px 24px',
                    }}
                    onScroll={handleChatScroll}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                >
                    {(hasOlderMessages || loadingOlder) && (
                        <div className="flex justify-center mb-4">
                            <button
                                type="button"
                                onClick={loadOlderMessages}
                                disabled={loadingOlder}
                                className="text-xs px-4 py-1.5 rounded-full transition-all disabled:opacity-60"
                                style={{
                                    background: 'rgba(0,0,0,0.05)',
                                    color: WA.textMuted,
                                    border: `1px solid ${WA.borderLight}`,
                                }}
                            >
                                {loadingOlder ? '⏳ 正在加载更早消息…' : `⬆️ 加载更早消息（还剩 ${Math.max(messageTotal - loadedServerCount, 0)} 条）`}
                            </button>
                        </div>
                    )}
                    {/* Watermark */}
                    <div className="flex justify-center mb-5">
                        <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.03)', color: WA.textMuted }}>
                            消息已端对端加密
                        </div>
                    </div>

                    {groupedMessages.map((item) => {
                        if (item.type === 'date') {
                            return (
                                <div key={item.id} className="flex justify-center my-4">
                                    <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                                        {item.date}
                                    </div>
                                </div>
                            );
                        }

                        const isMe = item.role === 'me';
                        const mediaUrl = getMessageMediaUrl(item);
                        const fileName = getMessageFileName(item);
                        const mimeType = getMessageMime(item);
                        const captionText = getMessageCaption(item);
                        const isImage = hasMediaAttachment(item) && isImageMessage(item);
                        const isFile = hasMediaAttachment(item) && !isImage;
                        return (
                            <div
                                key={item.uiKey}
                                ref={(node) => {
                                    if (node) messageNodeRefs.current.set(item.uiKey, node);
                                    else messageNodeRefs.current.delete(item.uiKey);
                                }}
                                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className="max-w-[74%] px-4 py-3 text-sm leading-relaxed"
                                    style={{
                                        background: isMe ? '#DCF8C6' : WA.bubbleIn,
                                        color: WA.textDark,
                                        borderRadius: isMe ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                                        boxShadow: highlightedMessageKey === item.uiKey
                                            ? '0 0 0 2px rgba(0,168,132,0.18), 0 10px 26px rgba(0,168,132,0.14)'
                                            : '0 1px 1px rgba(17,29,26,0.12)',
                                        border: item.failed
                                            ? '1px solid rgba(220,38,38,0.45)'
                                            : highlightedMessageKey === item.uiKey
                                                ? '1px solid rgba(0,168,132,0.55)'
                                                : isMe ? '1px solid rgba(169,220,146,0.55)' : `1px solid ${WA.borderLight}`,
                                        opacity: item.pending ? 0.72 : 1,
                                        transition: 'opacity 0.2s ease',
                                    }}
                                >
                                    {isImage ? (
                                        <div className="space-y-2">
                                            {mediaUrl && (
                                                <a
                                                    href={mediaUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="block overflow-hidden rounded-[8px]"
                                                    style={{ border: `1px solid ${WA.borderLight}` }}
                                                >
                                                    <img
                                                        src={mediaUrl}
                                                        alt={fileName || 'image'}
                                                        className="block w-full max-h-[320px] object-cover"
                                                    />
                                                </a>
                                            )}
                                            {captionText && (
                                                <div className="whitespace-pre-wrap">{captionText}</div>
                                            )}
                                        </div>
                                    ) : isFile ? (
                                        <div className="space-y-2">
                                            <div
                                                className="rounded-[10px] px-3 py-3 flex items-center gap-3"
                                                style={{
                                                    background: isMe ? 'rgba(255,255,255,0.55)' : 'rgba(15,118,110,0.05)',
                                                    border: `1px solid ${isMe ? 'rgba(169,220,146,0.4)' : WA.borderLight}`,
                                                }}
                                            >
                                                <div
                                                    className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0"
                                                    style={{ background: 'rgba(255,255,255,0.72)', border: `1px solid ${WA.borderLight}` }}
                                                >
                                                    <FileIcon />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-semibold truncate">{fileName || 'Attachment'}</div>
                                                    <div className="text-[11px]" style={{ color: WA.textMuted }}>{mimeType || 'file'}</div>
                                                </div>
                                                {mediaUrl && (
                                                    <a
                                                        href={mediaUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="px-3 py-2 rounded-[10px] text-[12px] font-semibold"
                                                        style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
                                                    >
                                                        打开
                                                    </a>
                                                )}
                                            </div>
                                            {captionText && (
                                                <div className="whitespace-pre-wrap">{captionText}</div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="whitespace-pre-wrap">{item.text}</div>
                                    )}
                                    {translationMap[item.translationKey] && (
                                        <div className="text-xs mt-1.5 pt-1.5 border-t" style={{ color: '#00a884', borderColor: 'rgba(0,0,0,0.08)' }}>
                                            <span className="inline-flex items-center gap-1"><GlobeIcon size={12} strokeWidth={2} />{translationMap[item.translationKey]}</span>
                                        </div>
                                    )}
                                    <div className="text-xs mt-1.5 flex justify-end items-center gap-1.5" style={{ color: isMe ? '#667781' : WA.textMuted }}>
                                        {String(item.text || '').trim() && (
                                            <button
                                                type="button"
                                                onClick={() => handleTranslateMessage(item)}
                                                disabled={translatingMessageKey === item.translationKey}
                                                className="w-6 h-6 rounded-full inline-flex items-center justify-center transition-all disabled:opacity-60"
                                                style={{
                                                    color: translationMap[item.translationKey] ? WA.teal : (isMe ? '#667781' : WA.textMuted),
                                                    background: translationMap[item.translationKey] ? 'rgba(15,118,110,0.12)' : 'rgba(255,255,255,0.55)',
                                                    border: `1px solid ${translationMap[item.translationKey] ? 'rgba(15,118,110,0.18)' : 'rgba(0,0,0,0.06)'}`,
                                                }}
                                                title={translationMap[item.translationKey] ? '关闭这条翻译' : '翻译这条消息'}
                                            >
                                                {translatingMessageKey === item.translationKey
                                                    ? <SpinnerIcon color="currentColor" />
                                                    : <GlobeIcon size={13} strokeWidth={2} />}
                                            </button>
                                        )}
                                        <span>{formatTime(item.normalizedTimestamp)}</span>
                                        {isMe && (
                                            item.pending ? (
                                                <span style={{ color: '#94a3b8' }} title="发送中…">🕐</span>
                                            ) : item.failed ? (
                                                <>
                                                    <span style={{ color: '#dc2626' }} title={item.failedReason || '发送失败'}>⚠ 未送达</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRetryFailedMessage(item)}
                                                        disabled={sendingText || sendingMedia || generating}
                                                        className="disabled:opacity-50 disabled:cursor-not-allowed"
                                                        style={{
                                                            color: '#0f766e',
                                                            fontWeight: 600,
                                                            textDecoration: 'underline',
                                                            background: 'transparent',
                                                            border: 'none',
                                                            padding: 0,
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        重试
                                                    </button>
                                                </>
                                            ) : (
                                                <span>✓✓</span>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 3 选 1 Picker — 位于输入框上方 */}
                {activeReplyContext && (
                    <AIReplyPicker
                        incomingMsg={activeReplyContext.incomingMsg}
                        templateDeck={templateDeck}
                        aiDeck={activePicker?.candidates ? {
                            opt1: activePicker.candidates.opt1,
                            opt2: activePicker.candidates.opt2,
                        } : null}
                        operatorLabel={activePicker?.operatorDisplayName || activePicker?.operator || activeReplyContext.operator || 'Base'}
                        operatorConfigured={activePicker?.operatorConfigured}
                        promptVersion={activePicker?.systemPromptVersion}
                        onSelect={handleSelectCandidate}
                        onSkip={handleSkip}
                        onEditCandidate={handleEditCandidate}
                        onSaveTemplate={handleSaveTemplateFromCard}
                        onUpdateTemplate={handleUpdateTemplateFromCard}
                        onSendTemplateMedia={sendTemplateMediaItem}
                        onGenerateAi={handleBotIconClick}
                        onRegenerate={handleRegenerate}
                        onRetryTemplates={() => activeReplyContext && loadTemplateDeck(activeReplyContext)}
                        templateLoading={templateLoading}
                        templateError={templateError}
                        loading={pickerLoading}
                        generating={generating}
                        sending={sendingText}
                        error={pickerError}
                        compactMobile={isMobileViewport}
                        collapsed={isMobileViewport ? pickerCollapsed : false}
                        onToggleCollapse={() => setPickerCollapsed(v => !v)}
                        deckHeight={!isMobileViewport ? (replyDeckHeight || 420) : null}
                        onResizeStart={handleReplyDeckResizeStart}
                    />
                )}

                {writeBlocked && (
                    <div
                        className="px-4 py-2 text-xs"
                        style={{
                            background: 'rgba(245,158,11,0.12)',
                            color: '#92400e',
                            borderTop: `1px solid ${WA.borderLight}`,
                            textAlign: 'center',
                        }}
                    >
                        跨 owner 只读：该达人归属 {targetOwner || '其他 owner'}，你只能给 {viewerOwnOwner} 下的达人发消息
                    </div>
                )}
                {/* Input area */}
                <div
                    className="px-4 md:px-5 py-3 md:py-4 flex items-center gap-2 md:gap-3 border-t"
                    style={{
                        background: WA.shellPanelStrong,
                        borderTop: `1px solid ${WA.borderLight}`,
                        position: 'relative',
                        paddingBottom: viewportOffset ? `${viewportOffset + 8}px` : undefined,
                    }}
                >
                    {pendingImage && (
                        <div
                            className="rounded-xl px-3 py-2 flex items-center gap-3"
                            style={{
                                position: 'absolute',
                                left: '12px',
                                right: '12px',
                                bottom: 'calc(100% + 8px)',
                                background: WA.white,
                                border: `1px solid ${WA.borderLight}`,
                                boxShadow: WA.shellShadow,
                                zIndex: 25,
                            }}
                        >
                            <img
                                src={pendingImage.previewUrl}
                                alt={pendingImage.fileName}
                                className="w-11 h-11 rounded-lg object-cover shrink-0"
                                style={{ border: `1px solid ${WA.borderLight}` }}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs truncate" style={{ color: WA.textDark }}>{pendingImage.fileName}</div>
                                <div className="text-[11px]" style={{ color: WA.textMuted }}>{formatBytes(pendingImage.size)} · 可选输入 caption 后发送</div>
                            </div>
                            <button
                                onClick={clearPendingImage}
                                className="w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ color: WA.textMuted }}
                                title="移除图片"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                    <input
                        ref={mediaInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageFileChange}
                    />
                    {/* Emoji picker button */}
                    <button
                        onClick={() => {
                            emojiSkipCloseRef.current = true;
                            setEmojiPickerOpen(v => !v);
                        }}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all"
                        style={{
                            color: emojiPickerOpen ? WA.teal : WA.textMuted,
                            background: WA.white,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                        title="表情"
                    >
                        <SmileIcon />
                    </button>
                    <button
                        onClick={handlePickImage}
                        disabled={sendingMedia || writeBlocked}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
                        style={{
                            color: pendingImage ? '#2563eb' : WA.textMuted,
                            background: WA.white,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                        title={writeBlockedTitle || '上传图片'}
                    >
                        {sendingMedia ? <SpinnerIcon /> : <ImageIcon />}
                    </button>

                    {/* 📌 手动开启新话题按钮 + 下拉菜单 */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setTopicDropdownOpen(v => !v)}
                            className="h-9 md:h-11 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium shrink-0 transition-all"
                            style={{
                                background: topicDropdownOpen
                                    ? 'rgba(37,99,235,0.12)'
                                    : currentTopic
                                        ? 'rgba(37,99,235,0.08)'
                                        : WA.white,
                                color: topicDropdownOpen || currentTopic ? '#2563eb' : WA.textMuted,
                                border: `1px solid ${topicDropdownOpen || currentTopic ? 'rgba(37,99,235,0.2)' : WA.borderLight}`,
                            }}
                            title="选择话题类型，开启新话题上下文"
                        >
                            <TopicIcon />
                            <span className="hidden sm:inline">新话题</span>
                            <span className="text-xs opacity-60">▾</span>
                        </button>

                        {/* 话题下拉菜单 */}
                        {topicDropdownOpen && (
                            <div
                                className="rounded-xl py-2 shadow-2xl overflow-y-auto"
                                style={{
                                    position: 'absolute',
                                    bottom: '52px',
                                    left: '0',
                                    width: '320px',
                                    maxHeight: '460px',
                                    background: WA.white,
                                    border: `1px solid ${WA.borderLight}`,
                                    boxShadow: WA.shellShadow,
                                    zIndex: 1001,
                                }}
                            >
                                <div className="px-3 py-1.5 border-b mb-1 flex items-center justify-between gap-2" style={{ borderColor: WA.borderLight }}>
                                    <span className="text-xs font-semibold" style={{ color: WA.textMuted }}>选择业务话题组</span>
                                    <button
                                        type="button"
                                        onClick={() => openCreateTopicModal()}
                                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                                        style={{ color: WA.teal, border: `1px solid rgba(15,118,110,0.22)`, background: 'rgba(15,118,110,0.08)' }}
                                    >
                                        新增话题
                                    </button>
                                </div>
                                {TOPIC_GROUP_ORDER.map((key) => {
                                    const active = (currentTopic?.topic_group || currentTopic?.topic_key) === key;
                                    const subtopics = TOPIC_GROUP_SUBTOPICS[key] || [];
                                    const savedInGroup = savedCustomTopicTemplates
                                        .filter((item) => (item.topic_group || 'custom_topic') === key)
                                        .slice(0, 8);
                                    return (
                                        <div key={key} className="px-2 py-1">
                                            <button
                                                onClick={() => {
                                                    const defaultIntent = subtopics[0] || null;
                                                    handleSelectTopicTemplate({
                                                        topicGroup: key,
                                                        intentKey: defaultIntent,
                                                        label: getIntentLabel(defaultIntent, TOPIC_GROUP_LABELS[key]),
                                                    });
                                                }}
                                                className="w-full text-left px-2.5 py-2 text-xs transition-colors flex items-center gap-2 rounded-lg"
                                                style={{
                                                    color: active ? '#2563eb' : WA.textDark,
                                                    background: active ? 'rgba(37,99,235,0.08)' : 'transparent',
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.06)'}
                                                onMouseLeave={e => e.currentTarget.style.background = active ? 'rgba(37,99,235,0.08)' : 'transparent'}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? '#2563eb' : WA.borderLight }} />
                                                <span className="font-semibold">{TOPIC_GROUP_LABELS[key]}</span>
                                            </button>
                                            {subtopics.length > 0 && (
                                                <div className="ml-3 mt-1 flex flex-wrap gap-1.5">
                                                    {subtopics.map((intentKey) => {
                                                        const subActive = active && currentTopic?.intent_key === intentKey;
                                                        return (
                                                            <button
                                                                key={intentKey}
                                                                onClick={() => handleSelectTopicTemplate({
                                                                    topicGroup: key,
                                                                    intentKey,
                                                                    label: getIntentLabel(intentKey, TOPIC_GROUP_LABELS[key]),
                                                                })}
                                                                className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors"
                                                                style={{
                                                                    background: subActive ? 'rgba(37,99,235,0.13)' : WA.shellPanelMuted,
                                                                    color: subActive ? '#2563eb' : WA.textMuted,
                                                                    border: `1px solid ${subActive ? 'rgba(37,99,235,0.22)' : WA.borderLight}`,
                                                                }}
                                                            >
                                                                {getIntentLabel(intentKey)}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {savedInGroup.length > 0 && (
                                                <div className="ml-3 mt-1 flex flex-wrap gap-1.5">
                                                    {savedInGroup.map((item) => {
                                                        const itemActive = currentTopic?.custom_template_id === item.id;
                                                        return (
                                                            <button
                                                                key={item.id || item.label}
                                                                onClick={() => handleSelectTopicTemplate({
                                                                    topicGroup: item.topic_group || 'custom_topic',
                                                                    intentKey: item.intent_key || 'custom_template',
                                                                    sceneKey: item.scene_key || 'follow_up',
                                                                    label: item.label,
                                                                    customTemplateText: item.template_text,
                                                                    customTemplateId: item.id || null,
                                                                    customTemplateMediaItems: item.media_items || [],
                                                                })}
                                                                className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors"
                                                                style={{
                                                                    background: itemActive ? 'rgba(15,118,110,0.14)' : 'rgba(15,118,110,0.06)',
                                                                    color: itemActive ? WA.teal : '#0f766e',
                                                                    border: `1px solid ${itemActive ? 'rgba(15,118,110,0.25)' : 'rgba(15,118,110,0.14)'}`,
                                                                }}
                                                                title={item.template_text || ''}
                                                            >
                                                                {item.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* 点击空白关闭下拉菜单 */}
                    {topicDropdownOpen && (
                        <div
                            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
                            onClick={() => setTopicDropdownOpen(false)}
                        />
                    )}

                    {/* Emoji picker — always mounted, controlled via open prop */}
                    <div
                        className="emoji-picker-wrapper"
                        style={{
                            position: 'absolute',
                            bottom: '60px',
                            left: '16px',
                            zIndex: 1000,
                        }}
                    >
                        <EmojiPicker
                            open={emojiPickerOpen}
                            onEmojiClick={handleEmojiClick}
                            width={320}
                            height={380}
                            theme="dark"
                            previewReaction={false}
                            skinTonesDisabled
                        />
                    </div>

                    {/* 🌐 主输入框翻译按钮 — 走 DeepL，与生成候选解耦；再点一次 undo */}
                    {(() => {
                        const isUndoState = (
                            inputOriginalBeforeTranslate !== null &&
                            lastTranslatedInputText !== null &&
                            inputText === lastTranslatedInputText
                        );
                        const disabled = translatingInput || emojiEnhancingInput || writeBlocked || (!inputText.trim() && !isUndoState);
                        const title = writeBlocked
                            ? (writeBlockedTitle || '只读')
                            : isUndoState
                                ? '再点一次还原原文'
                                : '翻译输入框文本（DeepL，auto 方向）';
                        return (
                            <button
                                onClick={handleTranslateInput}
                                disabled={disabled}
                                className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                                style={{
                                    color: isUndoState ? '#ffffff' : WA.textMuted,
                                    background: isUndoState ? WA.teal : WA.white,
                                    border: `1px solid ${isUndoState ? WA.teal : WA.borderLight}`,
                                }}
                                title={title}
                            >
                                {translatingInput ? <SpinnerIcon /> : <GlobeIcon />}
                            </button>
                        );
                    })()}

                    {/* 🪄 主输入框 Emoji 润色按钮 — AI 在不改变原意的前提下加 1-3 个 emoji
                        注意:用 WandIcon 而不是 SparkIcon,避免与右侧圆绿色"AI 生成候选"按钮视觉重复 */}
                    {(() => {
                        const disabled = emojiEnhancingInput || translatingInput || writeBlocked || !inputText.trim();
                        const title = writeBlocked
                            ? (writeBlockedTitle || '只读')
                            : 'Emoji 润色：AI 为消息框文本加 1-3 个 emoji（保持原语言）';
                        return (
                            <button
                                onClick={handleEmojiInput}
                                disabled={disabled}
                                className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                                style={{
                                    color: WA.textMuted,
                                    background: WA.white,
                                    border: `1px solid ${WA.borderLight}`,
                                }}
                                title={title}
                            >
                                {emojiEnhancingInput ? <SpinnerIcon /> : <WandIcon />}
                            </button>
                        );
                    })()}

                    <div
                        className="flex-1 flex items-center rounded-3xl px-4 md:px-5 py-3 md:py-3.5 border"
                        style={{ background: WA.white, borderColor: WA.borderLight }}
                    >
                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder="输入消息，或直接点击右下角 🤖 为最新消息生成回复..."
                            rows={2}
                            className="flex-1 bg-transparent text-sm focus:outline-none resize-none"
                            style={{ maxHeight: '240px', color: WA.textDark }}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    // IME 拼音组合未上屏 / 操作飞行中 / e.repeat 长按：不触发发送
                                    if (isComposing || e.nativeEvent?.isComposing || e.repeat) return;
                                    if (sendLockRef.current || generating || sendingMedia || sendingText || writeBlocked) return;
                                    e.preventDefault();
                                    if (pendingImage) {
                                        handleDirectSendMedia();
                                    } else if (inputText.trim()) {
                                        handleManualGenerate();
                                    }
                                }
                            }}
                            onInput={e => {
                                e.target.style.height = 'auto';
                                e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
                            }}
                        />
                    </div>

                    {(inputText.trim() || pendingImage) ? (
                        <div className="flex gap-2 shrink-0">
                            {/* 🤖 AI 生成候选 */}
                            {!pendingImage && inputText.trim() && (
                                <button
                                    onClick={handleManualGenerate}
                                    disabled={generating || sendingText || sendingMedia || writeBlocked}
                                    className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{ background: WA.teal }}
                                    title={writeBlockedTitle || 'AI 生成候选回复'}
                                >
                                    {generating ? <SpinnerIcon color="#ffffff" /> : <SparkIcon color="#ffffff" />}
                                </button>
                            )}
                            {/* ➤ 直接发送 */}
                            <button
                                onClick={() => {
                                    if (pendingImage) {
                                        handleDirectSendMedia();
                                        return;
                                    }
                                    handleDirectSend(inputText);
                                }}
                                disabled={sendingMedia || sendingText || generating || writeBlocked || (!pendingImage && !inputText.trim())}
                                className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ background: '#3b82f6' }}
                                title={
                                    writeBlockedTitle
                                    || (pendingImage ? '发送图片（可附带 caption）' : '直接发送')
                                }
                            >
                                {(sendingMedia || sendingText) ? <SpinnerIcon color="#ffffff" /> : <SendIcon color="#ffffff" />}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleBotIconClick}
                            disabled={pickerLoading || writeBlocked}
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
                            style={{
                                background: activePicker
                                    ? '#3b82f6'
                                    : pickerLoading
                                        ? WA.shellPanelMuted
                                        : WA.white,
                                border: activePicker ? '1px solid transparent' : `1px solid ${WA.borderLight}`,
                                opacity: pickerLoading ? 0.7 : 1,
                            }}
                            title={
                                writeBlockedTitle
                                || (activePicker
                                    ? '🔄 重新生成回复'
                                    : pickerLoading
                                        ? '生成中...'
                                        : '🤖 为最新消息生成回复')
                            }
                        >
                            {pickerLoading ? (
                                <SpinnerIcon />
                            ) : activePicker ? (
                                <RefreshIcon color="#ffffff" />
                            ) : (
                                <SparkIcon />
                            )}
                        </button>
                    )}
                </div>
            </div>
            {templateManageModalView}
        </>
    );
}

function IconButton({ children, title, onClick, disabled, active = false }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
            style={{
                background: active ? 'rgba(15,118,110,0.12)' : WA.white,
                color: active ? WA.teal : WA.textMuted,
                border: `1px solid ${active ? 'rgba(15,118,110,0.18)' : WA.borderLight}`,
            }}
        >
            {children}
        </button>
    );
}

function StrokeIcon({ children, size = 18, strokeWidth = 1.85, color = 'currentColor', viewBox = '0 0 24 24' }) {
    return (
        <svg width={size} height={size} viewBox={viewBox} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

function ArrowLeftIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M15 18l-6-6 6-6" />
            <path d="M9 12h10" />
        </StrokeIcon>
    );
}

function RefreshIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M20 11a8 8 0 1 0 2.2 5.5" />
            <path d="M20 4v7h-7" />
        </StrokeIcon>
    );
}

function RepairIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M14 5a4 4 0 0 0 5 5l-8 8a2 2 0 1 1-3-3l8-8Z" />
            <path d="M16 8l3-3" />
        </StrokeIcon>
    );
}

function GlobeIcon({ size = 18, strokeWidth = 1.85, color = 'currentColor' }) {
    return (
        <StrokeIcon size={size} strokeWidth={strokeWidth} color={color}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 0 18" />
            <path d="M12 3a15 15 0 0 0 0 18" />
        </StrokeIcon>
    );
}

function SmileIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
            <path d="M9 10h.01" />
            <path d="M15 10h.01" />
        </StrokeIcon>
    );
}

function ImageIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M8 13l2.5-2.5a1.2 1.2 0 0 1 1.7 0L17 15" />
            <path d="M14 12l1-1a1.2 1.2 0 0 1 1.7 0l2.3 2.3" />
            <circle cx="9" cy="9" r="1" />
        </StrokeIcon>
    );
}

function FileIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9Z" />
            <path d="M14 3v6h6" />
            <path d="M9 14h6" />
            <path d="M9 17h4" />
        </StrokeIcon>
    );
}

function TopicIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M7 4h8l2 3-2 3H7z" />
            <path d="M7 4v16" />
        </StrokeIcon>
    );
}

function SparkIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
        </StrokeIcon>
    );
}

function SendIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M21 3L10 14" />
            <path d="M21 3l-7 18-4-7-7-4 18-7Z" />
        </StrokeIcon>
    );
}

// 魔杖图标：主输入框 Emoji 润色按钮专用，和 SparkIcon(AI 生成)区分开
function WandIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M15 4V2" />
            <path d="M15 10V8" />
            <path d="M12 7h2" />
            <path d="M16 7h2" />
            <path d="M20 12l-9 9-3-3 9-9 3 3Z" />
            <path d="M13 14l3 3" />
        </StrokeIcon>
    );
}

function SpinnerIcon({ color = 'currentColor' }) {
    return (
        <StrokeIcon color={color}>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 5v5h-5" />
        </StrokeIcon>
    );
}

// ====== EventPill（悬浮事件标签）======
function EventPill({ label, color, bg }) {
    return (
        <span
            className="text-xs px-3 py-1.5 rounded-full font-semibold shrink-0"
            style={{ background: bg || color + '20', color }}
        >
            {label}
        </span>
    );
}

export default WAMessageComposer;
