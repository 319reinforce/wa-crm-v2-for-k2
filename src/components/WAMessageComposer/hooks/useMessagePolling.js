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
    lastActivityRef,
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
            if (activeClientIdRef.current !== clientId || requestVersionRef.current !== requestVersion) return;
            const freshMsgs = Array.isArray(data) ? data : (data.messages || []);
            const total = Array.isArray(data) ? freshMsgs.length : Number(data?.total ?? freshMsgs.length);
            if (freshMsgs.length === 0) return;

            setMessages(freshMsgs);
            setMessageTotal?.(Number.isFinite(total) ? total : freshMsgs.length);

            // 追踪最后一条消息时间
            const latest = freshMsgs[freshMsgs.length - 1];
            const latestTs = toTimestampMs(latest?.timestamp);
            if (latestTs > 0) {
                lastActivityRef.current = latestTs;
            }

            // 仅追踪最后一条达人消息；AI 生成改为手动触发
            if (!latest || latest.role !== 'user') return;
        } catch (e) {
            if (e?.name === 'AbortError') return;
            console.error('[checkNewMessages] error:', e);
        }
    }, [client?.id, setMessages, lastActivityRef]);

    // 5秒轮询 + Step 7 SSE 推送即时触发
    useEffect(() => {
        if (!client?.id) return;
        pollingRef.current = setInterval(checkNewMessages, 5000);

        // 监听 App.jsx 分发的 wa-message 事件(Registry → SSE → window)
        // 如果消息涉及当前打开的 client(phone 匹配),立即 checkNewMessages
        const handleWaMessage = (event) => {
            try {
                const data = event?.detail;
                if (!data) return;
                const clientPhone = String(client?.wa_phone || '').replace(/\D/g, '');
                if (!clientPhone) return;
                const fromDigits = String(data.from_phone || '').replace(/\D/g, '');
                const toDigits = String(data.to_phone || '').replace(/\D/g, '');
                if (fromDigits === clientPhone || toDigits === clientPhone) {
                    checkNewMessages();
                }
            } catch (_) {}
        };
        window.addEventListener('wa-message-received', handleWaMessage);

        return () => {
            requestVersionRef.current += 1;
            if (pollingRef.current) clearInterval(pollingRef.current);
            window.removeEventListener('wa-message-received', handleWaMessage);
        };
    }, [client?.id, client?.wa_phone, checkNewMessages]);

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
