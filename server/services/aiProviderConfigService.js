/**
 * aiProviderConfigService — Phase 0
 *
 * 职责:DB 中 ai_provider_configs 的读写 + 5 分钟内存缓存 + usage 记录/聚合。
 * 使用方:阶段 1 的 task-backend-wire 会让 openai.js 调 getActiveConfig(purpose),
 *        每次 LLM 请求末尾调 recordUsage(...)。本阶段仅完成地基,不改下游。
 *
 * 设计要点:
 *   - 缓存按 purpose key, TTL 5 分钟; 写操作(upsert/activate/delete)精准失效。
 *   - recordUsage 通过 setImmediate 放入下一 tick, 失败只 console.error,
 *     绝不 throw / 拖累调用方 —— 业务路径永远不能被 usage 写入拖垮。
 *   - activateConfig 在 service 层保障 "同 purpose 只有一行 is_active=1":
 *     先把同 purpose 其他行置 0, 再把目标行置 1 (依赖 MySQL 语句原子性,
 *     一次 purpose 切换只有几毫秒, 即便中间失败下游读 getActiveConfig
 *     也只会读到 0 条或 1 条, 不会误用旧配置)。
 *   - extra_params 列可能以 string 或 object 形式从 mysql2 返回, 统一 parseJsonSafe。
 */
const db = require('../../db');

const PURPOSES = [
    'reply-generation',
    'profile-analysis',
    'event-verification',
    'memory-extraction',
    'rag-vector',
    'generic-ai',
];

const CACHE_TTL_MS = 5 * 60 * 1000;

// purpose → { config, expireAt }
const cache = new Map();

function parseJsonSafe(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        purpose: row.purpose,
        name: row.name,
        model: row.model,
        base_url: row.base_url,
        api_key: row.api_key,
        extra_params: parseJsonSafe(row.extra_params, {}),
        is_active: row.is_active ? 1 : 0,
        notes: row.notes || null,
        created_by: row.created_by || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
    };
}

function assertPurpose(purpose) {
    if (!PURPOSES.includes(purpose)) {
        throw new Error(`invalid purpose: ${purpose} (allowed: ${PURPOSES.join(',')})`);
    }
}

function invalidateCache(purposeOrNull) {
    if (!purposeOrNull) {
        cache.clear();
        return;
    }
    cache.delete(purposeOrNull);
}

// ================== 读 ==================

async function getActiveConfig(purpose) {
    assertPurpose(purpose);
    const now = Date.now();
    const hit = cache.get(purpose);
    if (hit && hit.expireAt > now) return hit.config;

    const row = await db.getDb().prepare(
        'SELECT * FROM ai_provider_configs WHERE purpose = ? AND is_active = 1 LIMIT 1'
    ).get(purpose);
    const config = normalizeRow(row);
    cache.set(purpose, { config, expireAt: now + CACHE_TTL_MS });
    return config;
}

async function listConfigs(purposeOrNull) {
    if (purposeOrNull) assertPurpose(purposeOrNull);
    const sql = purposeOrNull
        ? 'SELECT * FROM ai_provider_configs WHERE purpose = ? ORDER BY is_active DESC, id DESC'
        : 'SELECT * FROM ai_provider_configs ORDER BY purpose ASC, is_active DESC, id DESC';
    const rows = purposeOrNull
        ? await db.getDb().prepare(sql).all(purposeOrNull)
        : await db.getDb().prepare(sql).all();
    return rows.map(normalizeRow);
}

async function getConfigById(id) {
    const row = await db.getDb().prepare(
        'SELECT * FROM ai_provider_configs WHERE id = ? LIMIT 1'
    ).get(id);
    return normalizeRow(row);
}

// ================== 写 ==================

/**
 * upsertConfig — 对 (purpose, name) UNIQUE 做 upsert
 * payload: { purpose, name, model, base_url, api_key, extra_params?, is_active?, notes?, created_by? }
 */
async function upsertConfig(payload = {}) {
    const {
        purpose,
        name,
        model,
        base_url: baseUrl,
        api_key: apiKey,
        extra_params: extraParams,
        is_active: isActive,
        notes,
        created_by: createdBy,
    } = payload;
    assertPurpose(purpose);
    if (!name || !model || !baseUrl || !apiKey) {
        throw new Error('upsertConfig: name / model / base_url / api_key are required');
    }
    const extraJson = extraParams === null || extraParams === undefined
        ? null
        : (typeof extraParams === 'string' ? extraParams : JSON.stringify(extraParams));
    const activeVal = isActive ? 1 : 0;

    await db.getDb().prepare(`
        INSERT INTO ai_provider_configs
            (purpose, name, model, base_url, api_key, extra_params, is_active, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            model = VALUES(model),
            base_url = VALUES(base_url),
            api_key = VALUES(api_key),
            extra_params = VALUES(extra_params),
            is_active = VALUES(is_active),
            notes = VALUES(notes)
    `).run(purpose, name, model, baseUrl, apiKey, extraJson, activeVal, notes || null, createdBy || null);

    const row = await db.getDb().prepare(
        'SELECT * FROM ai_provider_configs WHERE purpose = ? AND name = ? LIMIT 1'
    ).get(purpose, name);

    invalidateCache(purpose);
    return normalizeRow(row);
}

/**
 * activateConfig(id) — 同 purpose 其余行 is_active=0, 自己=1
 */
async function activateConfig(id) {
    const target = await db.getDb().prepare(
        'SELECT id, purpose FROM ai_provider_configs WHERE id = ? LIMIT 1'
    ).get(id);
    if (!target) throw new Error(`config id=${id} not found`);

    // 单 purpose 切换, 两次串行 UPDATE 即可 (db.js 的 transaction 语义虽可用,
    // 但 spec §5 允许串行写法, 简单即胜利)。
    await db.getDb().prepare(
        'UPDATE ai_provider_configs SET is_active = 0 WHERE purpose = ? AND id <> ?'
    ).run(target.purpose, id);
    await db.getDb().prepare(
        'UPDATE ai_provider_configs SET is_active = 1 WHERE id = ?'
    ).run(id);

    invalidateCache(target.purpose);
}

/**
 * deleteConfig(id, { force }) — 不允许删 is_active=1 的行, 除非 force=true
 */
async function deleteConfig(id, { force = false } = {}) {
    const row = await db.getDb().prepare(
        'SELECT id, purpose, is_active FROM ai_provider_configs WHERE id = ? LIMIT 1'
    ).get(id);
    if (!row) return;
    if (row.is_active && !force) {
        throw new Error(`config id=${id} is active; pass { force: true } to delete`);
    }
    await db.getDb().prepare('DELETE FROM ai_provider_configs WHERE id = ?').run(id);
    invalidateCache(row.purpose);
}

// ================== Usage ==================

/**
 * recordUsage — fire-and-forget, 绝不阻塞调用方
 * data: { provider_config_id?, purpose, model, tokens_prompt?, tokens_completion?,
 *         tokens_total?, latency_ms?, status?, error_message?, source?, creator_id? }
 */
function recordUsage(data = {}) {
    setImmediate(async () => {
        try {
            if (!data.purpose || !data.model) {
                console.error('[aiUsage] missing purpose/model in recordUsage payload', data);
                return;
            }
            await db.getDb().prepare(`
                INSERT INTO ai_usage_logs
                    (provider_config_id, purpose, model,
                     tokens_prompt, tokens_completion, tokens_total,
                     latency_ms, status, error_message, source, creator_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.provider_config_id ?? null,
                data.purpose,
                data.model,
                Number(data.tokens_prompt || 0),
                Number(data.tokens_completion || 0),
                Number(data.tokens_total || 0),
                data.latency_ms ?? null,
                data.status || 'ok',
                data.error_message || null,
                data.source || null,
                data.creator_id ?? null,
            );
        } catch (err) {
            console.error('[aiUsage] recordUsage failed:', err.message);
        }
    });
}

/**
 * rollupDaily(dateString?) — 把指定日期的 ai_usage_logs 聚合到 ai_usage_daily
 * dateString: 'YYYY-MM-DD', 省略时为昨天
 * 返回: { rows_upserted }
 */
async function rollupDaily(dateString) {
    const date = dateString || defaultYesterday();
    const result = await db.getDb().prepare(`
        INSERT INTO ai_usage_daily
            (date, purpose, provider_config_id, model,
             request_count, tokens_prompt, tokens_completion, tokens_total,
             error_count, total_latency_ms)
        SELECT
            DATE(created_at)                            AS date,
            purpose,
            COALESCE(provider_config_id, 0)             AS provider_config_id,
            COALESCE(MAX(model), '')                    AS model,
            COUNT(*)                                    AS request_count,
            SUM(tokens_prompt)                          AS tokens_prompt,
            SUM(tokens_completion)                      AS tokens_completion,
            SUM(tokens_total)                           AS tokens_total,
            SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS error_count,
            SUM(COALESCE(latency_ms, 0))                AS total_latency_ms
          FROM ai_usage_logs
         WHERE DATE(created_at) = ?
         GROUP BY DATE(created_at), purpose, COALESCE(provider_config_id, 0)
        ON DUPLICATE KEY UPDATE
            model             = VALUES(model),
            request_count     = VALUES(request_count),
            tokens_prompt     = VALUES(tokens_prompt),
            tokens_completion = VALUES(tokens_completion),
            tokens_total      = VALUES(tokens_total),
            error_count       = VALUES(error_count),
            total_latency_ms  = VALUES(total_latency_ms)
    `).run(date);
    return { rows_upserted: result.changes || 0 };
}

function defaultYesterday() {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

module.exports = {
    PURPOSES,
    parseJsonSafe,
    getActiveConfig,
    listConfigs,
    getConfigById,
    upsertConfig,
    activateConfig,
    deleteConfig,
    recordUsage,
    rollupDaily,
    invalidateCache,
};
