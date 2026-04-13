/**
 * useMessagePolling.js — 消息轮询 Hook
 * 管理 checkNewMessages（5秒轮询）和 check48h（5分钟定时检测）
 */
import { useEffect, useRef, useCallback } from 'react';
import { fetchJsonOrThrow } from '../../../utils/api';

const API_BASE = '/api';

function toTimestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function getMessageKey(message) {
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
    generateForIncoming,
    pushPicker,
    lastActivityRef,
    pendingCandidatesRef,
    activePickerRef,
    onTopicTimeout,
}) {
    const pollingRef = useRef(null);
    const requestVersionRef = useRef(0);
    const activeClientIdRef = useRef(client?.id || null);

    useEffect(() => {
        activeClientIdRef.current = client?.id || null;
        requestVersionRef.current += 1;
    }, [client?.id]);

    const checkNewMessages = useCallback(async () => {
        if (!client?.id) return;

        const requestVersion = ++requestVersionRef.current;
        const clientId = client.id;
        try {
            const data = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
                signal: AbortSignal.timeout(15000),
            });
            if (activeClientIdRef.current !***REMOVED*** clientId || requestVersionRef.current !***REMOVED*** requestVersion) return;
            const freshMsgs = Array.isArray(data) ? data : (data.messages || []);
            const total = Array.isArray(data) ? freshMsgs.length : Number(data?.total ?? freshMsgs.length);
            if (freshMsgs.length ***REMOVED***= 0) return;

            setMessages(freshMsgs);
            setMessageTotal?.(Number.isFinite(total) ? total : freshMsgs.length);

            // 追踪最后一条消息时间
            const latest = freshMsgs[freshMsgs.length - 1];
            const latestTs = toTimestampMs(latest?.timestamp);
            if (latestTs > 0) {
                lastActivityRef.current = latestTs;
            }

            // 仅当最后一条消息来自达人时才自动生成，避免对运营刚发出的消息重复触发
            if (!latest || latest.role !***REMOVED*** 'user') return;

            const latestKey = getMessageKey(latest);
            const activeKey = getMessageKey(activePickerRef?.current?.incomingMsg);
            const pendingRef = pendingCandidatesRef?.current || [];
            const alreadyQueued = activeKey ***REMOVED***= latestKey
                || pendingRef.some((item) => getMessageKey(item?.incomingMsg) ***REMOVED***= latestKey);
            if (alreadyQueued) return;

            const result = await generateForIncoming(latest);
            if (activeClientIdRef.current !***REMOVED*** clientId || requestVersionRef.current !***REMOVED*** requestVersion) return;
            if (result) pushPicker(result);
        } catch (e) {
            if (e?.name ***REMOVED***= 'AbortError') return;
            console.error('[checkNewMessages] error:', e);
        }
    }, [client?.id, setMessages, generateForIncoming, pushPicker, lastActivityRef, pendingCandidatesRef, activePickerRef]);

    // 5秒轮询
    useEffect(() => {
        if (!client?.id) return;
        pollingRef.current = setInterval(checkNewMessages, 5000);
        return () => {
            requestVersionRef.current += 1;
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [client?.id, checkNewMessages]);

    // 48小时无互动检测
    const check48h = useCallback(() => {
        if (!client?.id || !lastActivityRef.current) return;
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

    return { checkNewMessages, check48h, pollingRef };
}
