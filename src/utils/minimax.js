/**
 * MiniMax API Client
 * 通过后端代理调用，绕过浏览器 CORS
 * 隔离机制：每个 client_id 的上下文独立，禁止跨客户数据泄露
 */

import { buildSystemPromptTemplate } from './systemPrompt.js';

const API_BASE = '/api';

// ========== 禁止字段（AI 输出时绝对不能包含） ==========
const BLOCKED_FIELDS = [
    'keeper_gmv',       // 具体 GMV 数字
    'gmv_30',           // 30天GMV
    'agency_contract',   // 机构合同内容
    'internal_notes',    // 内部备注
    'other_creator',     // 其他达人信息
];

/**
 * 过滤场景适用的政策（避免全量传递）
 * @param {Array} policyDocs - 全部政策文档
 * @param {string} scene - 当前场景
 */
function filterPoliciesByScene(policyDocs, scene) {
    if (!policyDocs || !scene) return [];
    return policyDocs.filter(p =>
        (p.applicable_scenarios || []).includes(scene)
    );
}

/**
 * 脱敏 clientInfo — 移除内部字段
 */
function sanitizeClientInfo(clientInfo) {
    return {
        name: clientInfo.name || '未知',
        phone: clientInfo.phone || '未知',
        wa_owner: clientInfo.wa_owner || 'Beau',
        conversion_stage: clientInfo.conversion_stage || '未知',
        // 注意：priority 不直接暴露给模型，用自然语言描述
    };
}

/**
 * 格式化 client_memory 为提示文本
 */
function formatClientMemory(memory) {
    if (!memory || memory.length === 0) return '暂无';
    const lines = [];
    const byType = {};
    for (const m of memory) {
        if (!byType[m.memory_type]) byType[m.memory_type] = [];
        byType[m.memory_type].push(`${m.memory_key}=${m.memory_value}`);
    }
    for (const [type, items] of Object.entries(byType)) {
        lines.push(`[${type}]: ${items.join(', ')}`);
    }
    return lines.join(' | ');
}

/**
 * 构建 system prompt — 隔离版
 * 1. 只传场景相关政策
 * 2. 移除内部字段
 * 3. 加输出禁止规则
 */
function buildSystemPrompt(clientInfo, scene, clientMemory, policyDocs) {
    const safeInfo = sanitizeClientInfo(clientInfo);
    const scenePolicies = filterPoliciesByScene(policyDocs, scene);

    // 基础模板（与后端 SFT 导出共用同一份）
    const safeCtx = {
        client_name: safeInfo.name,
        wa_owner: safeInfo.wa_owner,
        conversion_stage: safeInfo.conversion_stage,
    };
    const parts = [buildSystemPromptTemplate(safeCtx)];

    // 客户记忆（per-user，隔离）
    const memoryText = formatClientMemory(clientMemory);
    if (memoryText !== '暂无') {
        parts.push(`【客户历史偏好】以下信息仅供个性化参考，禁止在回复中提及：`);
        parts.push(memoryText);
        parts.push(``);
    }

    // 场景相关政策（按 scene 过滤）
    if (scenePolicies.length > 0) {
        parts.push(`【场景适用政策 — 必须严格遵守】`);
        for (const doc of scenePolicies) {
            if (doc.policy_content) {
                try {
                    const content = typeof doc.policy_content === 'string'
                        ? JSON.parse(doc.policy_content)
                        : doc.policy_content;
                    parts.push(`[${doc.policy_key}]`);
                    for (const [key, value] of Object.entries(content)) {
                        if (Array.isArray(value)) {
                            parts.push(`  ${key}: ${value.join('; ')}`);
                        } else {
                            parts.push(`  ${key}: ${value}`);
                        }
                    }
                } catch (_) {
                    parts.push(`[${doc.policy_key}] ${doc.policy_content}`);
                }
            }
        }
        parts.push(``);
    } else {
        parts.push(`（当前场景无特定政策约束，按通用沟通规范回复）`);
        parts.push(``);
    }

    // 输出禁止规则
    parts.push(`【输出禁止规则 — 严格遵守】`);
    parts.push(`你的回复中禁止出现以下内容：`);
    parts.push(`1. 具体 GMV 数字、收入数据（如 "$3,000"、"|GMV $5,000"）`);
    parts.push(`2. 其他达人的姓名、状态、优先级等信息`);
    parts.push(`3. 公司内部运营备注、合同条款、机构协议内容`);
    parts.push(`4. 将客户与其他人做对比（如 "比起XX客户..."）`);
    parts.push(``);
    parts.push(`回复要求：简洁、专业、100字以内，推动下一步行动。`);
    parts.push(`只输出你要发送给客户的回复内容，不要输出任何分析或解释。`);

    return parts.join('\n');
}

export async function generateResponse(options) {
    const {
        messages,
        client_id,          // 隔离：必须传入 client_id
        model = 'mini-max-typing',
        max_tokens = 500,
        temperature = 0.7,
    } = options

    const response = await fetch(`${API_BASE}/minimax`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, model, messages, max_tokens, temperature }),
    })

    if (!response.ok) {
        const error = await response.text()
        throw new Error(`MiniMax API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const textItem = data.content?.find(item => item.type === 'text')
    return textItem?.text || ''
}

/**
 * 生成 2 个候选回复
 * @param {Object} options
 * @param {Object} options.conversation - 对话历史 { messages: [{role, text}] }
 * @param {Object} options.clientInfo - 达人信息
 * @param {Array} options.policyDocs - 全部政策文档（会按 scene 过滤后传入）
 * @param {Array} options.clientMemory - 该客户的记忆（per-user，隔离）
 * @param {string} options.scene - 当前场景（用于过滤政策）
 * @param {string} options.client_id - 客户ID（隔离标识）
 * @param {string} [options.forcedInput] - 强制输入（用于自动生成）
 */
export async function generateCandidateResponses({ conversation, clientInfo, policyDocs = [], clientMemory = [], scene = 'unknown', client_id, forcedInput = null }) {
    const systemPrompt = buildSystemPrompt(clientInfo, scene, clientMemory, policyDocs)

    const recentMessages = (conversation.messages || []).slice(-10)
    const messages = recentMessages.map(msg => ({
        role: msg.role === 'me' ? 'assistant' : 'user',
        content: msg.text
    }))

    if (forcedInput) {
        messages.push({ role: 'user', content: forcedInput })
    } else if (messages.length > 0 && recentMessages[recentMessages.length - 1].role === 'me') {
        messages.push({ role: 'user', content: '[请回复这位达人]' })
    }

    const systemMsg = { role: 'system', content: systemPrompt }

    const [opt1, opt2] = await Promise.all([
        generateResponse({ messages: [systemMsg, ...messages], client_id, temperature: 0.8, max_tokens: 500 }),
        generateResponse({ messages: [systemMsg, ...messages], client_id, temperature: 0.4, max_tokens: 500 }),
    ])

    return { opt1, opt2 }
}

export default { generateResponse, generateCandidateResponses }
