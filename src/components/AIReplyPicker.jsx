/**
 * AIReplyPicker — 统一四槽位回复面板
 * op1/op2 = 模板，op3/op4 = AI
 *
 * 自定义文本输入/翻译/Emoji/发送的入口一律回到主输入框(下方 textarea),
 * 本面板不再维护独立 Custom textarea,避免上下各一个输入框造成的重复。
 */
import React from 'react';
import WA from '../utils/waTheme';
import StandardReplyCard from './StandardReplyCard';

export default function AIReplyPicker({
    incomingMsg,
    templateDeck,
    aiDeck,
    operatorLabel,
    operatorConfigured,
    promptVersion,
    onSelect,
    onSkip,
    onEditCandidate,
    onSaveTemplate,
    onUpdateTemplate,
    onGenerateAi,
    onRegenerate,
    onRetryTemplates,
    templateLoading = false,
    templateError = null,
    loading = false,
    generating = false,
    sending = false,
    error = null,
    compactMobile = false,
    collapsed = false,
    onToggleCollapse,
    deckHeight = null,
    onResizeStart,
}) {
    const aiBusy = loading || generating;
    const sendBusy = !!sending;
    const templateSlots = templateDeck?.slots || {};
    const alternatives = Array.isArray(templateDeck?.alternatives) ? templateDeck.alternatives : [];
    const aiReady = !!(aiDeck?.opt1 || aiDeck?.opt2);

    const shellStyle = {
        background: WA.shellPanelStrong,
        borderTop: `1px solid ${WA.borderLight}`,
        boxShadow: '0 -12px 24px rgba(31,29,26,0.06)',
        height: deckHeight ? `${deckHeight}px` : undefined,
        display: 'flex',
        flexDirection: 'column',
        minHeight: deckHeight ? '220px' : undefined,
        maxHeight: deckHeight ? '72vh' : undefined,
    };

    const content = (
        <div className={`${compactMobile ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3'} space-y-3`} style={{ flex: deckHeight ? 1 : undefined, minHeight: 0, overflow: deckHeight ? 'auto' : undefined }}>
            <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold tracking-[0.06em] uppercase" style={{ color: WA.textMuted }}>
                    Reply Options
                </div>
                {incomingMsg?.text && !compactMobile && (
                    <div className="max-w-[42%] truncate text-[11px]" style={{ color: WA.textMuted }}>
                        来信: {incomingMsg.text}
                    </div>
                )}
            </div>

            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1">
                <StandardReplyCard
                    slotLabel="op1 推荐模板"
                    badge="1"
                    accent="#d97706"
                    slot={templateSlots.op1}
                    alternatives={[]}
                    loading={templateLoading}
                    error={templateError}
                    placeholder="暂无匹配模板"
                    onRetry={onRetryTemplates}
                    onEdit={(text, slot) => onEditCandidate(text, { kind: 'template', slotKey: 'op1', slot })}
                    onSaveTemplate={(slot) => onSaveTemplate?.({ slot, slotKey: 'op1' })}
                    onUpdateTemplate={(slot) => onUpdateTemplate?.({ slot, slotKey: 'op1' })}
                    onSend={(text, slot) => onSelect('template_op1', { text, slot })}
                    compactMobile={compactMobile}
                />
                <StandardReplyCard
                    slotLabel="op2 原始模板"
                    badge="2"
                    accent="#b45309"
                    slot={templateSlots.op2}
                    alternatives={alternatives}
                    loading={templateLoading}
                    error={templateError}
                    placeholder="暂无原始模板"
                    onRetry={onRetryTemplates}
                    onEdit={(text, slot) => onEditCandidate(text, { kind: 'template', slotKey: 'op2', slot })}
                    onSaveTemplate={(slot) => onSaveTemplate?.({ slot, slotKey: 'op2' })}
                    onUpdateTemplate={(slot) => onUpdateTemplate?.({ slot, slotKey: 'op2' })}
                    onSend={(text, slot) => onSelect('template_op2', { text, slot })}
                    compactMobile={compactMobile}
                />
                <CandidateCard
                    badge="3"
                    label="op3 AI 方案一"
                    text={aiDeck?.opt1 || '点击 AI 生成'}
                    accent="#2563eb"
                    loading={aiBusy}
                    sending={sendBusy}
                    error={error}
                    ready={!!aiDeck?.opt1}
                    onGenerate={onGenerateAi}
                    onEdit={() => onEditCandidate(aiDeck?.opt1, { kind: 'ai', slotKey: 'opt1' })}
                    onSend={() => onSelect('opt1')}
                    compactMobile={compactMobile}
                />
                <CandidateCard
                    badge="4"
                    label="op4 AI 方案二"
                    text={aiDeck?.opt2 || '点击 AI 生成'}
                    accent="#0f766e"
                    loading={aiBusy}
                    sending={sendBusy}
                    error={error}
                    ready={!!aiDeck?.opt2}
                    onGenerate={onGenerateAi}
                    onEdit={() => onEditCandidate(aiDeck?.opt2, { kind: 'ai', slotKey: 'opt2' })}
                    onSend={() => onSelect('opt2')}
                    compactMobile={compactMobile}
                />
            </div>

            <div
                className="text-[11px] leading-relaxed rounded-[12px] px-3 py-2"
                style={{ background: WA.shellPanelMuted, color: WA.textMuted }}
            >
                需要人工改写 / 翻译 / 加 Emoji 或从零输入文案? 直接在下方消息框操作即可。
                消息框旁的 🌐 翻译 和 😀 Emoji 润色按钮会作用在消息框里的文本。
            </div>
        </div>
    );

    return (
        <div style={shellStyle}>
            {!compactMobile && (
                <button
                    type="button"
                    onMouseDown={onResizeStart}
                    className="w-full h-4 flex items-center justify-center cursor-row-resize"
                    style={{ color: WA.textMuted, background: WA.shellPanelStrong, borderBottom: `1px solid ${WA.borderLight}` }}
                    title="拖动调整 Reply Deck 高度"
                >
                    <span className="block w-16 h-1 rounded-full" style={{ background: 'rgba(111,106,98,0.28)' }} />
                </button>
            )}
            <div
                className={`${compactMobile ? 'px-3 py-2.5' : 'px-4 py-3'} flex items-center justify-between gap-3 border-b`}
                style={{ borderColor: WA.borderLight }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: 'rgba(15,118,110,0.10)', color: WA.teal }}
                    >
                        <SparkIcon />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[12px] font-semibold tracking-[0.08em] uppercase truncate" style={{ color: WA.textDark }}>
                            Reply Deck
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {operatorLabel && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                                    {operatorLabel}
                                </span>
                            )}
                            {promptVersion && !compactMobile && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                                    {promptVersion}
                                </span>
                            )}
                            {operatorConfigured === false && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.10)', color: '#b45309' }}>
                                    基础路由
                                </span>
                            )}
                            {!aiReady && !loading && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
                                    AI 未生成
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <ToolButton
                        onClick={aiReady ? onRegenerate : onGenerateAi}
                        disabled={aiBusy || sendBusy}
                        icon={aiBusy ? <SpinnerIcon /> : aiReady ? <RefreshIcon /> : <SparkIcon />}
                        label={compactMobile ? '' : aiReady ? '重生成' : 'AI生成'}
                    />
                    <ToolButton
                        onClick={onSkip}
                        icon={<CloseIcon />}
                        label={compactMobile ? '' : '关闭'}
                    />
                    {compactMobile && (
                        <ToolButton
                            onClick={onToggleCollapse}
                            icon={collapsed ? <ExpandIcon /> : <CollapseIcon />}
                            label=""
                        />
                    )}
                </div>
            </div>

            {compactMobile && collapsed ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: WA.textMuted }}>
                    候选已收起，点击右上角展开。
                </div>
            ) : content}
        </div>
    );
}

function CandidateCard({ badge, label, text, accent, ready, loading, sending, error, onGenerate, onEdit, onSend, compactMobile }) {
    const waiting = !ready && !loading && !error;
    const showError = !ready && !!error && !loading;
    const canInteract = ready && !sending;
    return (
        <div
            className="shrink-0 snap-start rounded-[18px] px-3 py-3"
            style={{
                width: compactMobile ? '88%' : '72%',
                minWidth: compactMobile ? '280px' : '320px',
                maxWidth: compactMobile ? '360px' : '520px',
                background: '#DCF8C6',
                color: WA.textDark,
                border: '1px solid rgba(169,220,146,0.55)',
                boxShadow: '0 1px 1px rgba(17,29,26,0.10)',
            }}
        >
            <div className="flex items-center gap-2 mb-2">
                <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${accent}18`, color: accent }}
                >
                    {badge}
                </span>
                <span className="text-[11px] font-medium" style={{ color: WA.textMuted }}>
                    {label}
                </span>
            </div>

            <div className={`${compactMobile ? 'text-[13px]' : 'text-sm'} leading-relaxed whitespace-pre-wrap break-words`} style={{ minHeight: compactMobile ? '108px' : '96px' }}>
                {loading ? (
                    <span style={{ color: WA.textMuted }}>AI 正在生成候选回复...</span>
                ) : showError ? (
                    <span style={{ color: '#b91c1c' }}>生成失败：{error}</span>
                ) : text}
            </div>

            <div className="mt-3 flex gap-2">
                {waiting ? (
                    <button
                        onClick={onGenerate}
                        disabled={loading}
                        className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: accent }}
                    >
                        {loading ? '生成中…' : '点击 AI 生成'}
                    </button>
                ) : showError ? (
                    <button
                        onClick={onGenerate}
                        disabled={loading}
                        className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: accent }}
                    >
                        {loading ? '生成中…' : '重试生成'}
                    </button>
                ) : (
                    <>
                        <button
                            onClick={onEdit}
                            disabled={!canInteract}
                            className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: 'rgba(255,255,255,0.68)',
                                color: WA.textDark,
                                border: `1px solid ${WA.borderLight}`,
                            }}
                        >
                            编辑
                        </button>
                        <button
                            onClick={onSend}
                            disabled={!canInteract}
                            className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: accent }}
                        >
                            {sending ? '发送中…' : '使用'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

function ToolButton({ onClick, disabled = false, icon, label }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="px-3 py-2 rounded-full text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
            style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
        >
            {icon}
            {label ? <span>{label}</span> : null}
        </button>
    );
}

function SparkIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3z" />
        </svg>
    );
}

function RefreshIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M20 11a8 8 0 10.9 3.8" />
            <path d="M20 4v7h-7" />
        </svg>
    );
}

function CloseIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
        </svg>
    );
}

function ExpandIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M4 14l8-8 8 8" />
        </svg>
    );
}

function CollapseIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M20 10l-8 8-8-8" />
        </svg>
    );
}

function GlobeIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 010 18" />
            <path d="M12 3a15 15 0 000 18" />
        </svg>
    );
}

function SmileIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 9.5h.01" />
            <path d="M15.5 9.5h.01" />
            <path d="M8 14c1.1 1 2.4 1.5 4 1.5s2.9-.5 4-1.5" />
        </svg>
    );
}

function SpinnerIcon(props) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" {...props}>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" opacity="0.22" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}
