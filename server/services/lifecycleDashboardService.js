function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function isMissingTableError(err, tableName) {
    const message = String(err?.message || '').toLowerCase();
    const needle = String(tableName || '').toLowerCase();
    return message.includes("doesn't exist")
        || message.includes('no such table')
        || (needle && message.includes(needle));
}

async function getLifecycleDashboard(dbConn, filters = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    if (filters.owner) {
        where += ' AND LOWER(c.wa_owner) = LOWER(?)';
        params.push(filters.owner);
    }

    let rows = [];
    try {
        rows = await dbConn.prepare(`
            SELECT
                c.id,
                c.primary_name,
                c.wa_owner,
                cls.stage_key,
                cls.stage_label,
                cls.flags_json,
                cls.conflicts_json,
                cls.entry_reason,
                cls.evaluated_at
            FROM creator_lifecycle_snapshot cls
            INNER JOIN creators c ON c.id = cls.creator_id
            ${where}
            ORDER BY cls.evaluated_at DESC, c.id DESC
        `).all(...params);
    } catch (err) {
        if (!isMissingTableError(err, 'creator_lifecycle_snapshot')) throw err;
        return {
            total: 0,
            stage_counts: {},
            owner_stage_counts: {},
            referral_active_count: 0,
            conflict_count: 0,
            conflicts: [],
            snapshot_ready: false,
        };
    }

    const stageCounts = {};
    const ownerStageCounts = {};
    const conflicts = [];
    let referralActiveCount = 0;

    for (const row of rows) {
        const flags = parseJsonSafe(row.flags_json, {});
        const rowConflicts = parseJsonSafe(row.conflicts_json, []);
        const stageKey = String(row.stage_key || 'unknown');
        const ownerKey = String(row.wa_owner || 'Unknown');

        stageCounts[stageKey] = (stageCounts[stageKey] || 0) + 1;
        ownerStageCounts[ownerKey] = ownerStageCounts[ownerKey] || {};
        ownerStageCounts[ownerKey][stageKey] = (ownerStageCounts[ownerKey][stageKey] || 0) + 1;
        if (flags?.referral_active) referralActiveCount += 1;

        if (Array.isArray(rowConflicts) && rowConflicts.length > 0) {
            conflicts.push({
                creator_id: row.id,
                creator_name: row.primary_name || null,
                wa_owner: row.wa_owner || null,
                stage_key: row.stage_key || null,
                stage_label: row.stage_label || null,
                conflicts: rowConflicts,
                entry_reason: row.entry_reason || null,
                evaluated_at: row.evaluated_at || null,
            });
        }
    }

    return {
        total: rows.length,
        stage_counts: stageCounts,
        owner_stage_counts: ownerStageCounts,
        referral_active_count: referralActiveCount,
        conflict_count: conflicts.length,
        conflicts,
        snapshot_ready: true,
    };
}

module.exports = {
    getLifecycleDashboard,
};
