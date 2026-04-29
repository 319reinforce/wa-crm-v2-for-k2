(function () {
    function switchView(opts) {
        const mode = opts?.mode === 'board' ? 'board' : 'table';
        const tableBtn = opts?.tableBtn;
        const boardBtn = opts?.boardBtn;
        const tableWrap = opts?.tableWrap;
        const boardGrid = opts?.boardGrid;
        const isBoard = mode === 'board';

        if (tableBtn) tableBtn.classList.toggle('active', !isBoard);
        if (boardBtn) boardBtn.classList.toggle('active', isBoard);
        if (tableWrap) {
            tableWrap.classList.toggle('life-view-hidden', isBoard);
            tableWrap.style.display = isBoard ? 'none' : '';
        }
        if (boardGrid) {
            boardGrid.classList.toggle('life-view-hidden', !isBoard);
            boardGrid.style.display = isBoard ? 'grid' : 'none';
        }
    }

    function renderTable(data, deps) {
        const tbody = deps?.tbody;
        if (!tbody) return;
        if (!data || data.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        const escapeHtml = deps?.escapeHtml || ((value) => String(value ?? ''));
        const escapeHtmlAttr = deps?.escapeHtmlAttr || ((value) => String(value ?? ''));
        const getChatTargetAttrs = deps?.getChatTargetAttrs || (() => '');
        const buildV2WorkspaceUrl = deps?.buildV2WorkspaceUrl || null;

        tbody.innerHTML = data.map((u) => {
            const owner = u.wa_owner || '-';
            const ownerClass = owner === 'Beau' ? 'owner-beau' : owner === 'Yiyun' ? 'owner-yiyun' : '';
            const lastActive = u.last_active ? deps.formatRelativeTime(new Date(u.last_active)) : '-';
            const msgCount = u.msg_count || 0;
            const lifecycleLabel = deps.getLifecycleLabel(u.lifecycle?.stage_key, u.lifecycle?.stage_label);
            const betaStatus = u.events?.monthly_beta?.status || '-';
            const monthlyFeeStatus = deps.getMonthlyFeeDisplay(u.events?.monthly_fee?.status, u.events?.monthly_fee?.deducted);
            const agencyText = u.events?.agency_binding?.bound ? '✅已绑定' : '❌未绑定';
            const referralText = u.lifecycle?.flags?.referral_active ? '是' : '-';
            const conflictText = deps.getLifecycleConflictText(u);
            const entryReason = u.lifecycle?.entry_reason || '-';
            const option0 = u.lifecycle?.option0?.next_action_template || '-';
            const stageMeta = deps.getLifecycleStageMeta(u.lifecycle_stage);
            const badgeList = deps.getLifecycleBadges(u);
            const chatTargetAttrs = getChatTargetAttrs(u.phone, u.name);
            const creatorIdAttr = escapeHtmlAttr(u.id || '');
            const v2Url = buildV2WorkspaceUrl ? buildV2WorkspaceUrl({
                tab: 'creators',
                creatorId: u.id,
                waPhone: u.phone,
                owner: u.wa_owner,
            }) : '';

            return `<tr class="chat-target-row" data-creator-id="${creatorIdAttr}" ${chatTargetAttrs}>
                <td>${escapeHtml(u.name || 'Unknown')}</td>
                <td>${escapeHtml(u.phone || '-')}</td>
                <td class="${ownerClass}">${escapeHtml(owner)}</td>
                <td><span class="life-stage-chip"><span class="lifecycle-stage-dot" style="background:${stageMeta.color};"></span>${escapeHtml(lifecycleLabel)}</span></td>
                <td>${escapeHtml(betaStatus)}</td>
                <td>${badgeList.length ? badgeList.map(label => `<span class="life-flag-chip ${label === '流失风险' ? 'risk' : ''}">${escapeHtml(label)}</span>`).join('') : '<span class="life-muted">-</span>'}</td>
                <td>${escapeHtml(monthlyFeeStatus)}</td>
                <td>${escapeHtml(agencyText)}</td>
                <td>${escapeHtml(referralText)}</td>
                <td>${escapeHtml(conflictText)}</td>
                <td>${escapeHtml(entryReason)}</td>
                <td>${escapeHtml(option0)}</td>
                <td class="last-active">${escapeHtml(lastActive)}</td>
                <td>${msgCount}</td>
                <td>${v2Url ? `<button type="button" class="action-btn js-open-v2" data-v2-url="${escapeHtmlAttr(v2Url)}">中台</button>` : '-'}</td>
            </tr>`;
        }).join('');
    }

    function renderBoard(data, deps) {
        const board = deps?.board;
        if (!board) return;
        if (!data || data.length === 0) {
            board.innerHTML = '';
            return;
        }

        const escapeHtml = deps?.escapeHtml || ((value) => String(value ?? ''));
        const escapeHtmlAttr = deps?.escapeHtmlAttr || ((value) => String(value ?? ''));
        const getChatTargetAttrs = deps?.getChatTargetAttrs || (() => '');
        const buildV2WorkspaceUrl = deps?.buildV2WorkspaceUrl || null;

        board.innerHTML = data.map((u) => {
            const owner = u.wa_owner || '-';
            const lifecycleLabel = deps.getLifecycleLabel(u.lifecycle?.stage_key, u.lifecycle?.stage_label);
            const stageMeta = deps.getLifecycleStageMeta(u.lifecycle_stage);
            const monthlyFeeStatus = deps.getMonthlyFeeDisplay(u.events?.monthly_fee?.status, u.events?.monthly_fee?.deducted);
            const agencyText = u.events?.agency_binding?.bound ? '已绑定' : '未绑定';
            const gmv = Number(u.keeper_gmv || 0);
            const chart = deps.renderPersonalLifecycleMiniChart(u);
            const processTrack = deps.renderLifecycleProcessTrack(u);
            const events = deps.getLifecycleBoardEvents(u);
            const entryReason = u.lifecycle?.entry_reason || '-';
            const chatTargetAttrs = getChatTargetAttrs(u.phone, u.name);
            const creatorIdAttr = escapeHtmlAttr(u.id || '');
            const v2Url = buildV2WorkspaceUrl ? buildV2WorkspaceUrl({
                tab: 'creators',
                creatorId: u.id,
                waPhone: u.phone,
                owner: u.wa_owner,
            }) : '';

            return `<div class="life-board-card" data-creator-id="${creatorIdAttr}" ${chatTargetAttrs}>
                <div class="life-board-header">
                    <div>
                        <div class="life-board-name">${escapeHtml(u.name || 'Unknown')}</div>
                        <div class="life-board-sub">${escapeHtml(u.phone || '-')} · 负责人 ${escapeHtml(owner)}</div>
                    </div>
                    <div class="life-board-stage">
                        <span class="life-stage-chip"><span class="lifecycle-stage-dot" style="background:${stageMeta.color};"></span>${escapeHtml(lifecycleLabel)}</span>
                    </div>
                </div>

                <div class="life-board-meta">
                    <div class="life-board-metric"><div class="life-board-metric-label">月费状态</div><div class="life-board-metric-value">${escapeHtml(monthlyFeeStatus)}</div></div>
                    <div class="life-board-metric"><div class="life-board-metric-label">Agency</div><div class="life-board-metric-value">${escapeHtml(agencyText)}</div></div>
                    <div class="life-board-metric"><div class="life-board-metric-label">GMV</div><div class="life-board-metric-value">${Math.round(gmv)}</div></div>
                    <div class="life-board-metric"><div class="life-board-metric-label">消息数</div><div class="life-board-metric-value">${u.msg_count || 0}</div></div>
                </div>

                <div class="life-board-events">
                    ${events.length ? events.map(label => `<span class="life-board-event-chip">${escapeHtml(label)}</span>`).join('') : '<span class="life-board-event-chip">暂无关键事件</span>'}
                </div>

                <div class="life-mini-note" style="margin-bottom:8px;">${escapeHtml(entryReason)}</div>

                <div class="life-mini-chart">
                    ${chart.header}
                    ${chart.svg}
                    ${chart.axis}
                </div>
                ${processTrack}
                ${v2Url ? `<div class="life-board-actions"><button type="button" class="action-btn js-open-v2" data-v2-url="${escapeHtmlAttr(v2Url)}">在中台打开</button></div>` : ''}
            </div>`;
        }).join('');
    }

    window.LifecycleRowsRenderer = {
        switchView,
        renderTable,
        renderBoard
    };
})();
