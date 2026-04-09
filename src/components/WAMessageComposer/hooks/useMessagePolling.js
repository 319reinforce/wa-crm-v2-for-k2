/**
 * useMessagePolling.js — 消息轮询 Hook
 * 管理 checkNewMessages（5秒轮询）和 check48h（5分钟定时检测）
 */
import { useEffect, useRef, useCallback } from 'react';

const API_BASE = '/api';

export function useMessagePolling({
    client,
    messages,
    setMessages,
    generateForIncoming,
    pushPicker,
    lastActivityRef,
    pendingCandidatesRef,
}) {
    const pollingRef = useRef(null);

    const checkNewMessages = useCallback(async () => {
        if (!client?.id) return;
        try {
            const res = await fetch(`${API_BASE}/creators/${client.id}/messages`);
            if (!res.ok) return;
            const data = await res.json();
            const freshMsgs = Array.isArray(data) ? data : (data.messages || []);
            if (freshMsgs.length ***REMOVED***= 0) return;

            setMessages(prev => {
                if (prev.length ***REMOVED***= 0) return freshMsgs;
                // 增量追加
                const existingIds = new Set(prev.map(m => m.id));
                const newOnes = freshMsgs.filter(m => !existingIds.has(m.id));
                if (newOnes.length ***REMOVED***= 0) return prev;
                return [...prev, ...newOnes];
            });

            // 追踪最后一条消息时间
            if (freshMsgs.length > 0) {
                const latest = freshMsgs[freshMsgs.length - 1];
                if (latest.timestamp) {
                    lastActivityRef.current = latest.timestamp;
                }
            }

            // 检测新的达人消息，触发 AI 生成
            const incomingNew = freshMsgs.filter(m => m.role ***REMOVED***= 'user');
            const pendingRef = pendingCandidatesRef?.current || [];
            for (const msg of incomingNew) {
                if (pendingRef.some(p => p.incomingMsg?.id ***REMOVED***= msg.id)) continue;
                pendingCandidatesRef.current = [...pendingRef, { incomingMsg: msg, ts: Date.now() }];
                const result = await generateForIncoming(msg);
                if (result) pushPicker(result);
            }
        } catch (e) {
            console.error('[checkNewMessages] error:', e);
        }
    }, [client?.id, setMessages, generateForIncoming, pushPicker, lastActivityRef, pendingCandidatesRef]);

    // 5秒轮询
    useEffect(() => {
        if (!client?.id) return;
        pollingRef.current = setInterval(checkNewMessages, 5000);
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [client?.id, checkNewMessages]);

    // 48小时无互动检测
    const check48h = useCallback(() => {
        if (!client?.id || !lastActivityRef.current) return;
        if (Date.now() - lastActivityRef.current > 48 * 3600 * 1000) {
            // 需要开启新话题（trigger: 'time'）
            return { shouldSwitch: true, trigger: 'time' };
        }
        return { shouldSwitch: false };
    }, [client?.id, lastActivityRef]);

    return { checkNewMessages, check48h, pollingRef };
}
