/**
 * useAICandidate.js — AI 候选生成 Hook
 * 管理 generateForIncoming 和 pushPicker
 */
import { useCallback, useRef } from 'react';
import { buildConversation } from '../ai/extractors';
import { generateViaExperienceRouter } from '../ai/experienceRouter';
import { fetchJsonOrThrow } from '../../../utils/api';

const API_BASE = '/api';

export function useAICandidate({
    client,
    creator,
    policyDocs,
    clientMemory,
    agencyStrategies,
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
            const msgsData = await fetchJsonOrThrow(`${API_BASE}/creators/${client.id}/messages`, {
                signal: AbortSignal.timeout(15000),
            });
            const msgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);
            const conversation = buildConversation(msgs);
            conversation.messages.push({ role: 'user', text: incomingMsg.text });

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
                generated_at: Date.now(),
                policyDocs,
            };
        } catch (e) {
            console.error('[generateForIncoming] error:', e);
            return null;
        } finally {
            setPickerLoading(false);
        }
    }, [client, creator, policyDocs, clientMemory, agencyStrategies, setPickerLoading, currentTopic, autoDetectedTopic, setCurrentTopic]);

    return { generateForIncoming, pushPicker };
}
