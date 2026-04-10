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
    customText,
    onCustomChange,
    onSelect,
    onSkip,
    onEditCandidate,
    onRegenerate,
    loading,
    error,
}) {
    const PICKER_BG = '#EFF6FF';
    const PICKER_BORDER = '#BFDBFE';
    const PICKER_ACCENT = '#3b82f6';

    return (
        <div style={{ background: PICKER_BG, borderTop: '2px solid ' + PICKER_BORDER }}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid ' + PICKER_BORDER }}>
                <div className="flex items-center gap-2">
                    <span className="text-base">🤖</span>
                    <span className="text-sm font-bold" style={{ color: PICKER_ACCENT }}>AI 推荐回复</span>
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
                <div className="p-3 md:p-4 space-y-2 md:space-y-3">
                    {/* opt1 */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: WA.bubbleOut, color: WA.textDark, boxShadow: '0 1px 2px rgba(0,0,0,0.1)', maxHeight: '180px', display: 'flex', flexDirection: 'column' }}>
                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#3b82f620', color: '#3b82f6' }}>A</span>
                                <span className="text-xs" style={{ color: WA.textMuted }}>方案一</span>
                            </div>
                            <div className="whitespace-pre-wrap break-words overflow-y-auto flex-1" style={{ maxHeight: '120px' }}>{candidates?.opt1 || '(空)'}</div>
                        </div>
                        <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                                onClick={() => onEditCandidate(candidates?.opt1)}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium text-white"
                                style={{ background: '#3b82f6' }}
                            >
                                编辑
                            </button>
                            <button
                                onClick={() => onSelect('opt1')}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold text-white"
                                style={{ background: '#3b82f688' }}
                            >
                                发送
                            </button>
                        </div>
                    </div>

                    {/* opt2 */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: WA.bubbleOut, color: WA.textDark, boxShadow: '0 1px 2px rgba(0,0,0,0.1)', maxHeight: '180px', display: 'flex', flexDirection: 'column' }}>
                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#10b98120', color: '#10b981' }}>B</span>
                                <span className="text-xs" style={{ color: WA.textMuted }}>方案二</span>
                            </div>
                            <div className="whitespace-pre-wrap break-words overflow-y-auto flex-1" style={{ maxHeight: '120px' }}>{candidates?.opt2 || '(空)'}</div>
                        </div>
                        <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                                onClick={() => onEditCandidate(candidates?.opt2)}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium text-white"
                                style={{ background: '#10b981' }}
                            >
                                编辑
                            </button>
                            <button
                                onClick={() => onSelect('opt2')}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold text-white"
                                style={{ background: '#10b98188' }}
                            >
                                发送
                            </button>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}
