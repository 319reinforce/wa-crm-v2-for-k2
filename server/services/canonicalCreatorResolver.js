const db = require('../../db');
const creatorCache = require('./creatorCache');
const { normalizeOperatorName } = require('../utils/operator');
const { mergeDuplicateCreatorIntoCanonical } = require('./creatorMergeService');

const CACHE_TTL_MS = 30 * 1000;
const cacheByOperator = new Map();
const inflightByOperator = new Map();

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

// 所有 driver 和历史数据里出现过的"查无此人"占位名，决不能参与 fuzzy 匹配 —
// baileys 在 pushName 缺失时默认填 'Unknown'，而 3443 之类的老 creator
// primary_name 也是 'Unknown'，不过滤会让任意陌生号码的消息 score+900 命中同名 creator，
// resolver 然后 attachPhoneToCreator 把陌生 LID 挂到那个 creator 的 alias 上，串台到底。
const GENERIC_NAME_BLOCKLIST = new Set([
    'unknown',
    'noname',
    'nobody',
    'contact',
    'user',
    'anonymous',
    'guest',
    'friend',
    'null',
    'undefined',
]);

// 接受 raw 或已 normalized 的字符串（normalizeText 幂等），
// 外部调用方不需要关心是否已经归一化。
function isGenericName(value) {
    const normalized = normalizeText(value);
    if (!normalized) return true;
    return GENERIC_NAME_BLOCKLIST.has(normalized);
}

function buildIncomingEntries(name) {
    const values = Array.from(new Set([String(name || '').trim()].filter(Boolean)));
    return values.map((raw) => ({
        raw,
        normalized: normalizeText(raw),
        compact: compactText(raw),
        tokens: tokenize(raw),
    })).filter((entry) => {
        if (!entry.normalized && !entry.compact) return false;
        if (isGenericName(entry.normalized)) return false;
        return true;
    });
}

function keyEntry(raw, source) {
    const normalized = normalizeText(raw);
    const compact = compactText(raw);
    const tokens = tokenize(raw);
    if (!normalized && !compact) return null;
    // primary_name='Unknown' 在老数据里非常多，它参与匹配会导致任何 name='Unknown'
    // 的入站消息 score +900 → attachPhoneToCreator 把陌生号码 alias 到 Unknown creator。
    // 其它 source（keeper_username、joinbrands_name 等）不过滤。
    if (source === 'primary_name' && isGenericName(normalized)) return null;
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

    if (inflightByOperator.has(normalizedOperator)) {
        return inflightByOperator.get(normalizedOperator);
    }

    const promise = db.getDb().prepare(`
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
    `).all(normalizedOperator).then((rows) => {
        cacheByOperator.set(normalizedOperator, { loadedAt: Date.now(), rows });
        inflightByOperator.delete(normalizedOperator);
        return rows;
    }).catch((err) => {
        inflightByOperator.delete(normalizedOperator);
        throw err;
    });

    inflightByOperator.set(normalizedOperator, promise);
    return promise;
}

async function getCreatorById(id) {
    if (!id) return null;
    return await creatorCache.getCreator(db.getDb(), id, '*');
}

async function getCreatorByPhone(phone) {
    if (!phone) return null;
    return await creatorCache.getCreatorByPhone(db.getDb(), phone, '*');
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
    // 只有当新 name 是真实名字、且原 primary_name 是 generic（'Unknown' 等占位）时才更新 —
    // baileys fromMe=true 反射的消息 pushName 是本账号自己的名字，不应污染对方 creator；
    // 即使是 fromMe=false，新 pushName 跟旧 primary_name 不一致也多数是对方改名 / 机翻
    // 扰动，稳妥起见不动已经是真名的 primary_name。
    if (name && !isGenericName(name) && (!creator.primary_name || isGenericName(creator.primary_name))) {
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
    // generic 占位名（'Unknown' 等）不进 alias —— 否则会让后续任意陌生 'Unknown'
    // 来访者通过 name fuzzy match 串到这个 creator。
    if (name && !isGenericName(name)) {
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

        // LID/PN 关联场景（修 baileys LID 路由产生的双 record 问题）：
        // 入站 baileys 消息按 chat remoteJid 解出来的 chatId 可能是 LID（例如
        // +102659063283848，长 15 位、非真实手机号）。WA 服务端按 LID 路由消息，
        // 旧逻辑会自动建一个 source='wa' 的"幽灵 creator"（exactPhoneCreator
        // 命中），跟用户手动/CSV 录入的 PN-keyed creator（best 命中，name 高分匹配）
        // 形成两条 record，UI 看 PN creator 永远空。
        //
        // 修：当 exactPhoneCreator 是自动建档（source='wa'）而 best 是用户手动
        // 操作的 PN creator（manual/csv-import/keeper）且名字高分匹配时，把 LID
        // record 合并到 PN record（messages / aliases / 关联表全部搬移），LID
        // 自动写入 PN creator 的 wa_phone alias，下次同 LID 消息直接命中 PN。
        const isAutoLidLike = exactPhoneCreator.source === 'wa';
        const isManualBest = ['manual', 'csv-import', 'keeper'].includes(String(best.row.source || ''));
        if (isAutoLidLike && isManualBest && best.score >= 700) {
            const merged = await mergeDuplicateCreatorIntoCanonical({
                targetCreatorId: best.creatorId,
                sourceCreatorId: exactPhoneCreator.id,
                operator,
                reason: `lid_pn_merge:${best.reasons.join(',')}`,
                allowDistinctPhones: true,
            });
            cacheByOperator.delete(normalizeOperatorName(operator, operator || null));
            return {
                creatorId: best.creatorId,
                created: false,
                mergedDuplicate: merged.merged,
                sourceCreatorId: exactPhoneCreator.id,
                resolution: 'merged_lid_into_pn',
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
    if (normalizedOperator) {
        cacheByOperator.delete(normalizedOperator);
        inflightByOperator.delete(normalizedOperator);
    }
}

module.exports = {
    resolveCanonicalCreator,
    attachPhoneToCreator,
    invalidateOperatorCache,
    isGenericName,
    normalizeText,
    compactText,
};
