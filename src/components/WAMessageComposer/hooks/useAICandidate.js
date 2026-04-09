/**
 * useAICandidate.js — AI 候选生成 Hook
 * 管理 generateForIncoming 和 pushPicker
 */
import { useCallback, useRef } from 'react';
import { buildConversation, buildRichContext } from '../ai/extractors';
import { generateViaExperienceRouter } from '../ai/experienceRouter';

const API_BASE = '/api';

export function useAICandidate({
    client,
    creator,
    policyDocs,
    clientMemory,
    setPickerLoading,
    setActivePicker,
    setPendingCandidates,
    pendingCandidatesRef,
    currentTopic,
    autoDetectedTopic,
    setCurrentTopic,
}) {
    const pushPicker = useCallback((result) => {
        if (!result) return;
        setActivePicker(prev => {
            if (prev) {
                setPendingCandidates(prevPending => {
                    const updated = [...prevPending, result];
                    pendingCandidatesRef.current = updated;
                    return updated;
                });
            }
            return result;
        });
    }, [setActivePicker, setPendingCandidates, pendingCandidatesRef]);

    const generateForIncoming = useCallback(async (incomingMsg) => {
        if (!incomingMsg || !client?.id) return null;
        setPickerLoading(true);
        try {
            // 重新 fetch 最新消息，避免闭包 stale 问题
            const msgsRes = await fetch(`${API_BASE}/creators/${client.id}/messages`);
            const msgsData = msgsRes.ok ? (await msgsRes.json()) : [];
            const msgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);
            const conversation = buildConversation(msgs);
            conversation.messages.push({ role: 'user', text: incomingMsg.text });

            const richCtx = buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages: msgs });

            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
                richCtx,
                client,
                creator,
                currentTopic,
                autoDetectedTopic,
                setCurrentTopic,
            });

            return {
                incomingMsg,
                candidates: result,
                generated_at: Date.now(),
                policyDocs,
            };
        } catch (e) {
            console.error('[generateForIncoming] error:', e);
            return null;
        } finally {
            setPickerLoading(false);
        }
    }, [client, creator, policyDocs, clientMemory, setPickerLoading, currentTopic, autoDetectedTopic, setCurrentTopic]);

    return { generateForIncoming, pushPicker };
}
