/**
 * Experience Router
 * 根据 client_id 或 operator 路由到对应 AI 体验
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');
const { extractAndSaveMemories } = require('../services/memoryExtractionService');
const { normalizeOperatorName } = require('../utils/operator');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Helper Functions ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function tryParseJson(val, fallback) {
    if (val ***REMOVED***= null || val ***REMOVED***= undefined) return fallback;
    if (typeof val ***REMOVED***= 'object') return val;
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

async function compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs) {
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
- 建联阶段: ${clientInfo.conversion_stage || '未知'}
`).trim();

    if (scene && sceneConfig[scene]) {
        prompt += '\n\n【场景适配】' + sceneConfig[scene];
    }

    if (clientMemory && clientMemory.length > 0) {
        const memoryText = formatClientMemory(clientMemory);
        prompt += '\n\n【客户历史偏好】以下信息仅供个性化参考：\n' + memoryText;
    }

    const scenePolicies = filterPoliciesByScene(policyDocs, scene);
    if (scenePolicies.length > 0) {
        prompt += '\n\n【场景适用政策 — 必须严格遵守】';
        for (const doc of scenePolicies) {
            if (doc.policy_content) {
                try {
                    const content = typeof doc.policy_content ***REMOVED***= 'string'
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
    if (!memory || memory.length ***REMOVED***= 0) return '暂无';
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

async function getOperatorByClientId(clientId) {
    const dbInstance = db.getDb();
    const creator = await dbInstance.prepare(
        'SELECT wa_owner FROM creators WHERE wa_phone = ?'
    ).get(clientId);
    return creator ? normalizeOperatorName(creator.wa_owner, creator.wa_owner) : null;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Routes ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

router.get('/operators', async (req, res) => {
    try {
        const operators = await getAllOperatorExperiences();
        res.json({ success: true, data: operators });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:operator', async (req, res) => {
    try {
        const { operator } = req.params;
        const normalizedOperator = normalizeOperatorName(operator, operator);
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
        const { operator } = req.params;
        const normalizedOperator = normalizeOperatorName(operator, operator);
        const dbInstance = db.getDb();
        const clients = await dbInstance.prepare(`
            SELECT
                c.id, c.primary_name, c.wa_phone, c.wa_owner, c.is_active, c.created_at,
                COUNT(wm.id) as msg_count, MAX(wm.timestamp) as last_active,
                wc.priority, wc.beta_status
            FROM creators c
            LEFT JOIN wa_messages wm ON wm.creator_id = c.id
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            WHERE LOWER(c.wa_owner) = LOWER(?)
            GROUP BY c.id
            ORDER BY last_active DESC
        `).all(normalizedOperator);
        res.json({ success: true, data: clients, count: clients.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/route', async (req, res) => {
    try {
        const { client_id, operator: directOperator, messages, scene = 'unknown',
            topicContext = '', richContext = '', conversationSummary = '' } = req.body;

        let operator = normalizeOperatorName(directOperator, directOperator);
        if (!operator && client_id) {
            operator = await getOperatorByClientId(client_id);
        }
        if (!operator) {
            return res.status(400).json({ success: false, error: 'Cannot determine operator: provide client_id or operator' });
        }

        const exp = await getOperatorExperience(operator);
        if (!exp) {
            return res.status(404).json({ success: false, error: `Operator ${operator} experience not found` });
        }

        const dbInstance = db.getDb();
        let clientInfo = { name: '未知', conversion_stage: '未知' };
        if (client_id) {
            const creator = await dbInstance.prepare(`
                SELECT c.primary_name as name, wc.beta_status as conversion_stage
                FROM creators c LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                WHERE c.wa_phone = ?
            `).get(client_id);
            if (creator) {
                clientInfo = { name: creator.name || '未知', conversion_stage: creator.conversion_stage || '未知' };
            }
        }

        let clientMemory = [];
        if (client_id) {
            clientMemory = await dbInstance.prepare('SELECT * FROM client_memory WHERE client_id = ?').all(client_id);
        }

        const policyDocsRows = await dbInstance.prepare(
            'SELECT * FROM policy_documents WHERE is_active = 1'
        ).all();
        const policyDocs = policyDocsRows.map(p => ({
            ...p,
            applicable_scenarios: tryParseJson(p.applicable_scenarios, [])
        }));

        const { prompt: systemPrompt, version } = await buildFullSystemPrompt(client_id, scene, messages,
            { operator, topicContext, richContext, conversationSummary, systemPromptVersion: 'v2' });

        const recentMessages = (messages || []).slice(-10);
        const formattedMessages = recentMessages.map(msg => ({
            role: msg.role ***REMOVED***= 'me' ? 'assistant' : 'user',
            content: msg.text
        }));

        if (formattedMessages.length > 0 && recentMessages[recentMessages.length - 1].role ***REMOVED***= 'me') {
            formattedMessages.push({ role: 'user', content: '[请回复这位达人]' });
        }

        const systemMsg = { role: 'system', content: systemPrompt };

        const API_KEY = process.env.MINIMAX_API_KEY;
        const API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/anthropic';

        async function generateResponse(messages, temperature) {
            const body = JSON.stringify({
                model: 'mini-max-typing',
                messages,
                max_tokens: 500,
                temperature,
            });
            const response = await fetch(`${API_BASE}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'x-api-key': API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(body),
                },
                body,
                signal: AbortSignal.timeout(60000),
            });

            const respText = await response.text();
            if (!response.ok) {
                throw new Error(`MiniMax API error: ${response.status}: ${respText.slice(0, 200)}`);
            }

            const data = JSON.parse(respText);
            const textItem = data.content?.find(item => item.type ***REMOVED***= 'text');
            return textItem?.text || '';
        }

        let opt1 = '', opt2 = '';
        try {
            opt1 = await generateResponse([systemMsg, ...formattedMessages], 0.8);
        } catch(e) {
            console.error('[route] opt1 failed:', e.message);
        }
        try {
            opt2 = await generateResponse([systemMsg, ...formattedMessages], 0.4);
        } catch(e) {
            console.error('[route] opt2 failed:', e.message);
        }

        // ***REMOVED***= client_memory 自动积累：AI 回复生成成功后异步提取记忆 ***REMOVED***=
        if (client_id && operator && recentMessages.length > 0) {
            setImmediate(() => {
                extractAndSaveMemories({
                    client_id,
                    owner: operator,
                    messages: recentMessages,
                    trigger_type: 'ai_generate',
                }).catch(e => console.error('[memoryExtraction] experience.js hook error:', e.message));
            });
        }

        if (!opt1 && !opt2) {
            return res.status(502).json({ success: false, error: 'AI 生成失败' });
        }
        res.json({
            success: true,
            operator,
            experience_config: {
                display_name: exp.display_name,
                description: exp.description,
                scene_config: (exp.scene_config && typeof exp.scene_config ***REMOVED***= 'object') ? exp.scene_config : {},
            },
            system_prompt: systemPrompt,
            version,
            candidates: { opt1, opt2 },
        });
    } catch (err) {
        console.error('Experience route error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:operator/system-prompt', async (req, res) => {
    try {
        const { operator } = req.params;
        const normalizedOperator = normalizeOperatorName(operator, operator);
        const { scene = 'unknown', client_id } = req.query;

        const dbInstance = db.getDb();

        let clientInfo = { name: '未知', conversion_stage: '未知' };
        if (client_id) {
            const creator = await dbInstance.prepare(`
                SELECT c.primary_name as name, wc.beta_status as conversion_stage
                FROM creators c LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                WHERE c.wa_phone = ?
            `).get(client_id);
            if (creator) {
                clientInfo = { name: creator.name || '未知', conversion_stage: creator.conversion_stage || '未知' };
            }
        }

        let clientMemory = [];
        if (client_id) {
            clientMemory = await dbInstance.prepare('SELECT * FROM client_memory WHERE client_id = ?').all(client_id);
        }

        const policyDocsRows = await dbInstance.prepare(
            'SELECT * FROM policy_documents WHERE is_active = 1'
        ).all();
        const policyDocs = policyDocsRows.map(p => ({
            ...p,
            applicable_scenarios: tryParseJson(p.applicable_scenarios, [])
        }));

        const { prompt: systemPrompt, version } = await buildFullSystemPrompt(client_id, scene, null,
            { operator: normalizedOperator, topicContext: '', richContext: '', conversationSummary: '', systemPromptVersion: 'v2' });

        res.json({ success: true, operator: normalizedOperator, scene, client_id, system_prompt: systemPrompt, version });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
