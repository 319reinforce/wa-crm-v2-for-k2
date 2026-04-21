/**
 * AIReplyPicker — AI 候选回复选择器
 * 统一为聊天工作台样式的候选托盘
 */
import React from 'react';
import WA from '../utils/waTheme';
import StandardReplyCard from './StandardReplyCard';

export default function AIReplyPicker({
    incomingMsg,
    candidates,
    operatorLabel,
    operatorConfigured,
    promptVersion,
    customText,
    onCustomChange,
    onTranslateCustom,
    onEmojiCustom,
    customToolLoading,
    onSelect,
    onSkip,
    onEditCandidate,
    onRegenerate,
    loading,
    error,
    compactMobile = false,
    collapsed = false,
    onToggleCollapse,
    // 新增：标准话术相关 props
    standardTemplate,
    standardLoading,
    standardError,
    onSelectStandard,
    scene,
    operator,
    clientId,
}) {
    const translatingCustom = !!customToolLoading?.translate;
    const emojiCustomizing = !!customToolLoading?.emoji;
    const customDisabled = !customText?.trim();

    const shellStyle = {
        background: WA.shellPanelStrong,
        borderTop: `1px solid ${WA.borderLight}`,
        boxShadow: '0 -12px 24px rgba(31,29,26,0.06)',
    };

    const content = loading ? (
        <StatePanel
            icon={<SpinnerIcon />}
            text="AI 正在生成候选回复..."
        />
    ) : error ? (
        <div className="flex flex-col items-center gap-3 py-5 px-4">
            <div className="text-sm font-medium" style={{ color: '#dc2626' }}>⚠️ {error}</div>
            <button
                onClick={onRegenerate}
                className="px-4 py-2 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.14)' }}
            >
                重试
            </button>
        </div>
    ) : (
        <div className={`${compactMobile ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3'} space-y-3`}>
            <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold tracking-[0.06em] uppercase" style={{ color: WA.textMuted }}>
                    Swipe To Choose
                </div>
                {incomingMsg?.text && !compactMobile && (
                    <div className="max-w-[42%] truncate text-[11px]" style={{ color: WA.textMuted }}>
                        来信: {incomingMsg.text}
                    </div>
                )}
            </div>

            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1">
                <CandidateCard
                    badge="A"
                    label="方案一"
                    text={candidates?.opt1 || '(空)'}
                    accent="#2563eb"
                    onEdit={() => onEditCandidate(candidates?.opt1)}
                    onSend={() => onSelect('opt1')}
                    compactMobile={compactMobile}
                />
                <CandidateCard
                    badge="B"
                    label="方案二"
                    text={candidates?.opt2 || '(空)'}
                    accent="#0f766e"
                    onEdit={() => onEditCandidate(candidates?.opt2)}
                    onSend={() => onSelect('opt2')}
                    compactMobile={compactMobile}
                />
                <StandardReplyCard
                    scene={scene}
                    operator={operator}
                    userMessage={incomingMsg?.text}
                    clientId={clientId}
                    onEdit={onEditCandidate}
                    onSend={(text) => onSelectStandard?.(text)}
                    compactMobile={compactMobile}
                    autoFetch={true}
                />
            </div>

            <div
                className="rounded-[18px] px-3 py-3"
                style={{ background: WA.white, border: `1px dashed ${WA.borderLight}` }}
            >
                <div className="flex items-center gap-2 mb-2.5">
                    <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,158,11,0.16)', color: '#b45309' }}
                    >
                        Custom
                    </span>
                    <span className="text-[11px] font-medium" style={{ color: WA.textMuted }}>
                        可直接翻译、加 Emoji 或人工改写后发送
                    </span>
                </div>

                <textarea
                    value={customText}
                    onChange={e => onCustomChange(e.target.value)}
                    placeholder="在这里输入要翻译或发送的文本..."
                    rows={compactMobile ? 3 : 2}
                    className="w-full text-sm rounded-[16px] px-3 py-2.5 focus:outline-none resize-y"
                    style={{
                        background: WA.shellPanelMuted,
                        color: WA.textDark,
                        border: `1px solid ${WA.borderLight}`,
                        minHeight: compactMobile ? '92px' : '84px',
                    }}
                />

                <div className="mt-2.5 flex flex-wrap gap-2">
                    <ToolButton
                        onClick={onTranslateCustom}
                        disabled={customDisabled || translatingCustom || emojiCustomizing}
                        icon={translatingCustom ? <SpinnerIcon /> : <GlobeIcon />}
                        label="翻译"
                    />
                    <ToolButton
                        onClick={onEmojiCustom}
                        disabled={customDisabled || translatingCustom || emojiCustomizing}
                        icon={emojiCustomizing ? <SpinnerIcon /> : <SmileIcon />}
                        label="Emoji"
                    />
                    <button
                        onClick={() => onSelect('custom')}
                        disabled={customDisabled}
                        className="px-3.5 py-2 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                        style={{ background: WA.teal }}
                    >
                        发送自定义
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div style={shellStyle}>
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
                            AI Reply Drafts
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
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <ToolButton
                        onClick={onRegenerate}
                        disabled={loading}
                        icon={loading ? <SpinnerIcon /> : <RefreshIcon />}
                        label={compactMobile ? '' : '重生成'}
                    />
                    <ToolButton
                        onClick={onSkip}
                        icon={<CloseIcon />}
                        label={compactMobile ? '' : '跳过'}
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

function CandidateCard({ badge, label, text, accent, onEdit, onSend, compactMobile }) {
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
                <span className="text-[11px] font-medium" style={{ color: WA.textMuted }}>{label}</span>
            </div>
            <div
                className={`whitespace-pre-wrap break-words ${compactMobile ? 'text-[13px]' : 'text-sm'} leading-relaxed overflow-y-auto`}
                style={{ maxHeight: compactMobile ? '138px' : '120px' }}
            >
                {text}
            </div>
            <div className="mt-3 flex gap-2">
                <button
                    onClick={onEdit}
                    className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.68)', color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
                >
                    编辑
                </button>
                <button
                    onClick={onSend}
                    className="flex-1 px-3 py-2 rounded-full text-[12px] font-semibold text-white"
                    style={{ background: accent }}
                >
                    使用
                </button>
            </div>
        </div>
    );
}

function StatePanel({ icon, text }) {
    return (
        <div className="flex items-center justify-center gap-3 py-7">
            <div style={{ color: WA.textMuted }}>{icon}</div>
            <span className="text-sm" style={{ color: WA.textMuted }}>{text}</span>
        </div>
    );
}

function ToolButton({ onClick, icon, label, disabled = false }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="px-3 py-2 rounded-full text-[11px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
        >
            {icon}
            {label ? <span>{label}</span> : null}
        </button>
    );
}

function StrokeIcon({ children, size = 16, strokeWidth = 1.85, color = 'currentColor', viewBox = '0 0 24 24' }) {
    return (
        <svg width={size} height={size} viewBox={viewBox} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

function SparkIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
        </StrokeIcon>
    );
}

function RefreshIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M20 11a8 8 0 1 0 2.2 5.5" />
            <path d="M20 4v7h-7" />
        </StrokeIcon>
    );
}

function GlobeIcon(props) {
    return (
        <StrokeIcon {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 0 18" />
            <path d="M12 3a15 15 0 0 0 0 18" />
        </StrokeIcon>
    );
}

function SmileIcon(props) {
    return (
        <StrokeIcon {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
            <path d="M9 10h.01" />
            <path d="M15 10h.01" />
        </StrokeIcon>
    );
}

function CloseIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
        </StrokeIcon>
    );
}

function CollapseIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M7 14l5-5 5 5" />
        </StrokeIcon>
    );
}

function ExpandIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M7 10l5 5 5-5" />
        </StrokeIcon>
    );
}

function SpinnerIcon(props) {
    return (
        <StrokeIcon {...props}>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 5v5h-5" />
        </StrokeIcon>
    );
}
