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

const API_BASE = '/api';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  tealDark: '#008069',
  lightBg: '#f0f2f5',
  chatBg: '#efeae2',
  white: '#ffffff',
  searchBg: '#f0f2f5',
  borderLight: '#e9edef',
  bubbleOut: '#d9fdd3',
  bubbleIn: '#ffffff',
  textDark: '#111b21',
  textMuted: '#667781',
  hover: '#f5f6f6',
  darkHover: '#202c33',
  darkBg: '#111b21',
  darkCard: '#1f2c33',
  inputBg: '#f0f2f5',
}

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
        if (tsDiff !***REMOVED*** 0) return tsDiff;
        return Number(a?.id || 0) - Number(b?.id || 0);
    });
}

function getLatestIncomingMessage(messages = []) {
    const latest = messages[messages.length - 1];
    return latest?.role ***REMOVED***= 'user' ? latest : null;
}

function getConversationStatusMeta(creator) {
    const full = creator?._full || creator || {};
    const wacrm = full.wacrm || {};
    const joinbrands = full.joinbrands || {};
    const urgencyLevel = Number(wacrm.urgency_level || 0);
    const isUrgent = wacrm.priority ***REMOVED***= 'urgent' || urgencyLevel >= 8 || !!joinbrands.ev_churned;
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

export function WAMessageComposer({ client, creator, onClose, onSwipeLeft, onMessageSent, onCreatorUpdated, asPanel }) {
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
        if (typeof window ***REMOVED***= 'undefined') return false;
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
        if (touchStartX.current ***REMOVED***= null) return;
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

    const chatScrollRef = useRef(null);
    const inputRef = useRef(null);
    const mediaInputRef = useRef(null);
    const olderLoadCooldownRef = useRef(false);
    const prependInFlightRef = useRef(false);

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
        clearPendingImage();
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
            if (cancelled || currentRace !***REMOVED*** generationRaceRef.current) return;
            setPolicyDocs(docs);
            setClientMemory(mem || []);
            setAgencyStrategies(strategyConfig);
            setActiveEvents((evtData.events || []).filter(e => e.status ***REMOVED***= 'active'));

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
                if (cancelled || currentRace !***REMOVED*** generationRaceRef.current || msgs.length ***REMOVED***= 0) return;
                const lastMsg = getLatestIncomingMessage(msgs);
                if (!lastMsg) return;
                const result = await generateForIncoming(lastMsg);
                if (result && currentRace ***REMOVED***= generationRaceRef.current) {
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
                retrievalSnapshotId: result.retrievalSnapshotId || null,
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
        if (messages.length ***REMOVED***= 0) return;
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

            const timelineText = caption ? `🖼️ [Image] ${caption}` : '🖼️ [Image]';
            const sentAt = Date.now();
            await persistCrmSentMessage(timelineText, sentAt);
            setMessages((prev) => [...prev, { role: 'me', text: timelineText, timestamp: sentAt }]);
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

        const incomingMsgs = freshMsgs.filter(m => m.role ***REMOVED***= 'user');
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
                retrievalSnapshotId: result.retrievalSnapshotId || null,
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
        if (last20.length ***REMOVED***= 0) return;
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
            const incomingMsgs = messages.filter(m => m.role ***REMOVED***= 'user');
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
                retrievalSnapshotId: result.retrievalSnapshotId || null,
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

        const toolKey = mode ***REMOVED***= 'translate' ? 'translate' : 'emoji';
        setPickerError(null);
        setCustomToolLoading(prev => ({ ...prev, [toolKey]: true }));
        try {
            const systemPrompt = mode ***REMOVED***= 'translate'
                ? [
                    '你是 WhatsApp 客服翻译助手。',
                    '任务：翻译输入文本，保持原意和礼貌语气。',
                    '规则：',
                    '1) 如果输入主要是中文，翻译成自然、简洁的英文。',
                    '2) 如果输入主要是英文，翻译成自然、简洁的中文。',
                    '3) 不新增承诺、价格、时限等业务事实。',
                    '4) 只输出翻译结果，不要解释。',
                ].join('\n')
                : [
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
            setPickerError(`自定义${mode ***REMOVED***= 'translate' ? '翻译' : 'Emoji润色'}失败：${e.message || '未知错误'}`);
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
            if (msgs.length ***REMOVED***= 0) {
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
                throw new Error(data?.error || `HTTP ${res.status}`);
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
            const data = await res.json();
            if (!data.ok) {
                reportError(data.error || '未知错误');
                return false;
            }
        } catch (e) {
            console.error('[WA Send] 发送失败:', e);
            reportError(e.message || '请求失败');
            return false;
        }

        const sentAt = Date.now();
        await persistCrmSentMessage(sentText, sentAt);
        setMessages(prev => [...prev, { role: 'me', text: sentText, timestamp: sentAt }]);
        setMessageTotal((prev) => prev + 1);
        onMessageSent?.(client.id);
        return true;
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
                    },
                    messages,
                    system_prompt_used: promptUsed,
                    system_prompt_version: promptVersion,
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

        const sentText = selectedOpt ***REMOVED***= 'opt1'
            ? activePicker.candidates.opt1
            : selectedOpt ***REMOVED***= 'opt2'
                ? activePicker.candidates.opt2
                : pickerCustom.trim();

        if (!sentText) return;

        setPickerError(null);

        const sendOk = await sendOutboundMessage(sentText, {
            onError: (message) => setPickerError(message),
        });
        if (!sendOk) return;

        const sim1 = computeSimilarity(activePicker.candidates.opt1, sentText);
        const sim2 = computeSimilarity(activePicker.candidates.opt2, sentText);
        const bestSim = Math.max(sim1, sim2);
        const bestOpt = sim1 >= sim2 ? 'opt1' : 'opt2';
        const resolvedHumanSelected = selectedOpt ***REMOVED***= 'custom' ? 'custom' : selectedOpt;
        const isCustomSelection = selectedOpt ***REMOVED***= 'custom' || bestSim < 85;

        const diffAnalysis = {
            model_predicted: bestSim >= 85 ? activePicker.candidates[bestOpt] : null,
            model_rejected: bestSim >= 85 ? activePicker.candidates[bestOpt ***REMOVED***= 'opt1' ? 'opt2' : 'opt1'] : null,
            is_custom: isCustomSelection,
            human_reason: isCustomSelection
                ? `人工编辑发送（与AI候选最高相似度${bestSim}%）`
                : `直接采用方案${selectedOpt ***REMOVED***= 'opt1' ? 'A' : 'B'}（相似度${bestSim}%）`,
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
                retrievalSnapshotId: result.retrievalSnapshotId || null,
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

        const sendOk = await sendOutboundMessage(sentText);
        if (!sendOk) return;

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
        if (date !***REMOVED*** lastDate) {
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
        if (typeof window ***REMOVED***= 'undefined' || !window.visualViewport) return;
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
        if (typeof window ***REMOVED***= 'undefined') return undefined;
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
                <div className="hidden md:flex items-center gap-4 px-5 py-4" style={{ background: WA.darkHeader }}>
                    <button onClick={onClose} className="text-white/70 hover:text-white text-xl shrink-0">←</button>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0" style={{ background: WA.teal }}>
                        {(client.name || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base text-white">{client.name || client.phone}</div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-white/50">
                                {client.conversion_stage || '未知阶段'} · {messageTotal} 条消息
                            </span>
                            {/* 自动检测话题 — 右侧联系人信息区，显示在二级信息行 */}
                            {autoDetectedTopic && !currentTopic && (
                                <span
                                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        background: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                            ? 'rgba(16,185,129,0.2)'
                                            : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                ? 'rgba(245,158,11,0.2)'
                                                : 'rgba(255,255,255,0.08)',
                                        color: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                            ? '#6ee7b7'
                                            : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                ? '#fcd34d'
                                                : 'rgba(255,255,255,0.45)',
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
                                        background: 'rgba(59,130,246,0.25)',
                                        color: '#93c5fd',
                                    }}
                                    title={`手动标记 · ${currentTopic.detected_at ? new Date(currentTopic.detected_at).toLocaleString('zh-CN') : ''}`}
                                >
                                    📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
                                </span>
                            )}
                        </div>
                    </div>
                    {pendingCandidates.length > 0 && (
                        <span className="text-xs px-3 py-1 rounded-full font-bold shrink-0" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
                            📋 {pendingCandidates.length} 条待处理
                        </span>
                    )}
                    <button
                        onClick={handleIncrementalSync}
                        disabled={syncingMessages}
                        className="text-xs px-3 py-1 rounded-full font-medium shrink-0 transition-all disabled:opacity-50"
                        style={{
                            background: syncingMessages ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.1)',
                            color: syncingMessages ? '#34d399' : 'rgba(255,255,255,0.72)',
                        }}
                        title="按手机号抓取最近原始聊天，只补齐最新消息，不做深度修复"
                    >
                        {syncingMessages ? '⏳ 增量中' : '🔄 增量更新'}
                    </button>
                    <button
                        onClick={handleRepairMessages}
                        disabled={repairingMessages}
                        className="text-xs px-3 py-1 rounded-full font-medium shrink-0 transition-all disabled:opacity-50"
                        style={{
                            background: repairingMessages ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.1)',
                            color: repairingMessages ? '#f59e0b' : 'rgba(255,255,255,0.72)',
                        }}
                        title="按手机号在对应 session 里重新爬取该达人的原始聊天，并修复 role / 缺失 / 重复记录"
                    >
                        {repairingMessages ? '⏳ 修复中' : '🩺 修复消息'}
                    </button>
                    <button
                        onClick={handleTranslate}
                        disabled={translating}
                        className="text-xs px-3 py-1 rounded-full font-medium shrink-0 transition-all disabled:opacity-50"
                        style={{
                            background: Object.keys(translationMap).length > 0 ? 'rgba(0,168,132,0.2)' : 'rgba(255,255,255,0.1)',
                            color: Object.keys(translationMap).length > 0 ? WA.teal : 'rgba(255,255,255,0.55)',
                        }}
                        title={Object.keys(translationMap).length > 0 ? '关闭翻译' : '翻译最近20条消息'}
                    >
                        {translating ? '⏳' : '🌐'} 翻译
                    </button>
                </div>

                {/* Mobile Header with Tags toggle — only shown when NOT used as panel in App.jsx */}
                {!asPanel && (
                    <>
                        <div className="flex md:hidden items-center gap-3 px-4 py-3" style={{ background: WA.darkHeader }}>
                            <button onClick={onClose} className="text-white/70 hover:text-white text-xl shrink-0">←</button>
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: WA.teal }}>
                                {(client.name || '?')[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{client.name || client.phone}</div>
                                {/* 自动检测话题（移动端） */}
                                {autoDetectedTopic && !currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span
                                            className="text-xs px-1.5 py-0.5 rounded-full"
                                            style={{
                                                background: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                                    ? 'rgba(16,185,129,0.2)'
                                                    : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                        ? 'rgba(245,158,11,0.2)'
                                                        : 'rgba(255,255,255,0.08)',
                                                color: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                                    ? '#6ee7b7'
                                                    : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                        ? '#fcd34d'
                                                        : 'rgba(255,255,255,0.45)',
                                            }}
                                        >
                                            🔍 {autoDetectedTopic.label}
                                        </span>
                                    </div>
                                )}
                                {/* 手动话题（移动端） */}
                                {currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.25)', color: '#93c5fd' }}>
                                            📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleIncrementalSync}
                                disabled={syncingMessages}
                                className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg disabled:opacity-50"
                                title="按手机号抓取最近原始聊天，只补齐最新消息"
                            >
                                {syncingMessages ? '⏳' : '🔄'}
                            </button>
                            <button
                                onClick={handleRepairMessages}
                                disabled={repairingMessages}
                                className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg disabled:opacity-50"
                                title="重新爬取并修复当前联系人消息"
                            >
                                {repairingMessages ? '⏳' : '🩺'}
                            </button>
                            <button
                                onClick={() => setTagsVisible(v => !v)}
                                className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg"
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

                {/* Translation Progress Bar */}
                {translating && translateProgress && typeof translateProgress ***REMOVED***= 'string' && (
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
                        <span>🩺 已按手机号重爬修复</span>
                        <span>检查 {lastRepairSummary.checked} 条</span>
                        <span>补齐 {lastRepairSummary.inserted}</span>
                        <span>修正 role {lastRepairSummary.updated}</span>
                        <span>删除重复 {lastRepairSummary.deleted}</span>
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
                    style={{ background: WA.chatBg }}
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
                        if (item.type ***REMOVED***= 'date') {
                            return (
                                <div key={item.id} className="flex justify-center my-4">
                                    <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                                        {item.date}
                                    </div>
                                </div>
                            );
                        }

                        const isMe = item.role ***REMOVED***= 'me';
                        return (
                            <div key={item.uiKey} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                                    style={{
                                        background: isMe ? WA.bubbleOut : WA.bubbleIn,
                                        color: WA.textDark,
                                        borderRadius: isMe ? '16px 16px 6px 16px' : '16px 16px 16px 6px',
                                        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                                    }}
                                >
                                    <div className="whitespace-pre-wrap">{item.text}</div>
                                    {translationMap[item.translationKey] && (
                                        <div className="text-xs mt-1.5 pt-1.5 border-t" style={{ color: '#00a884', borderColor: 'rgba(0,0,0,0.08)' }}>
                                            🌐 {translationMap[item.translationKey]}
                                        </div>
                                    )}
                                    <div className="text-xs mt-1.5 flex justify-end" style={{ color: isMe ? '#667781' : WA.textMuted }}>
                                        {formatTime(item.normalizedTimestamp)}
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
                    />
                )}

                {/* Input area */}
                <div className="px-4 md:px-5 py-3 md:py-4 flex items-end gap-2 md:gap-3" style={{ background: WA.darkHeader, position: 'relative', paddingBottom: viewportOffset ? `${viewportOffset + 8}px` : undefined }}>
                    {pendingImage && (
                        <div
                            className="rounded-xl px-3 py-2 flex items-center gap-3"
                            style={{
                                position: 'absolute',
                                left: '12px',
                                right: '12px',
                                bottom: 'calc(100% + 8px)',
                                background: 'rgba(17,27,33,0.94)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                zIndex: 25,
                            }}
                        >
                            <img
                                src={pendingImage.previewUrl}
                                alt={pendingImage.fileName}
                                className="w-11 h-11 rounded-lg object-cover border border-white/20 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs text-white truncate">{pendingImage.fileName}</div>
                                <div className="text-[11px] text-white/55">{formatBytes(pendingImage.size)} · 可选输入 caption 后发送</div>
                            </div>
                            <button
                                onClick={clearPendingImage}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 hover:text-white"
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
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center text-lg md:text-xl shrink-0 transition-all"
                        style={{ color: emojiPickerOpen ? WA.teal : 'rgba(255,255,255,0.55)' }}
                    >
                        😊
                    </button>
                    <button
                        onClick={handlePickImage}
                        disabled={sendingMedia}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center text-lg md:text-xl shrink-0 transition-all disabled:opacity-50"
                        style={{ color: pendingImage ? '#60a5fa' : 'rgba(255,255,255,0.55)' }}
                        title="上传图片"
                    >
                        {sendingMedia ? '⏳' : '🖼️'}
                    </button>

                    {/* 📌 手动开启新话题按钮 + 下拉菜单 */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setTopicDropdownOpen(v => !v)}
                            className="h-9 md:h-11 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium shrink-0 transition-all"
                            style={{
                                background: topicDropdownOpen
                                    ? 'rgba(59,130,246,0.4)'
                                    : currentTopic
                                        ? 'rgba(59,130,246,0.25)'
                                        : 'rgba(255,255,255,0.08)',
                                color: topicDropdownOpen || currentTopic ? '#93c5fd' : 'rgba(255,255,255,0.5)',
                                border: '1px solid rgba(255,255,255,0.15)',
                            }}
                            title="选择话题类型，开启新话题上下文"
                        >
                            📌
                            <span className="hidden sm:inline">新话题</span>
                            <span className="text-xs opacity-60">▼</span>
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
                                    background: '#1e293b',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    zIndex: 1001,
                                }}
                            >
                                <div className="px-3 py-1.5 text-xs font-semibold text-white/40 border-b border-white/10 mb-1">
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
                                            color: currentTopic?.topic_key ***REMOVED***= key ? '#93c5fd' : 'rgba(255,255,255,0.75)',
                                            background: currentTopic?.topic_key ***REMOVED***= key ? 'rgba(59,130,246,0.2)' : 'transparent',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                                        onMouseLeave={e => e.currentTarget.style.background = currentTopic?.topic_key ***REMOVED***= key ? 'rgba(59,130,246,0.2)' : 'transparent'}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: currentTopic?.topic_key ***REMOVED***= key ? '#60a5fa' : 'rgba(255,255,255,0.3)' }} />
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

                    <div className="flex-1 flex items-center rounded-3xl px-4 md:px-5 py-3 md:py-3.5" style={{ background: WA.darkBg }}>
                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder="输入消息，或直接点击右下角 🤖 为最新消息生成回复..."
                            rows={2}
                            className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none resize-none"
                            style={{ maxHeight: '240px' }}
                            onKeyDown={e => {
                                if (e.key ***REMOVED***= 'Enter' && !e.shiftKey) {
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
                                    {generating ? <span className="text-white text-sm">⏳</span> : <span className="text-white text-xl">🤖</span>}
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
                                <span className="text-white text-xl">{sendingMedia ? '⏳' : '➤'}</span>
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
                                        ? 'rgba(255,255,255,0.1)'
                                        : 'rgba(255,255,255,0.1)',
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
                                <span className="text-white text-sm animate-spin">⏳</span>
                            ) : activePicker ? (
                                <span className="text-white text-lg">🔄</span>
                            ) : (
                                <span className="text-white/70 text-lg">🤖</span>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}

// ***REMOVED******REMOVED******REMOVED*** EventPill（悬浮事件标签）***REMOVED******REMOVED******REMOVED***
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
