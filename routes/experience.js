/**
 * Experience Router
 * 根据 client_id 或 operator 路由到对应 AI 体验
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// ========== Helper Functions ==========

/**
 * 获取 operator 体验配置
 */
function getOperatorExperience(operator) {
    const dbInstance = db.getDb();
    const exp = dbInstance.prepare(
        'SELECT * FROM operator_experiences WHERE operator = ? AND is_active = 1'
    ).get(operator);
    return exp;
}

/**
 * 获取所有活跃的 operator 体验
 */
function getAllOperatorExperiences() {
    const dbInstance = db.getDb();
    return dbInstance.prepare(
        'SELECT operator, display_name, description, priority, is_active FROM operator_experiences WHERE is_active = 1 ORDER BY priority ASC'
    ).all();
}

/**
 * 编译完整 system prompt
 */
function compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs) {
    const exp = getOperatorExperience(operator);
    if (!exp) {
        throw new Error(`Operator ${operator} not found or inactive`);
    }

    const sceneConfig = exp.scene_config ? JSON.parse(exp.scene_config) : {};
    const forbiddenRules = exp.forbidden_rules ? JSON.parse(exp.forbidden_rules) : [];

    // 基础 prompt
    let prompt = exp.system_prompt_base.replace('[BASE_PROMPT]', `
你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。

【重要】你只能看到当前这一个客户的对话和档案，禁止推测或提及其他客户信息。

当前客户档案（仅以下信息可用于生成回复）：
- 姓名: ${clientInfo.name || '未知'}
- 负责人: ${operator}
- 建联阶段: ${clientInfo.conversion_stage || '未知'}
`).trim();

    // 追加场景相关 prompt fragment
    if (scene && sceneConfig[scene]) {
        prompt += '\n\n【场景适配】' + sceneConfig[scene];
    }

    // 追加客户记忆
    if (clientMemory && clientMemory.length > 0) {
        const memoryText = formatClientMemory(clientMemory);
        prompt += '\n\n【客户历史偏好】以下信息仅供个性化参考：\n' + memoryText;
    }

    // 追加政策
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

    // 追加禁止规则
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

    prompt += '\n\n回复要求：简洁、专业、100字以内，推动下一步行动。';
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

/**
 * 根据 client_id 获取 operator
 */
function getOperatorByClientId(clientId) {
    const dbInstance = db.getDb();
    const creator = dbInstance.prepare(
        'SELECT wa_owner FROM creators WHERE wa_phone = ?'
    ).get(clientId);
    return creator ? creator.wa_owner : null;
}

// ========== Routes ==========

// GET /api/experience/operators - 列出所有 operator 体验
router.get('/operators', (req, res) => {
    try {
        const operators = getAllOperatorExperiences();
        res.json({ success: true, data: operators });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/experience/:operator - 获取单个 operator 完整体验
router.get('/:operator', (req, res) => {
    try {
        const { operator } = req.params;
        const exp = getOperatorExperience(operator);
        if (!exp) {
            return res.status(404).json({ success: false, error: `Operator ${operator} not found` });
        }

        // 解析 JSON 字段
        const result = {
            ...exp,
            scene_config: exp.scene_config ? JSON.parse(exp.scene_config) : {},
            forbidden_rules: exp.forbidden_rules ? JSON.parse(exp.forbidden_rules) : [],
        };

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/experience/:operator/clients - 获取该 operator 下的所有客户
router.get('/:operator/clients', (req, res) => {
    try {
        const { operator } = req.params;
        const dbInstance = db.getDb();
        const clients = dbInstance.prepare(`
            SELECT
                c.id,
                c.primary_name,
                c.wa_phone,
                c.wa_owner,
                c.is_active,
                c.created_at,
                COUNT(wm.id) as msg_count,
                MAX(wm.timestamp) as last_active,
                wc.priority,
                wc.beta_status
            FROM creators c
            LEFT JOIN wa_messages wm ON wm.creator_id = c.id
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            WHERE c.wa_owner = ?
            GROUP BY c.id
            ORDER BY last_active DESC
        `).all(operator);

        res.json({ success: true, data: clients, count: clients.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/experience/route - 核心路由：生成 AI 候选回复
router.post('/route', async (req, res) => {
    try {
        const { client_id, operator: directOperator, messages, scene = 'unknown' } = req.body;

        // 1. 确定 operator
        let operator = directOperator;
        if (!operator && client_id) {
            operator = getOperatorByClientId(client_id);
        }
        if (!operator) {
            return res.status(400).json({ success: false, error: 'Cannot determine operator: provide client_id or operator' });
        }

        // 2. 获取体验配置
        const exp = getOperatorExperience(operator);
        if (!exp) {
            return res.status(404).json({ success: false, error: `Operator ${operator} experience not found` });
        }

        // 3. 获取 client 信息
        const dbInstance = db.getDb();
        let clientInfo = { name: '未知', conversion_stage: '未知' };
        if (client_id) {
            const creator = dbInstance.prepare(`
                SELECT c.primary_name as name, wc.beta_status as conversion_stage
                FROM creators c
                LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                WHERE c.wa_phone = ?
            `).get(client_id);
            if (creator) {
                clientInfo = {
                    name: creator.name || '未知',
                    conversion_stage: creator.conversion_stage || '未知',
                };
            }
        }

        // 4. 获取客户记忆
        let clientMemory = [];
        if (client_id) {
            clientMemory = dbInstance.prepare(
                'SELECT * FROM client_memory WHERE client_id = ?'
            ).all(client_id);
        }

        // 5. 获取政策文档
        const policyDocs = dbInstance.prepare(
            'SELECT * FROM policy_documents WHERE is_active = 1'
        ).all().map(p => ({
            ...p,
            applicable_scenarios: p.applicable_scenarios ? JSON.parse(p.applicable_scenarios) : []
        }));

        // 6. 编译 system prompt
        const systemPrompt = compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs);

        // 7. 构建消息格式
        const recentMessages = (messages || []).slice(-10);
        const formattedMessages = recentMessages.map(msg => ({
            role: msg.role === 'me' ? 'assistant' : 'user',
            content: msg.text
        }));

        if (formattedMessages.length > 0 && recentMessages[recentMessages.length - 1].role === 'me') {
            formattedMessages.push({ role: 'user', content: '[请回复这位达人]' });
        }

        const systemMsg = { role: 'system', content: systemPrompt };

        // 8. 调用 MiniMax API 生成 2 个候选回复
        const API_KEY = process.env.MINIMAX_API_KEY || 'sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU';
        const API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/anthropic';

        async function generateResponse(messages, temperature) {
            const response = await fetch(`${API_BASE}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: 'mini-max-typing',
                    messages,
                    max_tokens: 500,
                    temperature,
                }),
            });

            if (!response.ok) {
                throw new Error(`MiniMax API error: ${response.status}`);
            }

            const data = await response.json();
            const textItem = data.content?.find(item => item.type === 'text');
            return textItem?.text || '';
        }

        const [opt1, opt2] = await Promise.all([
            generateResponse([systemMsg, ...formattedMessages], 0.8),
            generateResponse([systemMsg, ...formattedMessages], 0.4),
        ]);

        res.json({
            success: true,
            operator,
            experience_config: {
                display_name: exp.display_name,
                description: exp.description,
                scene_config: exp.scene_config ? JSON.parse(exp.scene_config) : {},
            },
            system_prompt: systemPrompt,
            candidates: { opt1, opt2 },
        });
    } catch (err) {
        console.error('Experience route error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/experience/:operator/system-prompt - 获取编译后的 system prompt（调试用）
router.get('/:operator/system-prompt', (req, res) => {
    try {
        const { operator } = req.params;
        const { scene = 'unknown', client_id } = req.query;

        const dbInstance = db.getDb();

        // 获取 client 信息
        let clientInfo = { name: '未知', conversion_stage: '未知' };
        if (client_id) {
            const creator = dbInstance.prepare(`
                SELECT c.primary_name as name, wc.beta_status as conversion_stage
                FROM creators c
                LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                WHERE c.wa_phone = ?
            `).get(client_id);
            if (creator) {
                clientInfo = {
                    name: creator.name || '未知',
                    conversion_stage: creator.conversion_stage || '未知',
                };
            }
        }

        // 获取客户记忆
        let clientMemory = [];
        if (client_id) {
            clientMemory = dbInstance.prepare(
                'SELECT * FROM client_memory WHERE client_id = ?'
            ).all(client_id);
        }

        // 获取政策文档
        const policyDocs = dbInstance.prepare(
            'SELECT * FROM policy_documents WHERE is_active = 1'
        ).all().map(p => ({
            ...p,
            applicable_scenarios: p.applicable_scenarios ? JSON.parse(p.applicable_scenarios) : []
        }));

        const systemPrompt = compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs);

        res.json({ success: true, operator, scene, client_id, system_prompt: systemPrompt });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
