/**
 * JudgeQuickForm — Bonus 周期判定表单
 * 提取自 EventPanel.jsx
 */
import React, { useState } from 'react';

const WA = {
    borderLight: '#E5E7EB',
    lightBg: '#F9FAFB',
    teal: '#14B8A6',
    textMuted: '#9CA3AF',
    textDark: '#374151',
};

export default function JudgeQuickForm({ eventId, onJudge }) {
    const [videoCount, setVideoCount] = useState('0');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const now = new Date();
            const periodStart = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
            const res = await fetch(`/api/events/${eventId}/judge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    period_start: periodStart,
                    period_end: now.toISOString(),
                    video_count: parseInt(videoCount) || 0,
                }),
            });
            const data = await res.json();
            setResult(data);
            if (onJudge) onJudge(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    value={videoCount}
                    onChange={e => setVideoCount(e.target.value)}
                    className="flex-1 text-sm px-3 py-2 rounded-xl border"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    placeholder="发布条数"
                />
                <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: WA.teal }}
                >
                    {loading ? '⏳' : '判定'}
                </button>
            </div>
            {result && (
                <div className="text-xs p-2 rounded-lg" style={{ background: result.bonus_earned > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)' }}>
                    <span style={{ color: result.bonus_earned > 0 ? '#10b981' : '#ef4444' }}>
                        {result.bonus_earned > 0 ? `✅ Bonus: $${result.bonus_earned}` : '❌ 未达目标，无 Bonus'}
                    </span>
                    <span className="ml-2" style={{ color: WA.textMuted }}>（{result.video_count}/{result.weekly_target} 条）</span>
                </div>
            )}
        </div>
    );
}
