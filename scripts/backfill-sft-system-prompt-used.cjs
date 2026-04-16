#!/usr/bin/env node
/**
 * 回填历史 sft_memory.system_prompt_used
 *
 * 用法：
 *   node scripts/backfill-sft-system-prompt-used.cjs
 *   node scripts/backfill-sft-system-prompt-used.cjs --apply
 *   node scripts/backfill-sft-system-prompt-used.cjs --apply --owner=Beau --limit=200
 *   node scripts/backfill-sft-system-prompt-used.cjs --record-id=123
 */
require('dotenv').config();
const DB = require('../db');
const { buildFullSystemPrompt } = require('../systemPromptBuilder.cjs');

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function pickFirstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const normalized = value.trim();
        if (normalized) return normalized;
    }
    return '';
}

function parseArgs(argv = process.argv.slice(2)) {
    const ownerArg = argv.find((item) => item.startsWith('--owner='));
    const limitArg = argv.find((item) => item.startsWith('--limit='));
    const sinceArg = argv.find((item) => item.startsWith('--since='));
    const untilArg = argv.find((item) => item.startsWith('--until='));
    const recordIdArg = argv.find((item) => item.startsWith('--record-id='));
    const previewArg = argv.find((item) => item.startsWith('--preview='));

    return {
        apply: argv.includes('--apply'),
        owner: ownerArg ? ownerArg.split('=')[1] : null,
        limit: limitArg ? Math.max(parseInt(limitArg.split('=')[1], 10) || 0, 0) : 0,
        since: sinceArg ? sinceArg.split('=')[1] : null,
        until: untilArg ? untilArg.split('=')[1] : null,
        recordId: recordIdArg ? Math.max(parseInt(recordIdArg.split('=')[1], 10) || 0, 0) : 0,
        preview: previewArg ? Math.max(parseInt(previewArg.split('=')[1], 10) || 5, 1) : 5,
    };
}

function buildPromptOptions(row, context = {}) {
    const conversationSummary = pickFirstNonEmpty(
        context.conversationSummary,
        context.conversation_summary,
        context.conversation_summary_text,
        context.convSummary?.summary,
        context.conv_summary?.summary
    );

    return {
        topicContext: pickFirstNonEmpty(context.topicContext, context.topic_context),
        richContext: pickFirstNonEmpty(context.richContext, context.rich_context),
        conversationSummary,
        systemPromptVersion: pickFirstNonEmpty(
            row.system_prompt_version,
            context.system_prompt_version,
            'v2'
        ) || 'v2',
    };
}

function buildPromptInput(row) {
    const context = parseJsonSafe(row.context_json, {}) || {};
    const history = parseJsonSafe(row.message_history, []);
    return {
        clientId: pickFirstNonEmpty(row.client_id, context.client_id),
        scene: pickFirstNonEmpty(row.scene, context.scene, 'unknown') || 'unknown',
        history: Array.isArray(history) ? history : [],
        options: buildPromptOptions(row, context),
    };
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const db = DB.getDb();

    let where = `
        WHERE (sm.system_prompt_used IS NULL OR TRIM(sm.system_prompt_used) = '')
    `;
    const params = [];
    if (options.recordId > 0) {
        where += ' AND sm.id = ?';
        params.push(options.recordId);
    }
    if (options.owner) {
        where += ' AND c.wa_owner = ?';
        params.push(options.owner);
    }
    if (options.since) {
        where += ' AND sm.created_at >= ?';
        params.push(options.since);
    }
    if (options.until) {
        where += ' AND sm.created_at <= ?';
        params.push(options.until);
    }
    const limitSql = options.limit > 0 ? `LIMIT ${options.limit}` : '';

    const rows = await db.prepare(`
        SELECT
            sm.id,
            sm.scene,
            sm.system_prompt_version,
            sm.context_json,
            sm.message_history,
            sm.created_at,
            JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id')) AS client_id,
            c.wa_owner
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        ${where}
        ORDER BY sm.id ASC
        ${limitSql}
    `).all(...params);

    let rebuilt = 0;
    let skipped = 0;
    let failed = 0;
    const preview = [];

    for (const row of rows) {
        const promptInput = buildPromptInput(row);
        if (!promptInput.clientId) {
            skipped += 1;
            if (preview.length < options.preview) {
                preview.push({ id: row.id, status: 'skipped', reason: 'missing_client_id' });
            }
            continue;
        }

        try {
            const built = await buildFullSystemPrompt(
                promptInput.clientId,
                promptInput.scene,
                promptInput.history,
                promptInput.options
            );
            const prompt = String(built?.prompt || '').trim();
            if (!prompt) {
                skipped += 1;
                if (preview.length < options.preview) {
                    preview.push({ id: row.id, status: 'skipped', reason: 'empty_prompt' });
                }
                continue;
            }

            const version = pickFirstNonEmpty(built?.version, promptInput.options.systemPromptVersion, 'v2') || 'v2';
            if (options.apply) {
                const result = await db.prepare(`
                    UPDATE sft_memory
                    SET system_prompt_used = ?,
                        system_prompt_version = CASE
                            WHEN system_prompt_version IS NULL OR TRIM(system_prompt_version) = '' THEN ?
                            ELSE system_prompt_version
                        END
                    WHERE id = ?
                `).run(prompt, version, row.id);
                if (result.changes > 0) rebuilt += 1;
            } else {
                rebuilt += 1;
            }

            if (preview.length < options.preview) {
                preview.push({
                    id: row.id,
                    status: options.apply ? 'updated' : 'ready',
                    client_id: promptInput.clientId,
                    scene: promptInput.scene,
                    system_prompt_version: version,
                    prompt_preview: prompt.slice(0, 120),
                });
            }
        } catch (error) {
            failed += 1;
            if (preview.length < options.preview) {
                preview.push({ id: row.id, status: 'failed', reason: error.message });
            }
        }
    }

    console.log(JSON.stringify({
        mode: options.apply ? 'APPLY' : 'DRY_RUN',
        filters: {
            owner: options.owner,
            since: options.since,
            until: options.until,
            record_id: options.recordId || null,
            limit: options.limit || null,
        },
        scanned_rows: rows.length,
        rebuilt,
        skipped,
        failed,
        preview,
    }, null, 2));

    await DB.closeDb();
}

if (require.main === module) {
    main().catch(async (error) => {
        console.error('[backfill-sft-system-prompt-used] fatal:', error.message);
        await DB.closeDb();
        process.exit(1);
    });
}

module.exports = {
    main,
};
module.exports._private = {
    parseArgs,
    buildPromptInput,
    buildPromptOptions,
    parseJsonSafe,
    pickFirstNonEmpty,
};
