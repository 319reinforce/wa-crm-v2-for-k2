/**
 * Experience Router
 * 根据 client_id 或 operator 路由到对应 AI 体验
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');
const { generateReplyCandidates } = require('../services/replyGenerationService');
const { normalizeOperatorName } = require('../utils/operator');
const { evaluateCreatorLifecycle } = require('../services/lifecyclePersistenceService');
const { getLockedOwner } = require('../middleware/appAuth');
const {
    resolveRequestedOwnerScope,
    resolveClientAndOwnerScope,
} = require('../utils/ownerScope');
const { retrieveAndBuildLocalRules } = require('../services/localRuleRetrievalService');

// ========== Helper Functions ==========

function tryParseJson(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch (_) { return fallback; }
}

async function getOperatorExperience(operator) {
    const dbInstance = db.getDb();
    const normalizedOperator = normalizeOperatorName(operator, operator);
    const exp = await dbInstance.prepare(
        'SELECT * FROM operator_experiences WHERE operator = ? AND is_active = 1'
    ).get(normalizedOperator);
    return exp;
}

async function getAllOperatorExperiences() {
    const dbInstance = db.getDb();
    return await dbInstance.prepare(
        'SELECT operator, display_name, description, priority, is_active FROM operator_experiences WHERE is_active = 1 ORDER BY priority ASC'
    ).all();
}

async function compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs, userMessage = '') {
    const exp = await getOperatorExperience(operator);
    if (!exp) {
        throw new Error(`Operator ${operator} not found or inactive`);
    }

    const sceneConfig = tryParseJson(exp.scene_config, {});
    const forbiddenRules = tryParseJson(exp.forbidden_rules, []);

    let prompt = exp.system_prompt_base.replace('[BASE_PROMPT]', `
你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。

【重要】你只能看到当前这一个客户的对话和档案，禁止推测或提及其他客户信息。

当前客户档案（仅以下信息可用于生成回复）：
- 姓名: ${clientInfo.name || '未知'}
- 负责人: ${operator}
- 生命周期阶段: ${clientInfo.lifecycle_label || clientInfo.lifecycle_stage || '未知'}
- Beta 子流程: ${clientInfo.beta_status || '未知'}
`).trim();

    if (scene && sceneConfig[scene]) {
        prompt += '\n\n【场景适配】' + sceneConfig[scene];
    }

    if (clientMemory && clientMemory.length > 0) {
        const memoryText = formatClientMemory(clientMemory);
        prompt += '\n\n【客户历史偏好】以下信息仅供个性化参考：\n' + memoryText;
    }

    // 注入 Local Rules（新增）
    try {
        const localRulesResult = retrieveAndBuildLocalRules({
            scene,
            operator,
            userMessage,
            maxSources: 3
        });

        if (localRulesResult.text) {
            prompt += localRulesResult.text;
        }
    } catch (err) {
        console.error('[compileSystemPrompt] Local rules retrieval failed:', err.message);
        // 不阻断流程，继续使用旧的 policy_documents
    }

    const scenePolicies = filterPoliciesByScene(policyDocs, scene);
    if (scenePolicies.length > 0) {
        prompt += '\n\n【场景适用政策 — 必须严格遵守】';
        for (const doc of scenePolicies) {
            if (doc.policy_content) {
                try {
                    const content = typeof doc.policy_content === 'string'
                        ? JSON.parse(doc.policy_content)
                        : doc.policy_content;
                    prompt += '\n[' + doc.policy_key + ']';
                    for (const [key, value] of Object.entries(content)) {
                        if (Array.isArray(value)) {
                            prompt += '\n  ' + key + ': ' + value.join('; ');
                        } else {
                            prompt += '\n  ' + key + ': ' + value;
                        }
                    }
                } catch (_) {
                    prompt += '\n[' + doc.policy_key + '] ' + doc.policy_content;
                }
            }
        }
    }

    const baseForbidden = [
        '具体 GMV 数字、收入数据（如 "$3,000"、"|GMV $5,000"）',
        '其他达人的姓名、状态、优先级等信息',
        '公司内部运营备注、合同条款、机构协议内容',
        '将客户与其他人做对比（如 "比起XX客户..."）',
    ];
    const allForbidden = [...baseForbidden, ...forbiddenRules];

    prompt += '\n\n【输出禁止规则 — 严格遵守】\n你的回复中禁止出现以下内容：';
    allForbidden.forEach((rule, i) => {
        prompt += '\n' + (i + 1) + '. ' + rule;
    });

    prompt += '\n\n回复要求：简洁，专业、100字以内，推动下一步行动。';
    prompt += '\n只输出你要发送给客户的回复内容，不要输出任何分析或解释。';

    return prompt;
}

function formatClientMemory(memory) {
    if (!memory || memory.length === 0) return '暂无';
    const lines = [];
    const byType = {};
    for (const m of memory) {
        if (!byType[m.memory_type]) byType[m.memory_type] = [];
        byType[m.memory_type].push(m.memory_key + '=' + m.memory_value);
    }
    for (const [type, items] of Object.entries(byType)) {
        lines.push('[' + type + ']: ' + items.join(', '));
    }
    return lines.join('\n');
}

function filterPoliciesByScene(policyDocs, scene) {
    if (!policyDocs || !scene) return [];
    return policyDocs.filter(p =>
        (p.applicable_scenarios || []).includes(scene)
    );
}

async function resolveExperienceScope(req, res, dbConn, { clientId, operator } = {}) {
    return await resolveClientAndOwnerScope(req, res, dbConn, {
        clientId,
        requestedOwner: operator,
        ownerFieldName: 'operator',
        notFoundMessage: 'client not found',
    });
}

// ========== Routes ==========

router.get('/operators', async (req, res) => {
    try {
        const operators = await getAllOperatorExperiences();
        const lockedOwner = getLockedOwner(req);
        const filtered = lockedOwner
            ? operators.filter((item) => normalizeOperatorName(item.operator, item.operator) === lockedOwner)
            : operators;
        res.json({ success: true, data: filtered });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:operator', async (req, res) => {
    try {
        const ownerScope = resolveRequestedOwnerScope(req, res, req.params.operator, null);
        if (!ownerScope.ok) return;
        const normalizedOperator = ownerScope.owner;
        const exp = await getOperatorExperience(normalizedOperator);
        if (!exp) {
            return res.status(404).json({ success: false, error: `Operator ${normalizedOperator} not found` });
        }
        const result = {
            ...exp,
            scene_config: tryParseJson(exp.scene_config, {}),
            forbidden_rules: tryParseJson(exp.forbidden_rules, []),
        };
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:operator/clients', async (req, res) => {
    try {
        const ownerScope = resolveRequestedOwnerScope(req, res, req.params.operator, null);
        if (!ownerScope.ok) return;
        const normalizedOperator = ownerScope.owner;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const dbInstance = db.getDb();
        const clients = await dbInstance.prepare(`
            SELECT
                c.id, c.primary_name, c.wa_owner, c.is_active, c.created_at,
                COUNT(wm.id) as msg_count, MAX(wm.timestamp) as last_active,
                wc.priority, wc.beta_status
            FROM creators c
            LEFT JOIN wa_messages wm ON wm.creator_id = c.id
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            WHERE LOWER(c.wa_owner) = LOWER(?)
            GROUP BY c.id
            ORDER BY last_active DESC
            LIMIT ? OFFSET ?
        `).all(normalizedOperator, limit, offset);
        res.json({ success: true, data: clients, count: clients.length, limit, offset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/route', async (req, res) => {
    try {
        const { client_id, operator: directOperator, messages, scene = 'unknown',
            topicContext = '', richContext = '', conversationSummary = '' } = req.body;
        const result = await generateReplyCandidates({
            req,
            res,
            clientId: client_id,
            operator: directOperator,
            scene,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            messages: (messages || []).slice(-10),
            maxTokens: 500,
            temperature: [0.8, 0.4],
            routeName: 'experience-route',
            appendReplyPromptIfLastAssistant: true,
        });
        if (!result) return;

        if (!result.opt1 && !result.opt2) {
            return res.status(502).json({ success: false, error: 'AI 生成失败' });
        }

        const exp = result.operator ? await getOperatorExperience(result.operator).catch(() => null) : null;
        res.json({
            success: true,
            operator: result.operator,
            experience_config: exp ? {
                display_name: exp.display_name,
                description: exp.description,
                scene_config: tryParseJson(exp.scene_config, {}),
            } : null,
            system_prompt: result.systemPrompt,
            version: result.systemPromptVersion,
            candidates: { opt1: result.opt1, opt2: result.opt2 },
            provider: result.provider || null,
            model: result.model || null,
            retrieval_snapshot_id: result.retrievalSnapshotId || null,
            generation_log_id: result.generationLogId || null,
            operatorDisplayName: result.operatorDisplayName,
            operatorConfigured: result.operatorConfigured,
            scene: result.scene,
        });
    } catch (err) {
        console.error('Experience route error:', err);
        if (err.clientPayload) {
            return res.status(err.statusCode || 500).json({ success: false, ...err.clientPayload });
        }
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
});

router.get('/:operator/system-prompt', async (req, res) => {
    try {
        const { scene = 'unknown', client_id } = req.query;
        const dbInstance = db.getDb();
        const scope = await resolveExperienceScope(req, res, dbInstance, {
            clientId: client_id,
            operator: req.params.operator,
        });
        if (!scope.ok) return;
        const normalizedOperator = scope.owner;
        const scopedClientId = scope.clientScope.clientId || null;

        let clientInfo = { name: '未知', lifecycle_stage: '未知', lifecycle_label: '未知', beta_status: null };
        if (scopedClientId) {
            const creator = await dbInstance.prepare(`
                SELECT c.id, c.primary_name as name, wc.beta_status
                FROM creators c LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                WHERE c.wa_phone = ?
            `).get(scopedClientId);
            if (creator) {
                const lifecycleEval = await evaluateCreatorLifecycle(dbInstance, creator.id).catch(() => null);
                clientInfo = {
                    name: creator.name || '未知',
                    lifecycle_stage: lifecycleEval?.lifecycle?.stage_key || '未知',
                    lifecycle_label: lifecycleEval?.lifecycle?.stage_label || lifecycleEval?.lifecycle?.stage_key || '未知',
                    beta_status: creator.beta_status || null,
                };
            }
        }

        let clientMemory = [];
        if (scopedClientId) {
            clientMemory = await dbInstance.prepare('SELECT * FROM client_memory WHERE client_id = ?').all(scopedClientId);
        }

        const policyDocsRows = await dbInstance.prepare(
            'SELECT * FROM policy_documents WHERE is_active = 1'
        ).all();
        const policyDocs = policyDocsRows.map(p => ({
            ...p,
            applicable_scenarios: tryParseJson(p.applicable_scenarios, [])
        }));

        const { prompt: systemPrompt, version } = await buildFullSystemPrompt(scopedClientId, scene, null,
            { operator: normalizedOperator, topicContext: '', richContext: '', conversationSummary: '', systemPromptVersion: 'v2' });

        res.json({ success: true, operator: normalizedOperator, scene, client_id: scopedClientId, system_prompt: systemPrompt, version });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 新增：检索标准话术端点
router.post('/retrieve-template', async (req, res) => {
    try {
        const { client_id, operator, scene, user_message } = req.body;

        // 调用 localRuleRetrievalService 检索相关知识源
        const { retrieveLocalRules, loadSourceContent, extractTemplateFromSource } = require('../services/localRuleRetrievalService');

        const sources = retrieveLocalRules({
            scene,
            operator,
            userMessage: user_message || '',
            maxSources: 1 // 只取最匹配的一个
        });

        if (!sources || sources.length === 0) {
            return res.json({ template: null });
        }

        // 加载知识源内容
        const topSource = sources[0];
        const content = loadSourceContent(topSource);

        if (!content) {
            return res.json({ template: null });
        }

        // 提取纯话术文本
        const templateText = extractTemplateFromSource(content, topSource.id);

        if (!templateText) {
            return res.json({ template: null });
        }

        // 返回格式化的 template 对象
        res.json({
            template: {
                text: templateText,
                source: topSource.id,
                matchScore: topSource.score || 0
            }
        });

    } catch (err) {
        console.error('[retrieve-template] Error:', err);
        res.status(500).json({
            error: {
                code: 'RETRIEVAL_ERROR',
                message: '检索服务暂时不可用'
            }
        });
    }
});

module.exports = router;
module.exports._private = {
    resolveExperienceScope,
};
