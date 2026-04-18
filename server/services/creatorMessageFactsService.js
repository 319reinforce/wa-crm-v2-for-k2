const INTERNAL_OPERATOR_NAMES = new Set(['beau', 'yiyun', 'jiawen']);

function normalizeCreatorIds(input = []) {
    return [...new Set(
        (input || [])
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0)
    )];
}

function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (!role) return null;
    if (role === 'assistant' || role === 'operator') return 'me';
    return role;
}

function hasNonBlankText(value) {
    return String(value || '').trim() !== '';
}

function isOperatorSelfRecord(source = {}) {
    const primaryName = String(source.primary_name || source.primaryName || '').trim().toLowerCase();
    const owner = String(source.wa_owner || source.waOwner || '').trim().toLowerCase();
    if (primaryName && INTERNAL_OPERATOR_NAMES.has(primaryName)) return true;
    return !!(primaryName && owner && primaryName === owner && INTERNAL_OPERATOR_NAMES.has(owner));
}

function pickMessageAggregate(source = {}) {
    return {
        msg_count: source.msg_count,
        user_message_count: source.user_message_count,
        nonblank_user_message_count: source.nonblank_user_message_count,
        first_user_message_at: source.first_user_message_at ?? source.first_user_ts ?? null,
        last_user_message_at: source.last_user_message_at ?? source.last_user_ts ?? null,
    };
}

function hasMessageAggregate(source = {}) {
    return (
        source
        && typeof source === 'object'
        && Object.prototype.hasOwnProperty.call(source, 'msg_count')
        && (
            Object.prototype.hasOwnProperty.call(source, 'user_message_count')
            || Object.prototype.hasOwnProperty.call(source, 'last_user_ts')
            || Object.prototype.hasOwnProperty.call(source, 'last_user_message_at')
        )
    );
}

function buildMessageFacts(source = {}, aggregate = {}, firstRaw = null, firstNonBlank = null) {
    const msgCount = Number(aggregate.msg_count || 0);
    const userMessageCount = Number(aggregate.user_message_count || 0);
    const nonblankUserMessageCount = Number(aggregate.nonblank_user_message_count || 0);
    const firstRawRole = normalizeRole(firstRaw?.role);
    const firstNonBlankRole = normalizeRole(firstNonBlank?.role);
    const selfRecord = isOperatorSelfRecord(source);
    const explicitJoined = Number(source.ev_joined || source?.joinbrands?.ev_joined || 0) === 1;
    const waShared = Number(source.ev_whatsapp_shared || source?.joinbrands?.ev_whatsapp_shared || 0) === 1;
    const waJoinedFromMessage = firstNonBlankRole === 'user' && !selfRecord;
    const waJoined = waJoinedFromMessage || explicitJoined || waShared;

    return {
        msg_count: msgCount,
        has_any_message: msgCount > 0,
        user_message_count: userMessageCount,
        nonblank_user_message_count: nonblankUserMessageCount,
        has_user_message: userMessageCount > 0,
        has_nonblank_user_message: nonblankUserMessageCount > 0,
        first_raw_role: firstRawRole,
        first_raw_nonblank: hasNonBlankText(firstRaw?.text),
        first_nonblank_role: firstNonBlankRole,
        first_nonblank_text: hasNonBlankText(firstNonBlank?.text) ? String(firstNonBlank.text) : '',
        first_user_message_at: aggregate.first_user_message_at || null,
        last_user_message_at: aggregate.last_user_message_at || null,
        wa_joined_from_message: waJoinedFromMessage,
        wa_joined: waJoined,
        is_operator_self_record: selfRecord,
    };
}

async function fetchCreatorMessageFactsMap(dbConn, creators = []) {
    const creatorList = Array.isArray(creators) ? creators : [];
    const creatorIds = normalizeCreatorIds(creatorList.map((item) => item?.id || item));
    if (creatorIds.length === 0) return new Map();

    const placeholders = creatorIds.map(() => '?').join(', ');
    const [firstRawRows, firstNonBlankRows] = await Promise.all([
        dbConn.prepare(`
            SELECT creator_id, role, text, timestamp, id
            FROM (
                SELECT creator_id, role, text, timestamp, id,
                    ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY timestamp, id) AS rn
                FROM wa_messages
                WHERE creator_id IN (${placeholders})
            ) ranked
            WHERE rn = 1
        `).all(...creatorIds),
        dbConn.prepare(`
            SELECT creator_id, role, text, timestamp, id
            FROM (
                SELECT creator_id, role, text, timestamp, id,
                    ROW_NUMBER() OVER (PARTITION BY creator_id ORDER BY timestamp, id) AS rn
                FROM wa_messages
                WHERE creator_id IN (${placeholders})
                  AND text IS NOT NULL AND text <> ''
            ) ranked
            WHERE rn = 1
        `).all(...creatorIds),
    ]);

    const aggregateById = new Map(creatorList.map((item) => {
        const creatorId = Number(item?.id || item);
        return [creatorId, pickMessageAggregate(item)];
    }));
    const firstRawById = new Map(firstRawRows.map((item) => [Number(item.creator_id), item]));
    const firstNonBlankById = new Map(firstNonBlankRows.map((item) => [Number(item.creator_id), item]));
    const creatorById = new Map(creatorList.map((item) => [Number(item?.id || item), item]));

    return new Map(creatorIds.map((creatorId) => {
        const source = creatorById.get(creatorId) || { id: creatorId };
        return [
            creatorId,
            buildMessageFacts(
                source,
                aggregateById.get(creatorId) || {},
                firstRawById.get(creatorId) || null,
                firstNonBlankById.get(creatorId) || null,
            ),
        ];
    }));
}

async function fetchCreatorMessageFacts(dbConn, creator) {
    const creatorId = Number(creator?.id || creator);
    let enrichedCreator = creator;
    if (creatorId > 0 && !hasMessageAggregate(creator)) {
        const aggregate = await dbConn.prepare(`
            SELECT
                COUNT(id) AS msg_count,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_message_count,
                SUM(CASE WHEN role = 'user' AND text IS NOT NULL AND TRIM(text) <> '' THEN 1 ELSE 0 END) AS nonblank_user_message_count,
                MIN(CASE WHEN role = 'user' THEN timestamp END) AS first_user_ts,
                MAX(CASE WHEN role = 'user' THEN timestamp END) AS last_user_ts
            FROM wa_messages
            WHERE creator_id = ?
        `).get(creatorId);
        enrichedCreator = {
            ...(typeof creator === 'object' && creator ? creator : { id: creatorId }),
            ...aggregate,
        };
    }
    const map = await fetchCreatorMessageFactsMap(dbConn, [enrichedCreator]);
    return map.get(Number(creator?.id || creator)) || buildMessageFacts(creator || {}, {}, null, null);
}

module.exports = {
    INTERNAL_OPERATOR_NAMES,
    isOperatorSelfRecord,
    buildMessageFacts,
    fetchCreatorMessageFacts,
    fetchCreatorMessageFactsMap,
};
