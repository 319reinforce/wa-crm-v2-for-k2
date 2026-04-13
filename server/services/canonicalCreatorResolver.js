const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const { mergeDuplicateCreatorIntoCanonical } = require('./creatorMergeService');

const CACHE_TTL_MS = 30 * 1000;
const cacheByOperator = new Map();

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[_|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function compactText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function tokenize(value) {
    return normalizeText(value)
        .split(/[^a-z0-9]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2);
}

function buildIncomingEntries(name) {
    const values = Array.from(new Set([String(name || '').trim()].filter(Boolean)));
    return values.map((raw) => ({
        raw,
        normalized: normalizeText(raw),
        compact: compactText(raw),
        tokens: tokenize(raw),
    })).filter((entry) => entry.normalized || entry.compact);
}

function keyEntry(raw, source) {
    const normalized = normalizeText(raw);
    const compact = compactText(raw);
    const tokens = tokenize(raw);
    if (!normalized && !compact) return null;
    return { raw, source, normalized, compact, tokens };
}

function parseAliasBlob(blob) {
    return String(blob || '')
        .split(' | ')
        .map((entry) => {
            const idx = entry.indexOf(':');
            if (idx === -1) return null;
            return {
                aliasType: entry.slice(0, idx),
                aliasValue: entry.slice(idx + 1),
            };
        })
        .filter(Boolean);
}

function buildCandidateKeys(row) {
    const rawKeys = [
        keyEntry(row.primary_name, 'primary_name'),
        keyEntry(row.keeper_username, 'keeper_username'),
        keyEntry(row.keeper_link_username, 'keeper_link_username'),
        keyEntry(row.creator_name_jb, 'joinbrands_name'),
        keyEntry(row.raw_name, 'roster_raw_name'),
        keyEntry(row.raw_handle, 'roster_raw_handle'),
        keyEntry(row.raw_keeper_name, 'roster_raw_keeper_name'),
    ].filter(Boolean);

    const aliasKeys = parseAliasBlob(row.aliases).map((item) => keyEntry(item.aliasValue, item.aliasType)).filter(Boolean);
    return [...rawKeys, ...aliasKeys];
}

function tokenOverlap(a = [], b = []) {
    if (!a.length || !b.length) return 0;
    const setB = new Set(b);
    let overlap = 0;
    for (const token of a) {
        if (setB.has(token)) overlap += 1;
    }
    return overlap / Math.max(a.length, b.length);
}

function scoreCandidate(row, incomingEntries = [], phone, operator) {
    let score = 0;
    const reasons = [];
    const candidateKeys = buildCandidateKeys(row);
    const normalizedOperator = normalizeOperatorName(operator, operator || null);

    if (phone && row.wa_phone && String(row.wa_phone) === String(phone)) {
        score += 20000;
        reasons.push('exact_phone');
    }

    for (const incoming of incomingEntries) {
        let bestLocal = 0;
        let bestReason = null;
        for (const candidate of candidateKeys) {
            if (incoming.compact && candidate.compact && incoming.compact === candidate.compact && incoming.compact.length >= 4) {
                if (900 > bestLocal) {
                    bestLocal = 900;
                    bestReason = `exact:${candidate.source}`;
                }
                continue;
            }
            if (incoming.normalized && candidate.normalized && incoming.normalized === candidate.normalized) {
                if (850 > bestLocal) {
                    bestLocal = 850;
                    bestReason = `exact_norm:${candidate.source}`;
                }
                continue;
            }
            if (incoming.compact && candidate.compact) {
                const shorter = Math.min(incoming.compact.length, candidate.compact.length);
                const strongHandleSource = ['roster_raw_handle', 'keeper_username', 'keeper_link_username', 'csv_handle', 'csv_keeper_name'].includes(candidate.source);
                if (shorter >= 6 && (incoming.compact.includes(candidate.compact) || candidate.compact.includes(incoming.compact))) {
                    const containsScore = strongHandleSource ? 640 : 460;
                    if (containsScore > bestLocal) {
                        bestLocal = containsScore;
                        bestReason = `contains:${candidate.source}`;
                    }
                }
            }
            const overlap = tokenOverlap(incoming.tokens, candidate.tokens);
            if (overlap >= 0.75 && overlap > 0) {
                const tokenScore = incoming.tokens.length >= 2 && candidate.tokens.length >= 2 ? 260 : 180;
                if (tokenScore > bestLocal) {
                    bestLocal = tokenScore;
                    bestReason = `tokens:${candidate.source}`;
                }
            }
        }
        if (bestLocal > 0) {
            score += bestLocal;
            reasons.push(bestReason);
        }
    }

    if (normalizedOperator && normalizeOperatorName(row.operator, row.operator) === normalizedOperator) {
        score += 140;
        reasons.push('operator_match');
    }
    if (!row.wa_phone) {
        score += 80;
        reasons.push('blank_phone');
    }
    if (Number(row.msg_count || 0) > 0) {
        score += Math.min(Number(row.msg_count), 120);
        reasons.push('has_messages');
    }

    return { score, reasons };
}

async function loadRosterCandidates(operator) {
    const normalizedOperator = normalizeOperatorName(operator, operator || null);
    if (!normalizedOperator) return [];

    const cached = cacheByOperator.get(normalizedOperator);
    if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
        return cached.rows;
    }

    const rows = await db.getDb().prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.keeper_username,
            c.wa_owner,
            c.source,
            c.created_at,
            r.operator,
            r.session_id,
            r.raw_name,
            r.raw_handle,
            r.raw_keeper_name,
            k.keeper_username AS keeper_link_username,
            j.creator_name_jb,
            COUNT(DISTINCT wm.id) AS msg_count,
            GROUP_CONCAT(DISTINCT CONCAT(a.alias_type, ':', a.alias_value) ORDER BY a.alias_type, a.alias_value SEPARATOR ' | ') AS aliases
        FROM operator_creator_roster r
        JOIN creators c ON c.id = r.creator_id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN creator_aliases a ON a.creator_id = c.id
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        WHERE r.is_primary = 1 AND r.operator = ?
        GROUP BY
            c.id, c.primary_name, c.wa_phone, c.keeper_username, c.wa_owner, c.source, c.created_at,
            r.operator, r.session_id, r.raw_name, r.raw_handle, r.raw_keeper_name,
            k.keeper_username, j.creator_name_jb
    `).all(normalizedOperator);

    cacheByOperator.set(normalizedOperator, { loadedAt: Date.now(), rows });
    return rows;
}

async function getCreatorById(id) {
    if (!id) return null;
    return await db.getDb().prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(id);
}

async function getCreatorByPhone(phone) {
    if (!phone) return null;
    return await db.getDb().prepare('SELECT * FROM creators WHERE wa_phone = ? LIMIT 1').get(phone);
}

async function attachPhoneToCreator({ creatorId, phone, name, operator }) {
    if (!creatorId) return null;
    const creator = await getCreatorById(creatorId);
    if (!creator) return null;

    const updates = [];
    const values = [];

    if (!creator.wa_phone && phone) {
        updates.push('wa_phone = ?');
        values.push(phone);
    }
    if (name) {
        updates.push('primary_name = ?');
        values.push(name);
    }
    const normalizedOperator = normalizeOperatorName(operator, creator.wa_owner || operator || null);
    if (normalizedOperator) {
        updates.push('wa_owner = ?');
        values.push(normalizedOperator);
    }

    if (updates.length > 0) {
        values.push(creatorId);
        await db.getDb().prepare(`UPDATE creators SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`).run(...values);
    }

    if (phone) {
        await db.getDb().prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creatorId, 'wa_phone', phone, 1);
    }
    if (name) {
        await db.getDb().prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creatorId, 'wa_name', name, 1);
    }

    return creatorId;
}

function chooseBestCandidate(candidates, incomingEntries, phone, operator) {
    const scored = candidates
        .map((row) => {
            const scoredRow = scoreCandidate(row, incomingEntries, phone, operator);
            return { row, ...scoredRow };
        })
        .sort((a, b) =>
            b.score - a.score
            || Number(Boolean(!b.row.wa_phone)) - Number(Boolean(!a.row.wa_phone))
            || Number(b.row.msg_count || 0) - Number(a.row.msg_count || 0)
            || a.row.id - b.row.id
        );

    if (!scored.length) return null;
    const best = scored[0];
    const second = scored[1];
    const gap = best.score - Number(second?.score || 0);
    const strongMatch = best.reasons.some((reason) => String(reason || '').startsWith('exact:') || String(reason || '').startsWith('exact_norm:'));
    const acceptable = best.score >= 900 || (strongMatch && best.score >= 700) || (best.score >= 600 && gap >= 220);
    if (!acceptable) return null;

    return {
        creatorId: best.row.id,
        row: best.row,
        score: best.score,
        gap,
        reasons: best.reasons,
    };
}

async function resolveCanonicalCreator({ phone, name, operator }) {
    const incomingEntries = buildIncomingEntries(name);
    const exactPhoneCreator = await getCreatorByPhone(phone);
    const rosterCandidates = await loadRosterCandidates(operator);
    const best = chooseBestCandidate(rosterCandidates, incomingEntries, phone, operator);

    if (exactPhoneCreator && best && Number(exactPhoneCreator.id) !== Number(best.creatorId)) {
        if (best.score >= 700 && !best.row.wa_phone) {
            const merged = await mergeDuplicateCreatorIntoCanonical({
                targetCreatorId: best.creatorId,
                sourceCreatorId: exactPhoneCreator.id,
                operator,
                reason: `wa_resolve_merge:${best.reasons.join(',')}`,
            });
            await attachPhoneToCreator({ creatorId: best.creatorId, phone, name, operator });
            cacheByOperator.delete(normalizeOperatorName(operator, operator || null));
            return {
                creatorId: best.creatorId,
                created: false,
                mergedDuplicate: merged.merged,
                sourceCreatorId: exactPhoneCreator.id,
                resolution: 'merged_phone_duplicate_into_roster',
                score: best.score,
                reasons: best.reasons,
            };
        }

        await attachPhoneToCreator({ creatorId: exactPhoneCreator.id, phone, name, operator });
        return {
            creatorId: exactPhoneCreator.id,
            created: false,
            mergedDuplicate: false,
            resolution: 'existing_phone_creator',
            score: 20000,
            reasons: ['exact_phone'],
        };
    }

    if (best) {
        await attachPhoneToCreator({ creatorId: best.creatorId, phone, name, operator });
        cacheByOperator.delete(normalizeOperatorName(operator, operator || null));
        return {
            creatorId: best.creatorId,
            created: false,
            mergedDuplicate: false,
            resolution: best.row.wa_phone ? 'matched_existing_roster_with_phone' : 'attached_phone_to_roster',
            score: best.score,
            reasons: best.reasons,
        };
    }

    if (exactPhoneCreator) {
        await attachPhoneToCreator({ creatorId: exactPhoneCreator.id, phone, name, operator });
        return {
            creatorId: exactPhoneCreator.id,
            created: false,
            mergedDuplicate: false,
            resolution: 'existing_phone_creator',
            score: 20000,
            reasons: ['exact_phone'],
        };
    }

    return null;
}

function invalidateOperatorCache(operator) {
    const normalizedOperator = normalizeOperatorName(operator, operator || null);
    if (normalizedOperator) cacheByOperator.delete(normalizedOperator);
}

module.exports = {
    resolveCanonicalCreator,
    attachPhoneToCreator,
    invalidateOperatorCache,
    normalizeText,
    compactText,
};
