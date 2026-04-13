/**
 * AIReplyPicker — AI 候选回复选择器
 * 纯 UI 组件，提取自 WAMessageComposer.jsx
 */
import React from 'react';

const WA = {
    bubbleOut: '#FFFFFF',
    textDark: '#374151',
    textMuted: '#9CA3AF',
};

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
}) {
    const PICKER_BG = '#EFF6FF';
    const PICKER_BORDER = '#BFDBFE';
    const PICKER_ACCENT = '#3b82f6';

    const translatingCustom = !!customToolLoading?.translate;
    const emojiCustomizing = !!customToolLoading?.emoji;
    const customDisabled = !customText?.trim();

    if (compactMobile) {
        return (
            <div style={{ background: PICKER_BG, borderTop: '2px solid ' + PICKER_BORDER }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid ' + PICKER_BORDER }}>
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">🤖</span>
                        <span className="text-xs font-bold truncate" style={{ color: PICKER_ACCENT }}>
                            AI 候选回复
                        </span>
                        {operatorLabel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(59,130,246,0.12)', color: PICKER_ACCENT }}>
                                {operatorLabel}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            onClick={onRegenerate}
                            disabled={loading}
                            className="text-[11px] px-2 py-1 rounded-lg font-medium disabled:opacity-50"
                            style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                            title="重新生成"
                        >
                            {loading ? '⏳' : '🔄'}
                        </button>
                        <button
                            onClick={onSkip}
                            className="text-[11px] px-2 py-1 rounded-lg font-medium"
                            style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}
                            title="跳过"
                        >
                            跳过
                        </button>
                        <button
                            onClick={onToggleCollapse}
                            className="text-[11px] px-2 py-1 rounded-lg font-medium"
                            style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}
                            title={collapsed ? '展开候选' : '收起候选'}
                        >
                            {collapsed ? '展开' : '收起'}
                        </button>
                    </div>
                </div>

                {collapsed ? (
                    <div className="px-3 py-2 text-[11px]" style={{ color: WA.textMuted }}>
                        候选已收起，点击“展开”查看并选择发送
                    </div>
                ) : loading ? (
                    <div className="flex items-center justify-center gap-2 py-5">
                        <span className="animate-spin text-lg">⏳</span>
                        <span className="text-xs" style={{ color: WA.textMuted }}>AI 生成中...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center gap-2 py-4 px-3">
                        <div className="text-red-500 text-xs font-medium">⚠️ {error}</div>
                        <button
                            onClick={onRegenerate}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                        >
                            重试
                        </button>
                    </div>
                ) : (
                    <div className="p-3 space-y-3">
                        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1">
                            <CandidateCard
                                badge="A"
                                title="方案一"
                                text={candidates?.opt1 || '(空)'}
                                badgeBg="#3b82f620"
                                badgeColor="#3b82f6"
                                sendBg="#3b82f6"
                                onEdit={() => onEditCandidate(candidates?.opt1)}
                                onSend={() => onSelect('opt1')}
                            />
                            <CandidateCard
                                badge="B"
                                title="方案二"
                                text={candidates?.opt2 || '(空)'}
                                badgeBg="#10b98120"
                                badgeColor="#10b981"
                                sendBg="#10b981"
                                onEdit={() => onEditCandidate(candidates?.opt2)}
                                onSend={() => onSelect('opt2')}
                            />
                        </div>

                        <details className="rounded-xl px-3 py-2" style={{ background: 'rgba(15,23,42,0.03)', border: '1px dashed rgba(59,130,246,0.3)' }}>
                            <summary className="text-xs font-semibold cursor-pointer" style={{ color: '#1d4ed8' }}>
                                自定义回复（可展开）
                            </summary>
                            <div className="mt-2 space-y-2">
                                <textarea
                                    value={customText}
                                    onChange={e => onCustomChange(e.target.value)}
                                    placeholder="输入自定义回复..."
                                    rows={3}
                                    className="w-full text-sm rounded-xl px-3 py-2 focus:outline-none resize-y"
                                    style={{
                                        background: '#fff',
                                        color: WA.textDark,
                                        border: '1px solid rgba(0,0,0,0.08)',
                                        minHeight: '88px',
                                    }}
                                />
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={onTranslateCustom}
                                        disabled={customDisabled || translatingCustom || emojiCustomizing}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                        style={{ background: 'rgba(59,130,246,0.12)', color: '#1d4ed8' }}
                                    >
                                        {translatingCustom ? '⏳' : '🌐'} 翻译
                                    </button>
                                    <button
                                        onClick={onEmojiCustom}
                                        disabled={customDisabled || translatingCustom || emojiCustomizing}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                        style={{ background: 'rgba(16,185,129,0.14)', color: '#047857' }}
                                    >
                                        {emojiCustomizing ? '⏳' : '😄'} Emoji
                                    </button>
                                    <button
                                        onClick={() => onSelect('custom')}
                                        disabled={customDisabled}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                                        style={{ background: '#f59e0b' }}
                                    >
                                        发送自定义
                                    </button>
                                </div>
                            </div>
                        </details>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ background: PICKER_BG, borderTop: '2px solid ' + PICKER_BORDER }}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid ' + PICKER_BORDER }}>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">🤖</span>
                    <span className="text-sm font-bold" style={{ color: PICKER_ACCENT }}>AI 推荐回复</span>
                    {operatorLabel && (
                        <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(59,130,246,0.12)', color: PICKER_ACCENT }}>
                            Operator: {operatorLabel}
                        </span>
                    )}
                    {promptVersion && (
                        <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(15,23,42,0.06)', color: WA.textMuted }}>
                            Prompt: {promptVersion}
                        </span>
                    )}
                    {operatorConfigured ***REMOVED***= false && (
                        <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                            使用基础路由
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {incomingMsg && (
                        <span className="text-xs px-3 py-1 rounded-full hidden sm:inline" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                            来: {incomingMsg.text.slice(0, 40)}{incomingMsg.text.length > 40 ? '...' : ''}
                        </span>
                    )}
                    <button
                        onClick={onRegenerate}
                        disabled={loading}
                        className="text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 disabled:opacity-50"
                        style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                        title="重新生成"
                    >
                        <span className={loading ? 'animate-spin' : ''}>{loading ? '⏳' : '🔄'}</span>
                        <span className="hidden sm:inline">重新生成</span>
                    </button>
                    <button onClick={onSkip} className="text-sm px-3 py-1.5 rounded-xl hover:bg-black/10 font-medium" style={{ color: WA.textMuted }}>
                        跳过
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-3 py-8">
                    <span className="animate-spin text-2xl">⏳</span>
                    <span className="text-sm" style={{ color: WA.textMuted }}>AI 正在生成候选回复...</span>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center gap-3 py-6 px-4">
                    <div className="text-red-500 text-sm font-medium">⚠️ {error}</div>
                    <button
                        onClick={onRegenerate}
                        className="text-sm px-4 py-2 rounded-xl font-medium"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                    >
                        🔄 重试
                    </button>
                </div>
            ) : (
                <div className="px-3 pb-3 pt-2 md:px-4 md:pb-4 md:pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold" style={{ color: WA.textMuted }}>左右滑动选择方案</div>
                    </div>
                    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
                        <CandidateCard
                            badge="A"
                            title="方案一"
                            text={candidates?.opt1 || '(空)'}
                            badgeBg="#3b82f620"
                            badgeColor="#3b82f6"
                            sendBg="#3b82f6"
                            onEdit={() => onEditCandidate(candidates?.opt1)}
                            onSend={() => onSelect('opt1')}
                            width="72%"
                            minWidth="320px"
                            maxWidth="520px"
                            textSize="text-sm"
                            maxHeight="110px"
                        />
                        <CandidateCard
                            badge="B"
                            title="方案二"
                            text={candidates?.opt2 || '(空)'}
                            badgeBg="#10b98120"
                            badgeColor="#10b981"
                            sendBg="#10b981"
                            onEdit={() => onEditCandidate(candidates?.opt2)}
                            onSend={() => onSelect('opt2')}
                            width="72%"
                            minWidth="320px"
                            maxWidth="520px"
                            textSize="text-sm"
                            maxHeight="110px"
                        />
                    </div>

                    <details className="rounded-xl px-3 py-2" style={{ background: 'rgba(15,23,42,0.03)', border: '1px dashed rgba(59,130,246,0.3)' }}>
                        <summary className="text-xs font-semibold cursor-pointer" style={{ color: '#1d4ed8' }}>
                            自定义回复（可展开）
                        </summary>
                        <div className="mt-2 space-y-2">
                            <textarea
                                value={customText}
                                onChange={e => onCustomChange(e.target.value)}
                                placeholder="在这里输入你的自定义回复..."
                                rows={2}
                                className="w-full text-sm rounded-xl px-3 py-2 focus:outline-none resize-y"
                                style={{
                                    background: '#fff',
                                    color: WA.textDark,
                                    border: '1px solid rgba(0,0,0,0.08)',
                                    minHeight: '72px',
                                }}
                            />
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={onTranslateCustom}
                                    disabled={customDisabled || translatingCustom || emojiCustomizing}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                    style={{ background: 'rgba(59,130,246,0.12)', color: '#1d4ed8' }}
                                >
                                    {translatingCustom ? '⏳' : '🌐'} 翻译
                                </button>
                                <button
                                    onClick={onEmojiCustom}
                                    disabled={customDisabled || translatingCustom || emojiCustomizing}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                    style={{ background: 'rgba(16,185,129,0.14)', color: '#047857' }}
                                >
                                    {emojiCustomizing ? '⏳' : '😄'} Emoji
                                </button>
                                <button
                                    onClick={() => onSelect('custom')}
                                    disabled={customDisabled}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                                    style={{ background: '#f59e0b' }}
                                >
                                    发送自定义
                                </button>
                            </div>
                        </div>
                    </details>
                </div>
            )}
        </div>
    );
}

function CandidateCard({
    badge,
    title,
    text,
    badgeBg,
    badgeColor,
    sendBg,
    onEdit,
    onSend,
    width,
    minWidth,
    maxWidth,
    textSize = 'text-sm',
    maxHeight = '140px',
}) {
    return (
        <div
            className="shrink-0 snap-start rounded-2xl px-3 py-3"
            style={{
                width: width || '88%',
                minWidth,
                maxWidth,
                background: WA.bubbleOut,
                color: WA.textDark,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            }}
        >
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: badgeBg, color: badgeColor }}>
                    {badge}
                </span>
                <span className="text-xs" style={{ color: WA.textMuted }}>{title}</span>
            </div>
            <div className={`whitespace-pre-wrap break-words ${textSize} leading-relaxed overflow-y-auto`} style={{ maxHeight }}>
                {text}
            </div>
            <div className="mt-3 flex gap-2">
                <button
                    onClick={onEdit}
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: 'rgba(15,23,42,0.06)', color: '#334155' }}
                >
                    编辑
                </button>
                <button
                    onClick={onSend}
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-bold text-white"
                    style={{ background: sendBg }}
                >
                    发送
                </button>
            </div>
        </div>
    );
}
