/**
 * EmptyState — 标准话术空状态提示
 */
import React from 'react';
import WA from '../utils/waTheme';

export default function EmptyState({ onRetry, message = '暂无匹配的标准话术' }) {
    return (
        <div className="text-center py-6">
            <div className="mb-3" style={{ color: 'rgba(245,158,11,0.3)' }}>
                <DocumentIcon />
            </div>
            <p className="text-sm mb-3" style={{ color: WA.textMuted }}>
                {message}
            </p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="text-xs px-3 py-1.5 rounded-full"
                    style={{
                        background: 'rgba(245,158,11,0.08)',
                        color: '#d97706',
                        border: '1px solid rgba(245,158,11,0.2)'
                    }}
                >
                    重新检索
                </button>
            )}
        </div>
    );
}

function DocumentIcon() {
    return (
        <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
        </svg>
    );
}
