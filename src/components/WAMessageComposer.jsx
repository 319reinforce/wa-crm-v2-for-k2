import React, { useState, useEffect, useRef, useCallback } from 'react';
import EmojiPicker from 'emoji-picker-react';
import AIReplyPicker from './AIReplyPicker';
import { buildConversation, buildRichContext, computeSimilarity } from './WAMessageComposer/ai/extractors';
import { inferAutoTopic, startNewTopic } from './WAMessageComposer/ai/topicDetector';
import { generateViaExperienceRouter } from './WAMessageComposer/ai/experienceRouter';
import { useMessagePolling } from './WAMessageComposer/hooks/useMessagePolling';
import { TOPIC_LABELS } from './WAMessageComposer/constants/topicLabels';
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api';
import { fetchWaAdmin } from '../utils/waAdmin';
import { fetchAppAuth } from '../utils/appAuth';
import { DEFAULT_UNBOUND_AGENCY_STRATEGIES, normalizeUnboundAgencyStrategies } from '../utils/unboundAgencyStrategies';
import WA from '../utils/waTheme';

const API_BASE = '/api';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const CHAT_PATTERN = [
    'radial-gradient(circle at 1px 1px, rgba(111,106,98,0.05) 1px, transparent 0)',
    'radial-gradient(circle at 12px 12px, rgba(111,106,98,0.03) 1px, transparent 0)',
].join(', ');
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
    const full = creator?._full || creator || {};
    const wacrm = full.wacrm || {};
    const joinbrands = full.joinbrands || {};
    const urgencyLevel = Number(wacrm.urgency_level || 0);
    const isUrgent = wacrm.priority === 'urgent' || urgencyLevel >= 8 || !!joinbrands.ev_churned;
    const isAgencyProspect = !isUrgent && !wacrm.agency_bound && !joinbrands.ev_agency_bound;

    if (isUrgent) {
        return {
            label: '紧急跟进',
            bg: 'rgba(251,146,60,0.12)',
            color: '#fb923c',
        };
    }

    if (isAgencyProspect) {
        return {
            label: 'Agency 转化中',
            bg: 'rgba(16,185,129,0.14)',
            color: '#047857',
        };
    }

    return null;
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

export function WAMessageComposer({ client, creator, jumpTarget, onClose, onSwipeLeft, onMessageSent, onCreatorUpdated, asPanel }) {
    const [inputText, setInputText] = useState('');
    const [generating, setGenerating] = useState(false);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [translating, setTranslating] = useState(false);
    // 翻译进度：null = 未翻译, 'n/t' = 翻译中
    const [translateProgress, setTranslateProgress] = useState(null);
    // 翻译 map：key = message_key，value = 中文翻译
    const [translationMap, setTranslationMap] = useState({});

    // 当前活跃的 AI 候选
    const [activePicker, setActivePicker] = useState(null);
    const [pickerCustom, setPickerCustom] = useState('');
    const [customToolLoading, setCustomToolLoading] = useState({ translate: false, emoji: false });
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerError, setPickerError] = useState(null);
    const [pickerCollapsed, setPickerCollapsed] = useState(false);
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
        try {
            return await fetchJsonOrThrow(`${API_BASE}/policy-documents?active_only=true`, {
                signal: AbortSignal.timeout(15000),
            });
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

    // 预加载政策文档和客户记忆，LOAD 完成后触发 AI 生成
    useEffect(() => {
        if (!client?.id || !client?.phone) return;

        // 清除旧状态
        setActivePicker(null);
        setPendingCandidates([]);
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
        clearPendingImage();
        jumpContextUntilRef.current = 0;
        pendingCandidatesRef.current = [];
        lastActivityRef.current = null;

        // 每个新达人都+1，这样旧达人的异步生成结果会被忽略
        const currentRace = ++generationRaceRef.current;
        let cancelled = false;

        const load = async () => {
            const creatorId = client?.id;
            const [docs, mem, evtData, strategyConfig] = await Promise.all([
                fetchPolicyDocs(),
                fetchJsonOrThrow(`${API_BASE}/client-memory/${client.phone}`, {
                    signal: AbortSignal.timeout(15000),
                })
                    .catch(() => []),
                creatorId
                    ? fetchJsonOrThrow(`${API_BASE}/events/summary/${creatorId}`, {
                        signal: AbortSignal.timeout(15000),
                    })
                        .catch(() => ({ events: [] }))
                    : Promise.resolve({ events: [] }),
                fetchUnboundAgencyStrategies(),
            ]);
            // 检查：期间是否切换过达人？
            if (cancelled || currentRace !== generationRaceRef.current) return;
            setPolicyDocs(docs);
            setClientMemory(mem || []);
            setAgencyStrategies(strategyConfig);
            setAllEvents(evtData.events || []);
            setActiveEvents((evtData.events || []).filter(e => e.status === 'active'));

            // 等 policyDocs 加载后再生成
            try {
                const data = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
                    signal: AbortSignal.timeout(15000),
                });
                const { msgs, total } = unpackMessageResponse(data);
                setMessages(msgs);
                setMessageTotal(total);
                setLoadedServerCount(msgs.length);
                const latestTs = getLatestMessageTimestamp(msgs);
                if (latestTs > 0) lastActivityRef.current = latestTs;
                if (cancelled || currentRace !== generationRaceRef.current || msgs.length === 0) return;
                const lastMsg = getLatestIncomingMessage(msgs);
                if (!lastMsg) return;
                const result = await generateForIncoming(lastMsg);
                if (result && currentRace === generationRaceRef.current) {
                    pushPicker(result);
                }
            } catch (e) {
                console.error('[generateOnSwitch] error:', e);
            }
        };
        load();

        return () => {
            cancelled = true;
        };
    }, [client?.phone, client?.msg_count, creator?.msg_count, clearPendingImage, unpackMessageResponse]);

    // 为一条 incoming 消息生成候选
    const generateForIncoming = useCallback(async (incomingMsg) => {
        if (!client?.id || !client?.phone) return null;
        setPickerLoading(true);
        setPickerError(null);
        try {
            // 重新 fetch 最新消息，避免闭包 stale 问题
            const msgsData = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
                signal: AbortSignal.timeout(15000),
            });
            const { msgs } = unpackMessageResponse(msgsData);
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
    }, [client, creator, policyDocs, clientMemory, agencyStrategies, currentTopic, autoDetectedTopic, unpackMessageResponse]);

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
            setMessages((prev) => mergeChronologicalMessages(prev, freshMsgs));
            setLoadedServerCount((prev) => Math.max(prev, freshMsgs.length));
        },
        setMessageTotal,
        generateForIncoming,
        pushPicker,
        lastActivityRef,
        pendingCandidatesRef,
        activePickerRef,
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
            alert('仅支持图片文件（jpg/png/webp/gif）');
            if (mediaInputRef.current) mediaInputRef.current.value = '';
            return;
        }
        if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
            alert(`图片过大：${formatBytes(file.size)}，上限 ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)}`);
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

    const handleDirectSendMedia = async () => {
        if (!pendingImage?.file || !client?.phone) return;
        setSendingMedia(true);
        try {
            const dataBase64 = await fileToDataUrl(pendingImage.file);
            const uploadRes = await fetchWaAdmin(`${API_BASE}/wa/media-assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creator_id: client.id,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    uploaded_by: creator?.wa_owner || client.wa_owner || 'api_user',
                    file_name: pendingImage.fileName,
                    mime_type: pendingImage.mimeType,
                    data_base64: dataBase64,
                    meta: { source: 'manual_upload', scene: currentTopic?.topic_key || null },
                }),
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok || !uploadData?.ok || !uploadData?.media_asset?.id) {
                throw new Error(uploadData?.error || `upload failed: HTTP ${uploadRes.status}`);
            }

            const caption = inputText.trim();
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

            const timelineText = sendData?.crm_message?.text
                || (caption ? `🖼️ [Image] ${caption}` : '🖼️ [Image]');
            const sentAt = Number(sendData?.crm_message?.timestamp) > 0
                ? Number(sendData.crm_message.timestamp)
                : Date.now();
            if (!sendData?.crm_message) {
                await persistCrmSentMessage(timelineText, sentAt);
            }
            setMessages((prev) => [...prev, {
                role: 'me',
                text: timelineText,
                caption,
                timestamp: sentAt,
                media_url: uploadData?.media_asset?.file_url || null,
                mime_type: uploadData?.media_asset?.mime_type || pendingImage.mimeType || null,
                file_name: uploadData?.media_asset?.file_name || pendingImage.fileName || null,
                previewUrl: pendingImage.previewUrl,
            }]);
            setMessageTotal((prev) => prev + 1);
            if (caption) {
                await extractAndSaveMemory(null, caption);
            }
            onMessageSent?.(client.id);
            setInputText('');
            clearPendingImage();
        } catch (e) {
            console.error('[WA Send Media] failed:', e);
            alert(`发送图片失败: ${e.message || '未知错误'}`);
        } finally {
            setSendingMedia(false);
        }
    };

    // 点了 bot 图标 → 强制为最新 incoming 消息重新生成候选
    const handleBotIconClick = async () => {
        // 重新 fetch 最新消息，避免切换达人后闭包 stale 问题
        const msgsData = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
            signal: AbortSignal.timeout(15000),
        }).catch(() => []);
        const freshMsgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);

        const incomingMsgs = freshMsgs.filter(m => m.role === 'user');
        const latestMsg = incomingMsgs[incomingMsgs.length - 1];
        if (!latestMsg) return;

        setActivePicker(null);
        setPendingCandidates([]);
        setPickerCustom('');
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
                    texts: last20.map(m => ({ text: m.text, role: m.role }))
                }),
                signal: AbortSignal.timeout(30000),
            });
            const data = await response.json();
            const newMap = {};
            if (data.translations && Array.isArray(data.translations)) {
                for (const t of data.translations) {
                    const idx = t.idx - 1; // idx 是 1-based
                    if (idx >= 0 && idx < last20.length) {
                        const key = getTranslationKey(last20[idx], `translate_${idx}`);
                        newMap[key] = t.translation || last20[idx].text;
                    }
                }
            }
            // 兜底：未翻译到的用原文
            last20.forEach((msg, idx) => {
                const key = getTranslationKey(msg, `translate_${idx}`);
                if (!newMap[key]) {
                    newMap[key] = msg.text;
                }
            });
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

    const runCustomTool = async (mode) => {
        const sourceText = pickerCustom.trim();
        if (!sourceText) return;

        const toolKey = mode === 'translate' ? 'translate' : 'emoji';
        setPickerError(null);
        setCustomToolLoading(prev => ({ ...prev, [toolKey]: true }));
        try {
            if (mode === 'translate') {
                const response = await fetchAppAuth(`${API_BASE}/translate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: sourceText,
                        mode: 'auto',
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data?.error || `HTTP ${response.status}`);
                }

                const transformed = String(data?.translation || '').trim();
                setPickerCustom(transformed || sourceText);
                return;
            }

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
            setPickerCustom(transformed || sourceText);
        } catch (e) {
            console.error('[customTool] error:', e);
            setPickerError(`自定义${mode === 'translate' ? '翻译' : 'Emoji润色'}失败：${e.message || '未知错误'}`);
        } finally {
            setCustomToolLoading(prev => ({ ...prev, [toolKey]: false }));
        }
    };

    const handleTranslateCustom = async () => {
        await runCustomTool('translate');
    };

    const handleEmojiCustom = async () => {
        await runCustomTool('emoji');
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
            const res = await fetchWaAdmin(`${API_BASE}/wa/reconcile-contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creator_id: client.id,
                    phone: client.phone,
                    operator: creator?.wa_owner || client.wa_owner || null,
                    session_id: creator?.session_id || client.session_id || null,
                    fetch_limit: 500,
                }),
            });
            const data = await res.json();
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
            alert(`修复消息失败: ${e.message || '未知错误'}`);
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
            alert(`增量更新失败: ${e.message || '未知错误'}`);
        } finally {
            setSyncingMessages(false);
        }
    };

    const sendOutboundMessage = async (sentText, { onError } = {}) => {
        const reportError = onError || ((message) => alert(`发送失败: ${message}`));

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
                reportError(data.error || '未知错误');
                return { ok: false };
            }
        } catch (e) {
            console.error('[WA Send] 发送失败:', e);
            reportError(e.message || '请求失败');
            return { ok: false };
        }

        const crmMessage = data?.crm_message || null;
        const sentAt = Number(crmMessage?.timestamp) > 0
            ? Number(crmMessage.timestamp)
            : Date.now();
        if (!crmMessage) {
            await persistCrmSentMessage(sentText, sentAt);
        }
        setMessages(prev => [...prev, { role: 'me', text: sentText, timestamp: sentAt }]);
        setMessageTotal((prev) => prev + 1);
        onMessageSent?.(client.id);
        return { ok: true, sentAt, crmMessage };
    };

    const persistSftRecord = async ({
        sentText,
        incomingMsg = null,
        modelCandidates,
        humanSelected,
        diffAnalysis,
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

    // 选择了候选 → 发送
    const handleSelectCandidate = async (selectedOpt) => {
        if (!activePicker) return;

        const sentText = selectedOpt === 'opt1'
            ? activePicker.candidates.opt1
            : selectedOpt === 'opt2'
                ? activePicker.candidates.opt2
                : pickerCustom.trim();

        if (!sentText) return;

        setPickerError(null);

        const sendResult = await sendOutboundMessage(sentText, {
            onError: (message) => setPickerError(message),
        });
        if (!sendResult?.ok) return;

        const sim1 = computeSimilarity(activePicker.candidates.opt1, sentText);
        const sim2 = computeSimilarity(activePicker.candidates.opt2, sentText);
        const bestSim = Math.max(sim1, sim2);
        const bestOpt = sim1 >= sim2 ? 'opt1' : 'opt2';
        const resolvedHumanSelected = selectedOpt === 'custom' ? 'custom' : selectedOpt;
        const isCustomSelection = selectedOpt === 'custom' || bestSim < 85;

        const diffAnalysis = {
            model_predicted: bestSim >= 85 ? activePicker.candidates[bestOpt] : null,
            model_rejected: bestSim >= 85 ? activePicker.candidates[bestOpt === 'opt1' ? 'opt2' : 'opt1'] : null,
            is_custom: isCustomSelection,
            human_reason: isCustomSelection
                ? `人工编辑发送（与AI候选最高相似度${bestSim}%）`
                : `直接采用方案${selectedOpt === 'opt1' ? 'A' : 'B'}（相似度${bestSim}%）`,
            similarity: bestSim
        };

        await persistSftRecord({
            sentText,
            incomingMsg: activePicker.incomingMsg,
            modelCandidates: { opt1: activePicker.candidates.opt1, opt2: activePicker.candidates.opt2 },
            humanSelected: resolvedHumanSelected,
            diffAnalysis,
            promptUsed: activePicker.systemPrompt || null,
            promptVersion: activePicker.systemPromptVersion || 'v2',
            retrievalSnapshotId: activePicker.retrievalSnapshotId || null,
            generationLogId: activePicker.generationLogId || null,
            provider: activePicker.provider || null,
            model: activePicker.model || null,
            sceneSource: activePicker.sceneSource || null,
            pipelineVersion: activePicker.pipelineVersion || 'reply_generation_v2',
        });

        await extractAndSaveMemory(activePicker.incomingMsg, sentText);

        setPickerCustom('');
        const [next, ...rest] = pendingCandidates;
        setPendingCandidates(rest);
        setActivePicker(next || null);
        setInputText('');
    };

    // 跳过 — 记录 feedback
    const handleSkip = async () => {
        // 记录 skip feedback
        if (activePicker?.incomingMsg) {
            try {
                await fetchOkOrThrow(`${API_BASE}/sft-feedback`, {
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
                });
            } catch (_) {}
        }
        setPickerCustom('');
        setPickerError(null);
        const [next, ...rest] = pendingCandidates;
        setPendingCandidates(rest);
        setActivePicker(next || null);
    };

    // 编辑候选 — 填充到输入框，关闭 picker
    const handleEditCandidate = (text) => {
        if (!text) return;
        setInputText(text);
        setActivePicker(null);
        setPendingCandidates([]);
        setPickerCustom('');
        setPickerError(null);
    };

    // 手动 AI 生成（输入框有文字时按 Enter 触发）
    const handleManualGenerate = async () => {
        if (!inputText.trim()) return;
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
                sceneSource: result.sceneSource || null,
                retrievalSnapshotId: result.retrievalSnapshotId || null,
                generationLogId: result.generationLogId || null,
                provider: result.provider || null,
                model: result.model || null,
                pipelineVersion: result.pipelineVersion || 'reply_generation_v2',
                generated_at: Date.now(),
                policyDocs,
            });
            setPickerCustom('');
        } catch (e) {
            console.error('生成失败:', e);
            alert(`生成失败: ${e.message}`);
        } finally {
            setGenerating(false);
        }
    };

    // 直接发送人工输入（不经过 AI 候选）
    const handleDirectSend = async (text) => {
        if (!text?.trim() || !client?.id) return;
        const sentText = text.trim();

        const sendResult = await sendOutboundMessage(sentText);
        if (!sendResult?.ok) return;

        await persistSftRecord({
            sentText,
            incomingMsg: null,
            modelCandidates: { opt1: sentText, opt2: '' },
            humanSelected: 'custom',
            diffAnalysis: { is_custom: true, human_reason: '人工直接发送', similarity: 100 },
        });

        await extractAndSaveMemory(null, sentText);

        setInputText('');
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
                                    📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
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
                                            📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
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
                                    {(creator.joinbrands.ev_trial_active || creator.joinbrands.ev_trial_7day) && <EventPill label="7天试用" color="#3b82f6" />}
                                    {creator.joinbrands.ev_monthly_invited && <EventPill label="月卡邀请" color="#8b5cf6" />}
                                    {creator.joinbrands.ev_monthly_joined && <EventPill label="月卡加入" color="#10b981" />}
                                    {creator.joinbrands.ev_whatsapp_shared && <EventPill label="WA已发" color="#00a884" />}
                                    {creator.joinbrands.ev_gmv_1k && <EventPill label="GMV 1K" color="#f59e0b" />}
                                    {creator.joinbrands.ev_gmv_2k && <EventPill label="GMV 2K" color="#f97316" />}
                                    {creator.joinbrands.ev_gmv_5k && <EventPill label="GMV 5K" color="#ea580c" />}
                                    {creator.joinbrands.ev_gmv_10k && <EventPill label="GMV 10K" color="#ef4444" />}
                                    {creator.joinbrands.ev_churned && <EventPill label="已流失" color="#ef4444" />}
                                </>
                            )}
                        </div>
                    </>
                )}

                <LifecycleJourneyStrip creator={creator} events={allEvents} />

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
                                        border: highlightedMessageKey === item.uiKey
                                            ? '1px solid rgba(0,168,132,0.55)'
                                            : isMe ? '1px solid rgba(169,220,146,0.55)' : `1px solid ${WA.borderLight}`,
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
                                    <div className="text-xs mt-1.5 flex justify-end" style={{ color: isMe ? '#667781' : WA.textMuted }}>
                                        {formatTime(item.normalizedTimestamp)}{isMe ? '  ✓✓' : ''}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 3 选 1 Picker — 位于输入框上方 */}
                {activePicker && (
                    <AIReplyPicker
                        incomingMsg={activePicker.incomingMsg}
                        candidates={activePicker.candidates}
                        operatorLabel={activePicker.operatorDisplayName || activePicker.operator || 'Base'}
                        operatorConfigured={activePicker.operatorConfigured}
                        promptVersion={activePicker.systemPromptVersion}
                        customText={pickerCustom}
                        onCustomChange={setPickerCustom}
                        onTranslateCustom={handleTranslateCustom}
                        onEmojiCustom={handleEmojiCustom}
                        customToolLoading={customToolLoading}
                        onSelect={handleSelectCandidate}
                        onSkip={handleSkip}
                        onEditCandidate={handleEditCandidate}
                        onRegenerate={handleRegenerate}
                        loading={pickerLoading}
                        error={pickerError}
                        compactMobile={isMobileViewport}
                        collapsed={isMobileViewport ? pickerCollapsed : false}
                        onToggleCollapse={() => setPickerCollapsed(v => !v)}
                        // 标准话术相关 props
                        onSelectStandard={(text) => {
                            setPickerCustom(text);
                            handleSelectCandidate('custom');
                        }}
                        scene={activePicker.scene}
                        operator={activePicker.operator}
                        clientId={client?.phone}
                        messages={messages}
                        currentTopic={currentTopic}
                        autoDetectedTopic={autoDetectedTopic}
                        activeEvents={activeEvents}
                        lifecycle={creator?._full?.lifecycle || creator?.lifecycle || null}
                        refreshToken={activePicker.generated_at || activePicker.incomingMsg?.timestamp || null}
                    />
                )}

                {/* Input area */}
                <div
                    className="px-4 md:px-5 py-3 md:py-4 flex items-end gap-2 md:gap-3 border-t"
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
                        disabled={sendingMedia}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
                        style={{
                            color: pendingImage ? '#2563eb' : WA.textMuted,
                            background: WA.white,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                        title="上传图片"
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
                                    width: '200px',
                                    maxHeight: '320px',
                                    background: WA.white,
                                    border: `1px solid ${WA.borderLight}`,
                                    boxShadow: WA.shellShadow,
                                    zIndex: 1001,
                                }}
                            >
                                <div className="px-3 py-1.5 text-xs font-semibold border-b mb-1" style={{ color: WA.textMuted, borderColor: WA.borderLight }}>
                                    选择话题类型
                                </div>
                                {Object.entries(TOPIC_LABELS).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            const newTopic = startNewTopic({
                                                trigger: 'manual',
                                                newText: inputText || label,
                                                messages,
                                            });
                                            newTopic.topic_key = key;
                                            setCurrentTopic(newTopic);
                                            setTopicDropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2"
                                        style={{
                                            color: currentTopic?.topic_key === key ? '#2563eb' : WA.textDark,
                                            background: currentTopic?.topic_key === key ? 'rgba(37,99,235,0.08)' : 'transparent',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.06)'}
                                        onMouseLeave={e => e.currentTarget.style.background = currentTopic?.topic_key === key ? 'rgba(37,99,235,0.08)' : 'transparent'}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: currentTopic?.topic_key === key ? '#2563eb' : WA.borderLight }} />
                                        {label}
                                    </button>
                                ))}
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
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
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
                                    disabled={generating}
                                    className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-50"
                                    style={{ background: WA.teal }}
                                    title="AI 生成候选回复"
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
                                disabled={sendingMedia}
                                className="w-11 h-11 rounded-full flex items-center justify-center"
                                style={{ background: '#3b82f6' }}
                                title={pendingImage ? '发送图片（可附带 caption）' : '直接发送'}
                            >
                                {sendingMedia ? <SpinnerIcon color="#ffffff" /> : <SendIcon color="#ffffff" />}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleBotIconClick}
                            disabled={pickerLoading}
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all"
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
                                activePicker
                                    ? '🔄 重新生成回复'
                                    : pickerLoading
                                        ? '生成中...'
                                        : '🤖 为最新消息生成回复'
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
