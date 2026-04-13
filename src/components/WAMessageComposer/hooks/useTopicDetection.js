/**
 * useTopicDetection.js — 话题状态管理 Hook
 * 管理 currentTopic 和 autoDetectedTopic 状态
 */
import { useEffect, useCallback } from 'react';
import { inferAutoTopic, shouldSwitchTopic, startNewTopic } from '../ai/topicDetector';

export function useTopicDetection({
    messages,
    activeEvents,
    currentTopic,
    setCurrentTopic,
    autoDetectedTopic,
    setAutoDetectedTopic,
}) {
    // 每次 messages 变化 → 自动检测话题（仅用于 UI 显示）
    useEffect(() => {
        if (!messages || messages.length === 0) return;
        const result = inferAutoTopic({ messages, activeEvents });
        setAutoDetectedTopic(result);
    }, [messages, activeEvents, setAutoDetectedTopic]);

    // 判断是否需要切换话题（供外部调用）
    const checkTopicSwitch = useCallback(({ lastMsgTimestamp, newText }) => {
        return shouldSwitchTopic({
            currentTopic,
            newText,
            messages,
            lastMsgTimestamp,
        });
    }, [currentTopic, messages]);

    // 开启新话题
    const switchToNewTopic = useCallback(({ trigger, newText }) => {
        const newTopic = startNewTopic({ trigger, newText, messages });
        setCurrentTopic(newTopic);
        return newTopic;
    }, [messages, setCurrentTopic]);

    return {
        checkTopicSwitch,
        switchToNewTopic,
    };
}
