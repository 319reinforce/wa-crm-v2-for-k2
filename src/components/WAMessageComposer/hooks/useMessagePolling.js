/**
 * useMessagePolling.js — 消息同步 Hook
 *
 * 数据同步策略：
 *   1. 主路径：SSE 推送（window event `wa-message-received`）→ 增量拉
 *   2. 兜底 1：60s 低频 poll（SSE 断连时 15s），几乎永远返回空
 *   3. 兜底 2：visibilitychange 从隐藏恢复 → 补一次增量拉
 *   4. 每 10 次兜底做一次 total 对齐（防漏）
 *
 * 历史：之前是 5s setInterval 全量拉消息；SSE 加入后变成冗余 CPU/网络开销。
 * 参考：server/services/directMessagePersistenceService.js:209 和
 *      server/services/sessionRegistry.js:334 都在消息持久化后广播 wa-message SSE。
 */
import { useEffect, useRef, useCallback } from 'react';
import { fetchJsonOrThrow } from '../../../utils/api';

const API_BASE = '/api';
const FALLBACK_POLL_MS = 60_000;
const FALLBACK_POLL_DEGRADED_MS = 15_000;
const FALLBACK_ALIGN_EVERY = 10;

function toTimestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

export function getMessageKey(message) {
    if (!message) return '';
    return String(
        message.message_key
        ?? message.id
        ?? message.message_hash
        ?? message.timestamp
        ?? `${message.role || ''}:${message.text || ''}`
    );
}

export function useMessagePolling({
    client,
    setMessages,
    setMessageTotal,
    lastActivityRef,
    onTopicTimeout,
    sseHealthyRef, // optional ref<boolean>: 指示 SSE 是否健康,影响兜底频率
}) {
    const fallbackTimerRef = useRef(null);
    const fallbackTickCountRef = useRef(0);
    const requestVersionRef = useRef(0);
    const activeClientIdRef = useRef(client?.id || null);

    useEffect(() => {
        activeClientIdRef.current = client?.id || null;
        requestVersionRef.current += 1;
        fallbackTickCountRef.current = 0;
    }, [client?.id]);

    /**
     * 拉消息。mode:
     *   'incremental' - 带 after_timestamp,只取新增
     *   'align'       - 全量,校正 total(兜底专用,约 10 分钟一次)
     */
    const checkNewMessages = useCallback(async (mode = 'incremental') => {
        if (!client?.id) return;

        const requestVersion = ++requestVersionRef.current;
        const clientId = client.id;
        const afterTs = mode === 'incremental' ? Number(lastActivityRef?.current || 0) : 0;
        const qs = new URLSearchParams();
        if (afterTs > 0) {
            qs.set('after_timestamp', String(afterTs));
            qs.set('limit', '50');
        }
        const url = qs.toString()
            ? `${API_BASE}/creators/${clientId}/messages?${qs.toString()}`
            : `${API_BASE}/creators/${clientId}/messages`;

        try {
            const data = await fetchJsonOrThrow(url, {
                signal: AbortSignal.timeout(15000),
            });
            if (activeClientIdRef.current !== clientId || requestVersionRef.current !== requestVersion) return;
            const freshMsgs = Array.isArray(data) ? data : (data?.messages || []);
            const total = Array.isArray(data)
                ? freshMsgs.length
                : Number(data?.total ?? freshMsgs.length);

            if (freshMsgs.length > 0) {
                setMessages(freshMsgs);
                if (Number.isFinite(total)) setMessageTotal?.(total);
                const latest = freshMsgs[freshMsgs.length - 1];
                const latestTs = toTimestampMs(latest?.timestamp);
                if (latestTs > 0 && lastActivityRef) lastActivityRef.current = latestTs;
                // AI 生成改为手动触发（四槽位方案 op3/op4 由 🤖 按钮驱动）：polling 只同步消息
            } else if (mode === 'align' && Number.isFinite(total)) {
                setMessageTotal?.(total);
            }
        } catch (e) {
            if (e?.name === 'AbortError') return;
            console.error('[checkNewMessages] error:', e);
        }
    }, [client?.id, setMessages, setMessageTotal, lastActivityRef]);

    // SSE 推送 + visibilitychange 补拉 + 低频兜底 poll
    useEffect(() => {
        if (!client?.id) return;

        const handleWaMessage = (event) => {
            try {
                const data = event?.detail;
                if (!data) return;
                const clientPhone = String(client?.wa_phone || client?.phone || '').replace(/\D/g, '');
                if (!clientPhone) return;
                const fromDigits = String(data.from_phone || '').replace(/\D/g, '');
                const toDigits = String(data.to_phone || '').replace(/\D/g, '');
                if (fromDigits === clientPhone || toDigits === clientPhone) {
                    checkNewMessages('incremental');
                }
            } catch (_) {}
        };
        window.addEventListener('wa-message-received', handleWaMessage);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                checkNewMessages('incremental');
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        const scheduleFallback = () => {
            const healthy = sseHealthyRef?.current !== false;
            const delay = healthy ? FALLBACK_POLL_MS : FALLBACK_POLL_DEGRADED_MS;
            fallbackTimerRef.current = setTimeout(async () => {
                fallbackTickCountRef.current += 1;
                const shouldAlign = fallbackTickCountRef.current % FALLBACK_ALIGN_EVERY === 0;
                await checkNewMessages(shouldAlign ? 'align' : 'incremental');
                scheduleFallback();
            }, delay);
        };
        scheduleFallback();

        return () => {
            requestVersionRef.current += 1;
            window.removeEventListener('wa-message-received', handleWaMessage);
            document.removeEventListener('visibilitychange', handleVisibility);
            if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        };
    }, [client?.id, client?.wa_phone, client?.phone, checkNewMessages, sseHealthyRef]);

    // 48 小时无互动检测(业务逻辑,保留)
    const check48h = useCallback(() => {
        if (!client?.id || !lastActivityRef?.current) return;
        if (Date.now() - lastActivityRef.current > 48 * 3600 * 1000) {
            onTopicTimeout?.();
            lastActivityRef.current = Date.now();
            return { shouldSwitch: true, trigger: 'time' };
        }
        return { shouldSwitch: false };
    }, [client?.id, lastActivityRef, onTopicTimeout]);

    useEffect(() => {
        if (!client?.id) return;
        const timer = setInterval(check48h, 5 * 60 * 1000);
        return () => clearInterval(timer);
    }, [client?.id, check48h]);

    return { checkNewMessages, check48h };
}
