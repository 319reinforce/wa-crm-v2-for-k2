/**
 * AI Provider Config Admin Routes
 * Prefix: /api/admin/ai-providers | /api/admin/ai-usage
 * All endpoints require human admin session.
 */
const express = require('express');
const router = express.Router();

const { writeAudit } = require('../middleware/audit');
const { requireHumanAdmin } = require('../middleware/appAuth');
const aiProviderConfigService = require('../services/aiProviderConfigService');

const { parseJsonSafe } = aiProviderConfigService;

// --- Middleware: enforce human admin on all routes ---
router.use(requireHumanAdmin);

// --- Helpers ---

function maskApiKey(key) {
    if (!key) return null;
    const s = String(key);
    return s.length > 6 ? `${s.slice(0, 6)}***` : `${s}***`;
}

function auditDetails(obj, exclude = []) {
    const clone = { ...obj };
    for (const k of exclude) delete clone[k];
    // serialize + truncate to avoid TEXT column overflow
    const json = JSON.stringify(clone);
    const MAX = 4000;
    return json.length > MAX ? JSON.stringify({ _truncated: true, raw: json.slice(0, MAX) }) : json;
}

function parseLimit(value, def = 50, max = 500) {
    const n = Math.max(0, Number(value) || def);
    return Math.min(n, max);
}

function parseRangeDays(range) {
    switch (String(range || '7d')) {
        case '30d': return 30;
        case '90d': return 90;
        default: return 7;
    }
}

// ==================== AI Providers CRUD ====================

// GET /api/admin/ai-providers[?purpose=<purpose>]
router.get('/ai-providers', async (req, res) => {
    try {
        const purpose = req.query.purpose || null;
        const rows = await aiProviderConfigService.listConfigs(purpose);
        res.json(rows.map((r) => ({
            id: r.id,
            purpose: r.purpose,
            name: r.name,
            model: r.model,
            base_url: r.base_url,
            api_key_preview: maskApiKey(r.api_key),
            extra_params: r.extra_params,
            is_active: r.is_active,
            notes: r.notes,
            created_by: r.created_by,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })));
    } catch (err) {
        console.error('GET /api/admin/ai-providers error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/ai-providers/:id
router.get('/ai-providers/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
        const row = await aiProviderConfigService.getConfigById(id);
        if (!row) return res.status(404).json({ error: 'config not found' });
        res.json(row);
    } catch (err) {
        console.error('GET /api/admin/ai-providers/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/ai-providers
router.post('/ai-providers', async (req, res) => {
    try {
        const { purpose, name, model, base_url, api_key, extra_params, notes, activate } = req.body || {};

        // purpose enum check
        if (!purpose || !aiProviderConfigService.PURPOSES.includes(purpose)) {
            return res.status(400).json({
                error: `invalid purpose (allowed: ${aiProviderConfigService.PURPOSES.join(', ')})`,
            });
        }
        // name non-empty
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        // base_url must be a valid URL
        if (!base_url) {
            return res.status(400).json({ error: 'base_url is required' });
        }
        try {
            new URL(String(base_url).trim());
        } catch (_) {
            return res.status(400).json({ error: 'base_url must be a valid URL' });
        }
        // api_key required
        if (!api_key) {
            return res.status(400).json({ error: 'api_key is required' });
        }

        const existing = await aiProviderConfigService.listConfigs(purpose);
        if (existing.some((r) => r.name === String(name).trim())) {
            return res.status(409).json({ error: `config with purpose="${purpose}" and name="${name}" already exists` });
        }

        const payload = {
            purpose,
            name: String(name).trim(),
            model: model || '',
            base_url: String(base_url).trim(),
            api_key: String(api_key).trim(),
            extra_params: extra_params || null,
            notes: notes || null,
            is_active: activate ? 1 : 0,
            created_by: req?.auth?.username || null,
        };

        const created = await aiProviderConfigService.upsertConfig(payload);

        await writeAudit(
            'ai_provider.create',
            'ai_provider_configs',
            String(created.id),
            null,
            { purpose, name, model },
            req,
        );

        res.status(201).json(created);
    } catch (err) {
        console.error('POST /api/admin/ai-providers error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/ai-providers/:id
router.put('/ai-providers/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid id' });

        const existing = await aiProviderConfigService.getConfigById(id);
        if (!existing) return res.status(404).json({ error: 'config not found' });

        const { name, model, base_url, api_key, extra_params, notes } = req.body || {};

        // base_url validation if provided
        if (base_url !== undefined) {
            try {
                new URL(String(base_url).trim());
            } catch (_) {
                return res.status(400).json({ error: 'base_url must be a valid URL' });
            }
        }

        // Build changed fields for audit
        const changed = {};
        if (name !== undefined) changed.name = name;
        if (model !== undefined) changed.model = model;
        if (base_url !== undefined) changed.base_url = base_url;
        if (notes !== undefined) changed.notes = notes;

        // Re-upsert with same (purpose, name) — purpose unchanged to protect UNIQUE constraint
        const updated = await aiProviderConfigService.upsertConfig({
            purpose: existing.purpose,
            name: name !== undefined ? String(name).trim() : existing.name,
            model: model !== undefined ? String(model).trim() : existing.model,
            base_url: base_url !== undefined ? String(base_url).trim() : existing.base_url,
            api_key: api_key !== undefined ? String(api_key).trim() : existing.api_key,
            extra_params: extra_params !== undefined ? extra_params : existing.extra_params,
            notes: notes !== undefined ? (notes || null) : existing.notes,
            is_active: existing.is_active,
            created_by: existing.created_by,
        });

        if (Object.keys(changed).length > 0) {
            await writeAudit(
                'ai_provider.update',
                'ai_provider_configs',
                String(id),
                null,
                { id, changed_fields: Object.keys(changed) },
                req,
            );
        }

        res.json(updated);
    } catch (err) {
        console.error('PUT /api/admin/ai-providers/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/ai-providers/:id/activate
router.post('/ai-providers/:id/activate', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid id' });

        const existing = await aiProviderConfigService.getConfigById(id);
        if (!existing) return res.status(404).json({ error: 'config not found' });

        await aiProviderConfigService.activateConfig(id);

        await writeAudit(
            'ai_provider.activate',
            'ai_provider_configs',
            String(id),
            null,
            { purpose: existing.purpose },
            req,
        );

        // Re-read to return fresh state
        const updated = await aiProviderConfigService.getConfigById(id);
        res.json({
            id: updated.id,
            purpose: updated.purpose,
            is_active: updated.is_active,
        });
    } catch (err) {
        console.error('POST /ai-providers/:id/activate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/ai-providers/:id
router.delete('/ai-providers/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid id' });

        const existing = await aiProviderConfigService.getConfigById(id);
        if (!existing) return res.status(404).json({ error: 'config not found' });

        // Guard: cannot delete the only active config for a purpose
        if (existing.is_active) {
            return res.status(409).json({
                error: `cannot delete only active config for purpose=${existing.purpose}`,
            });
        }

        await aiProviderConfigService.deleteConfig(id, { force: true });

        await writeAudit(
            'ai_provider.delete',
            'ai_provider_configs',
            String(id),
            null,
            { purpose: existing.purpose, name: existing.name },
            req,
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /ai-providers/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== AI Usage ====================

const db = require('../../db');

// GET /api/admin/ai-usage?range=7d|30d|90d&purpose=<optional>&groupBy=day|purpose
router.get('/ai-usage', async (req, res) => {
    try {
        const range = parseRangeDays(req.query.range);
        const purpose = req.query.purpose || null;
        const groupBy = req.query.groupBy === 'purpose' ? 'purpose' : 'day';

        const startDate = new Date(Date.now() - range * 24 * 60 * 60 * 1000);
        const y = startDate.getFullYear();
        const m = String(startDate.getMonth() + 1).padStart(2, '0');
        const d = String(startDate.getDate()).padStart(2, '0');
        const startStr = `${y}-${m}-${d}`;

        let rows = [];
        const db2 = db.getDb();

        if (groupBy === 'purpose') {
            const sql = `
                SELECT
                    purpose,
                    COALESCE(provider_config_id, 0) AS provider_config_id,
                    COALESCE(MAX(model), '') AS model,
                    SUM(request_count)        AS request_count,
                    SUM(tokens_prompt)         AS tokens_prompt,
                    SUM(tokens_completion)     AS tokens_completion,
                    SUM(tokens_total)          AS tokens_total,
                    SUM(error_count)           AS error_count,
                    SUM(total_latency_ms)      AS total_latency_ms
                FROM ai_usage_daily
                WHERE date >= ?
                  ${purpose ? ' AND purpose = ?' : ''}
                GROUP BY purpose, COALESCE(provider_config_id, 0)
                ORDER BY purpose ASC
            `;
            const params = purpose ? [startStr, purpose] : [startStr];
            rows = await db2.prepare(sql).all(...params);
        } else {
            const sql = `
                SELECT
                    date,
                    purpose,
                    COALESCE(provider_config_id, 0) AS provider_config_id,
                    COALESCE(model, '') AS model,
                    request_count,
                    tokens_prompt,
                    tokens_completion,
                    tokens_total,
                    error_count,
                    total_latency_ms
                FROM ai_usage_daily
                WHERE date >= ?
                  ${purpose ? ' AND purpose = ?' : ''}
                ORDER BY date ASC, purpose ASC
            `;
            const params = purpose ? [startStr, purpose] : [startStr];
            rows = await db2.prepare(sql).all(...params);
        }

        res.json(rows.map((r) => ({
            ...r,
            tokens_prompt: Number(r.tokens_prompt || 0),
            tokens_completion: Number(r.tokens_completion || 0),
            tokens_total: Number(r.tokens_total || 0),
            request_count: Number(r.request_count || 0),
            error_count: Number(r.error_count || 0),
            total_latency_ms: Number(r.total_latency_ms || 0),
        })));
    } catch (err) {
        console.error('GET /api/admin/ai-usage error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/ai-usage/recent?limit=50&purpose=<optional>
router.get('/ai-usage/recent', async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, 50, 500);
        const purpose = req.query.purpose || null;

        const db2 = db.getDb();
        const sql = purpose
            ? `SELECT id, provider_config_id, purpose, model,
                      tokens_prompt, tokens_completion, tokens_total,
                      latency_ms, status, source, created_at
               FROM ai_usage_logs
               WHERE purpose = ?
               ORDER BY created_at DESC
               LIMIT ?`
            : `SELECT id, provider_config_id, purpose, model,
                      tokens_prompt, tokens_completion, tokens_total,
                      latency_ms, status, source, created_at
               FROM ai_usage_logs
               ORDER BY created_at DESC
               LIMIT ?`;

        const params = purpose ? [purpose, limit] : [limit];
        const rows = await db2.prepare(sql).all(...params);

        res.json(rows.map((r) => ({
            id: r.id,
            provider_config_id: r.provider_config_id,
            purpose: r.purpose,
            model: r.model,
            tokens_total: Number(r.tokens_total || 0),
            latency_ms: r.latency_ms ? Number(r.latency_ms) : null,
            status: r.status,
            source: r.source,
            created_at: r.created_at,
        })));
    } catch (err) {
        console.error('GET /api/admin/ai-usage/recent error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;