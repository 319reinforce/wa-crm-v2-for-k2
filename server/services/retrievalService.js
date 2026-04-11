/**
 * Retrieval service for prompt grounding.
 * Centralizes policy/memory/operator fetches so prompt building and logging use one shape.
 */
const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const { searchVectorStore } = require('../utils/openaiVectorStore');

function parseJsonSafe(value, fallback) {
    if (value ***REMOVED***= null || value ***REMOVED***= undefined) return fallback;
    if (typeof value ***REMOVED***= 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

async function getGroundingContext({ clientId = null, scene = 'unknown', operator = null, queryText = '' } = {}) {
    const db2 = db.getDb();
    let resolvedOperator = normalizeOperatorName(operator, null);
    let clientInfo = { name: '未知', conversion_stage: '未知', next_action: null };

    if (clientId) {
        const creator = await db2.prepare(`
            SELECT c.primary_name AS name, c.wa_owner, wc.beta_status AS conversion_stage, wc.next_action
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);
        if (creator) {
            if (!resolvedOperator) {
                resolvedOperator = normalizeOperatorName(creator.wa_owner, null);
            }
            clientInfo = {
                name: creator.name || '未知',
                conversion_stage: creator.conversion_stage || '未知',
                next_action: creator.next_action || null,
            };
        }
    }

    let experience = null;
    if (resolvedOperator) {
        experience = await db2.prepare(
            'SELECT * FROM operator_experiences WHERE operator = ? AND is_active = 1'
        ).get(resolvedOperator);
        if (experience) {
            experience.scene_config = parseJsonSafe(experience.scene_config, {});
            experience.forbidden_rules = parseJsonSafe(experience.forbidden_rules, []);
        }
    }

    let clientMemory = [];
    if (clientId) {
        clientMemory = await db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY confidence DESC, updated_at DESC'
        ).all(clientId);
    }

    const policyRows = await db2.prepare(
        'SELECT * FROM policy_documents WHERE is_active = 1 ORDER BY policy_key ASC'
    ).all();
    const policyDocs = policyRows.map((row) => ({
        ...row,
        applicable_scenarios: parseJsonSafe(row.applicable_scenarios, []),
    }));
    const scenePolicies = policyDocs.filter((doc) => (doc.applicable_scenarios || []).includes(scene));

    const OPENAI_RAG_ENABLED = process.env.OPENAI_RAG_ENABLED ***REMOVED***= 'true';
    const OPENAI_VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || '';
    const OPENAI_RAG_TOP_K = parseInt(process.env.OPENAI_RAG_TOP_K || '8', 10);

    let externalKnowledge = [];
    const fallbackQuery = [
        `scene:${scene || 'unknown'}`,
        clientInfo?.conversion_stage ? `stage:${clientInfo.conversion_stage}` : '',
        clientInfo?.next_action ? `next_action:${clientInfo.next_action}` : '',
        clientInfo?.name ? `client:${clientInfo.name}` : '',
    ].filter(Boolean).join('\n');

    const finalQuery = String(queryText || fallbackQuery).trim();
    if (OPENAI_RAG_ENABLED && OPENAI_VECTOR_STORE_ID && finalQuery) {
        try {
            const hits = await searchVectorStore({
                vectorStoreId: OPENAI_VECTOR_STORE_ID,
                query: finalQuery,
                topK: Number.isFinite(OPENAI_RAG_TOP_K) ? OPENAI_RAG_TOP_K : 8,
            });
            externalKnowledge = hits
                .filter((hit) => hit && hit.content)
                .slice(0, 8)
                .map((hit, idx) => ({
                    rank: idx + 1,
                    file_id: hit.file_id,
                    filename: hit.filename,
                    score: hit.score,
                    content: String(hit.content || '').slice(0, 1200),
                    attributes: hit.attributes || {},
                }));
        } catch (err) {
            console.warn('[retrievalService] openai rag search failed:', err.message);
        }
    }

    return {
        operator: resolvedOperator,
        clientInfo,
        experience,
        clientMemory,
        policyDocs,
        scenePolicies,
        externalKnowledge,
        grounding: {
            client: {
                id: clientId || null,
                name: clientInfo.name || null,
                conversion_stage: clientInfo.conversion_stage || null,
                next_action: clientInfo.next_action || null,
            },
            operator: {
                key: resolvedOperator || null,
                configured: !!experience,
                display_name: experience?.display_name || resolvedOperator || null,
            },
            scene: scene || 'unknown',
            policies: scenePolicies.map((doc) => ({
                policy_key: doc.policy_key,
                policy_version: doc.policy_version,
            })),
            memory: clientMemory.map((memory) => ({
                memory_type: memory.memory_type,
                memory_key: memory.memory_key,
                confidence: memory.confidence,
            })),
            rag: {
                enabled: OPENAI_RAG_ENABLED && !!OPENAI_VECTOR_STORE_ID,
                vector_store_id: OPENAI_VECTOR_STORE_ID || null,
                query: finalQuery || null,
                hit_count: externalKnowledge.length,
                hits: externalKnowledge.map((item) => ({
                    rank: item.rank,
                    file_id: item.file_id,
                    filename: item.filename,
                    score: item.score,
                    source_id: item.attributes?.source_id || null,
                    source_type: item.attributes?.type || null,
                })),
            },
        },
    };
}

module.exports = {
    getGroundingContext,
};
