(function () {
    function renderLifecycleFunnel(data, deps) {
        const container = deps?.container;
        const stageMeta = deps?.stageMeta || [];
        const getDisplayCounts = deps?.getDisplayCounts;
        if (!container || typeof getDisplayCounts !== 'function') return;

        const counts = getDisplayCounts(data || []);
        const maxCount = Math.max(1, ...stageMeta.map(stage => counts[stage.key] || 0));
        const total = Math.max(1, counts.acquisition || (data || []).length);

        container.innerHTML = stageMeta.map((stage, index) => {
            const count = counts[stage.key] || 0;
            const prevStage = index === 0 ? null : stageMeta[index - 1];
            const prevCount = prevStage ? (counts[prevStage.key] || 0) : count;
            const width = count > 0 ? 42 + ((count / maxCount) * 58) : 16;
            const share = ((count / total) * 100).toFixed(0) + '%';
            const conversion = prevStage && prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) + '%' : '100%';

            return `
                <div class="lifecycle-funnel-row">
                    <div class="lifecycle-funnel-stage">
                        <span class="lifecycle-stage-dot" style="background:${stage.color};"></span>
                        <span>${stage.label}</span>
                    </div>
                    <div class="lifecycle-funnel-track">
                        <div class="lifecycle-funnel-fill" style="width:${width}%; background:${stage.color};">${count} 人</div>
                    </div>
                    <div class="lifecycle-funnel-metrics">
                        <strong>${share}</strong>
                        <span>相邻转化 ${conversion}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderLifecycleSummary(filtered, baseData, useOfficialStageBucket, deps) {
        const getStageBucketCounts = deps?.getStageBucketCounts;
        const getDisplayCounts = deps?.getDisplayCounts;
        const hasOfficialLifecycleSnapshot = deps?.hasOfficialLifecycleSnapshot;
        const getLifecycleTransitionHistory = deps?.getLifecycleTransitionHistory;
        const getLifecycleDashboard = deps?.getLifecycleDashboard;
        const getAllLifeDataLength = deps?.getAllLifeDataLength;
        if (
            typeof getStageBucketCounts !== 'function' ||
            typeof getDisplayCounts !== 'function' ||
            typeof hasOfficialLifecycleSnapshot !== 'function' ||
            typeof getLifecycleTransitionHistory !== 'function'
        ) {
            return;
        }

        const total = (filtered || []).length;
        const currentCounts = getStageBucketCounts(filtered || [], useOfficialStageBucket);
        const counts = getDisplayCounts(filtered || []);
        const riskCount = (filtered || []).filter(u => {
            const flags = u.lifecycle?.flags || {};
            return flags.churn_risk || (u.lifecycle?.conflicts || []).length > 0 || u.lifecycle_stage === 'terminated';
        }).length;
        const referralCount = (filtered || []).filter(u => u.lifecycle?.flags?.referral_active).length;
        const nonBackfillTransitionCount = (filtered || []).reduce((sum, u) => {
            return sum + getLifecycleTransitionHistory(u).filter(item => item && item.trigger_type !== 'migration_backfill').length;
        }, 0);
        const conversionRate = counts.acquisition > 0
            ? ((counts.revenue / counts.acquisition) * 100).toFixed(1) + '%'
            : (counts.revenue > 0 ? '100%' : '0%');
        const dashboard = typeof getLifecycleDashboard === 'function' ? getLifecycleDashboard() : null;
        const allLifeDataLength = typeof getAllLifeDataLength === 'function' ? getAllLifeDataLength() : (baseData || []).length;
        const officialCount = (filtered || []).filter(u => hasOfficialLifecycleSnapshot(u)).length;
        const officialText = officialCount > 0 ? ` · 官方快照 ${officialCount}` : '';

        const primary = document.getElementById('lifeSummaryPrimary');
        const secondary = document.getElementById('lifeSummarySecondary');
        const visible = document.getElementById('lifeVisibleCount');
        const conversion = document.getElementById('lifeConversionRate');
        const risk = document.getElementById('lifeRiskCount');
        const referral = document.getElementById('lifeReferralCount');
        const funnelMeta = document.getElementById('lifeFunnelMeta');
        const trendMeta = document.getElementById('lifeTrendMeta');
        const tableCount = document.getElementById('lifeTableCount');
        const tableTotal = document.getElementById('lifeTableTotal');
        const officialTag = document.getElementById('lifeOfficialTag');
        const currentTag = document.getElementById('lifeCurrentTag');

        if (primary) {
            primary.textContent = total
                ? '当前筛选内共有 ' + total + ' 位达人。顶部卡片与漏斗使用 v2 官方累计漏斗口径，列表与阶段筛选使用当前主阶段口径。'
                : '当前筛选条件下没有命中达人，可以调整负责人或阶段再看。';
        }
        if (secondary) {
            secondary.textContent = '当前阶段桶：获取 ' + (currentCounts.acquisition || 0) + ' / 激活 ' + (currentCounts.activation || 0) + ' / 留存 ' + (currentCounts.retention || 0) + ' / 变现 ' + (currentCounts.revenue || 0) + ' / 终止池 ' + (currentCounts.terminated || 0) + '。'
                + (useOfficialStageBucket ? (' 当前为 v2 官方阶段桶快照。' + officialText) : (nonBackfillTransitionCount > 0 ? ' 已发现 ' + nonBackfillTransitionCount + ' 条正式迁移记录。' : ' 趋势按 v2 事件时间与 snapshot 里程碑累计计算。'));
        }
        if (visible) visible.textContent = total;
        if (conversion) conversion.textContent = conversionRate;
        if (risk) risk.textContent = String(riskCount);
        if (referral) referral.textContent = String(referralCount);
        if (funnelMeta) funnelMeta.textContent = dashboard ? ('官方累计漏斗 · 快照样本 ' + (dashboard.total || 0) + ' 人') : ('按当前筛选统计 · 基准池 ' + (baseData || []).length + ' 人');
        if (trendMeta) trendMeta.textContent = total ? (nonBackfillTransitionCount > 0 ? '近 6 周累计到达曲线 · 含正式迁移记录 ' + nonBackfillTransitionCount + ' 条' : '近 6 周累计到达曲线 · 基于 v2 事件时间与 snapshot 里程碑') : '暂无可绘制数据';
        if (tableCount) tableCount.textContent = String(total);
        if (tableTotal) tableTotal.textContent = String(allLifeDataLength);
        if (officialTag) {
            officialTag.textContent = '获取 ' + (counts.acquisition || 0)
                + ' / 激活 ' + (counts.activation || 0)
                + ' / 留存 ' + (counts.retention || 0)
                + ' / 变现 ' + (counts.revenue || 0)
                + ' / 传播 ' + (counts.referral || 0);
        }
        if (currentTag) {
            currentTag.textContent = '获取 ' + (currentCounts.acquisition || 0)
                + ' / 激活 ' + (currentCounts.activation || 0)
                + ' / 留存 ' + (currentCounts.retention || 0)
                + ' / 变现 ' + (currentCounts.revenue || 0)
                + ' / 终止池 ' + (currentCounts.terminated || 0);
        }
    }

    function renderLifecycleDashboard(filtered, baseData, activeStage, useOfficialStageBucket, deps) {
        if (typeof deps?.onStateChange === 'function') {
            deps.onStateChange({
                filtered,
                baseData,
                useOfficialStageBucket
            });
        }

        if (typeof deps?.renderLifecycleStats === 'function') deps.renderLifecycleStats(filtered);
        if (typeof deps?.renderLifecycleStageList === 'function') deps.renderLifecycleStageList(baseData, activeStage, useOfficialStageBucket);

        renderLifecycleFunnel(filtered, {
            container: deps?.funnelContainer,
            stageMeta: deps?.stageMeta,
            getDisplayCounts: deps?.getDisplayCounts
        });

        renderLifecycleSummary(filtered, baseData, useOfficialStageBucket, {
            getStageBucketCounts: deps?.getStageBucketCounts,
            getDisplayCounts: deps?.getDisplayCounts,
            hasOfficialLifecycleSnapshot: deps?.hasOfficialLifecycleSnapshot,
            getLifecycleTransitionHistory: deps?.getLifecycleTransitionHistory,
            getLifecycleDashboard: deps?.getLifecycleDashboard,
            getAllLifeDataLength: deps?.getAllLifeDataLength
        });

        if (typeof deps?.renderLifecycleLegend === 'function') deps.renderLifecycleLegend();
        if (typeof deps?.drawLifecycleTrendChart === 'function' && typeof deps?.buildLifecycleTrend === 'function') {
            deps.drawLifecycleTrendChart(deps.buildLifecycleTrend(filtered));
        }
    }

    window.LifecycleDashboardRenderer = {
        renderLifecycleFunnel,
        renderLifecycleSummary,
        renderLifecycleDashboard
    };
})();
