/**
 * StandardReplyCard — 标准话术卡片
 * 从规则文档检索标准话术，不经过 AI 生成
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import WA from '../utils/waTheme';
import LoadingSkeleton from './LoadingSkeleton';
import EmptyState from './EmptyState';
import { fetchJsonOrThrow } from '../utils/api';

const API_BASE = '/api';

export default function StandardReplyCard({
    scene,
    operator,
    userMessage,
    clientId,
    messages = [],
    currentTopic = null,
    autoDetectedTopic = null,
    activeEvents = [],
    lifecycle = null,
    refreshToken = null,
    onEdit,
    onSend,
    compactMobile = false,
    autoFetch = true
}) {
    const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'empty' | 'error'
    const [template, setTemplate] = useState(null);
    const [error, setError] = useState(null);
    const requestVersionRef = useRef(0);

    const recentMessages = useMemo(() => {
        return (Array.isArray(messages) ? messages : [])
            .slice(-8)
            .map((message) => ({
                role: message?.role === 'me' ? 'assistant' : 'user',
                text: String(message?.text || '').trim(),
                timestamp: message?.timestamp || null,
            }))
            .filter((message) => message.text);
    }, [messages]);

    const activeEventSummary = useMemo(() => {
        return (Array.isArray(activeEvents) ? activeEvents : [])
            .filter((event) => event?.status === 'active')
            .map((event) => ({
                event_key: event?.event_key || null,
                status: event?.status || null,
                label: event?.label || event?.event_label || null,
            }))
            .filter((event) => event.event_key);
    }, [activeEvents]);

    const lifecycleSummary = useMemo(() => ({
        stage_key: lifecycle?.stage_key || null,
        stage_label: lifecycle?.stage_label || null,
    }), [lifecycle]);

    const requestSignature = useMemo(() => JSON.stringify({
        scene,
        operator,
        userMessage,
        refreshToken,
        currentTopicKey: currentTopic?.topic_key || null,
        autoTopicKey: autoDetectedTopic?.topic_key || null,
        autoTopicConfidence: autoDetectedTopic?.confidence || null,
        lifecycleStageKey: lifecycleSummary.stage_key,
        recentMessages: recentMessages.map((message) => [message.role, message.text, message.timestamp]),
        activeEvents: activeEventSummary.map((event) => [event.event_key, event.status]),
    }), [
        scene,
        operator,
        userMessage,
        refreshToken,
        currentTopic?.topic_key,
        autoDetectedTopic?.topic_key,
        autoDetectedTopic?.confidence,
        lifecycleSummary.stage_key,
        recentMessages,
        activeEventSummary,
    ]);

    useEffect(() => {
        const hasRetrievalContext = !!(scene && operator && (userMessage || recentMessages.length > 0));
        if (autoFetch && hasRetrievalContext) {
            fetchTemplate();
        }
    }, [requestSignature, autoFetch]);

    const fetchTemplate = async () => {
        const requestVersion = ++requestVersionRef.current;
        setStatus('loading');
        setTemplate(null);
        setError(null);

        try {
            const data = await fetchJsonOrThrow(`${API_BASE}/experience/retrieve-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    operator,
                    scene,
                    user_message: userMessage,
                    recent_messages: recentMessages,
                    current_topic: currentTopic,
                    auto_detected_topic: autoDetectedTopic,
                    active_events: activeEventSummary,
                    lifecycle: lifecycleSummary,
                    force_template_sources: true,
                }),
                signal: AbortSignal.timeout(5000)
            });

            if (requestVersion !== requestVersionRef.current) return;

            if (data.template && data.template.text) {
                setStatus('success');
                setTemplate(data.template);
            } else {
                setStatus('empty');
            }
        } catch (err) {
            if (requestVersion !== requestVersionRef.current) return;
            setStatus('error');
            setError(err.message || '检索失败');
        }
    };

    const cardStyle = {
        width: compactMobile ? '88%' : '72%',
        minWidth: compactMobile ? '280px' : '320px',
        maxWidth: compactMobile ? '360px' : '520px',
        background: '#fffbeb', // amber-50
        color: WA.textDark,
        border: '1px solid #fde68a', // amber-200
        boxShadow: '0 1px 1px rgba(217,119,6,0.10)',
    };

    return (
        <div
            className="shrink-0 snap-start rounded-[18px] px-3 py-3"
            style={cardStyle}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
                <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(245,158,11,0.16)', color: '#d97706' }}
                >
                    S
                </span>
                <span className="text-[11px] font-medium" style={{ color: WA.textMuted }}>
                    标准话术
                </span>
                {template?.source && (
                    <span className="text-[10px] ml-auto" style={{ color: WA.textMuted }}>
                        {formatSourceName(template.source)}
                    </span>
                )}
            </div>

            {/* Content */}
            <div
                className={`${compactMobile ? 'text-[13px]' : 'text-sm'} leading-relaxed overflow-y-auto`}
                style={{ maxHeight: compactMobile ? '138px' : '120px' }}
            >
                {status === 'loading' && <LoadingSkeleton compactMobile={compactMobile} />}

                {status === 'success' && template && (
                    <div className="whitespace-pre-wrap break-words">
                        {template.text}
                    </div>
                )}

                {status === 'empty' && (
                    <EmptyState
                        onRetry={fetchTemplate}
                        message="暂无匹配的标准话术"
                    />
                )}

                {status === 'error' && (
                    <EmptyState
                        onRetry={fetchTemplate}
                        message={`检索失败：${error}`}
                    />
                )}
            </div>

            {/* Actions */}
            {status === 'success' && template && (
                <div className="mt-3 flex gap-2">
                    {onEdit && (
                        <button
                            onClick={() => onEdit(template.text)}
                            className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold"
                            style={{
                                background: 'rgba(255,255,255,0.68)',
                                color: WA.textDark,
                                border: `1px solid ${WA.borderLight}`
                            }}
                        >
                            编辑
                        </button>
                    )}
                    <button
                        onClick={() => onSend(template.text)}
                        className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold text-white"
                        style={{ background: '#d97706' }} // amber-600
                    >
                        使用
                    </button>
                </div>
            )}
        </div>
    );
}

function formatSourceName(source) {
    if (!source) return '';

    // 从文件名提取友好名称
    // 例如: "playbook-yiyun-onboarding-and-payment-apr-2026-v1" -> "Yiyun 入职"
    if (source.includes('yiyun')) return 'Yiyun';
    if (source.includes('beau')) return 'Beau';
    if (source.includes('trial')) return '试用';
    if (source.includes('payment')) return '付款';
    if (source.includes('violation')) return '违规';
    if (source.includes('product')) return '产品';

    return source.split('-')[0] || source;
}
