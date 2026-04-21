/**
 * LoadingSkeleton — 标准话术加载骨架屏
 */
import React from 'react';

export default function LoadingSkeleton({ compactMobile = false }) {
    return (
        <div className="animate-pulse space-y-2">
            <div
                className="h-4 rounded"
                style={{
                    background: 'rgba(245,158,11,0.12)',
                    width: compactMobile ? '85%' : '75%'
                }}
            />
            <div
                className="h-4 rounded"
                style={{
                    background: 'rgba(245,158,11,0.12)',
                    width: '100%'
                }}
            />
            <div
                className="h-4 rounded"
                style={{
                    background: 'rgba(245,158,11,0.12)',
                    width: compactMobile ? '90%' : '86%'
                }}
            />
        </div>
    );
}
