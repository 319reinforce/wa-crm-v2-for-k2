/**
 * Memory Extraction Service — client_memory 自动积累
 *
 * 在 AI 回复生成、SFT 人工选择、事件创建三个触发点自动提取记忆写入 client_memory。
 *
 * 使用方法：
 *   const { extractAndSaveMemories } = require('./services/memoryExtractionService');
 *   await extractAndSaveMemories({ client_id, owner, messages, trigger_type });
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const db = require('../../db');

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    charset: 'utf8mb4',
    timezone: '+08:00',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
};

let _pool = null;
function getPool() {
    if (!_pool) _pool = mysql.createPool(MYSQL_CONFIG);
    return _pool;
}
const VERBOSE_LOGS = process.env.LOG_VERBOSE === 'true';

function maskClientId(clientId) {
    const value = String(clientId || '');
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 4) return `***${digits.slice(-4)}`;
    if (value.length > 4) return `***${value.slice(-4)}`;
    return '***';
}

// ========== LLM 调用（支持 OpenAI / MiniMax）==========

async function callLLMExtract(messages, owner, triggerType) {
    const USE_OPENAI = process.env.USE_OPENAI === 'true';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const MINIMAX_BASE = 'https://api.minimaxi.com/anthropic/v1';

    const systemPrompt = `You are a CRM memory extraction assistant. Your task is to analyze a WhatsApp conversation between a creator account manager (${owner}) and a creator (client), and extract notable facts, preferences, decisions, or style cues that should be remembered for future interactions.

Memory Types:
- preference: 客户表达的具体偏好（如：喜欢视频简短、不要发太多消息、喜欢中文回复）
- decision: 客户做出的决定（如：决定参加 beta program、决定签约 MCN、决定购买月费）
- style: 客户的沟通风格（如：喜欢问很多问题、回复简短、喜欢发语音）
- policy: 客户对政策的态度/理解（如：理解 20 天 beta 规则、理解月费扣除方式）

Rules:
1. Only extract facts that are EXPLICITLY stated or clearly implied in the conversation
2. Do NOT guess or infer beyond what is said
3. Each memory should be a single, specific fact (max 50 chars for key, 200 chars for value)
4. Confidence: 1 = 低置信（推测）, 2 = 中等置信（基本确认）, 3 = 高置信（明确表达）
5. Return an empty memories array if nothing notable is found
6. memory_key should be a short slug: "preference:reply_length", "decision:trial_signup", "style:uses_voice"

Response Format (return ONLY valid JSON, no markdown):
{
  "memories": [
    {
      "memory_type": "preference|decision|style|policy",
      "memory_key": "short_slug_description",
      "memory_value": "具体内容（200字以内）",
      "confidence": 1
    }
  ]
}`;

    const conversationText = messages.map(m => {
        const role = m.role === 'me' ? owner : 'Creator';
        const text = (m.text || '').replace(/"/g, "'");
        return `[${role}]: ${text}`;
    }).join('\n');

    const userPrompt = `Extract CRM memories from this conversation (most recent last):

${conversationText}

Trigger type: ${triggerType}`;

    let raw;
    if (USE_OPENAI) {
        const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                max_tokens: 1024,
                temperature: 0.2,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            throw new Error(`OpenAI API error ${response.status}`);
        }
        const data = await response.json();
        raw = data.choices?.[0]?.message?.content || '';
    } else {
        const response = await fetch(`${MINIMAX_BASE}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'mini-max-typing',
                max_tokens: 1024,
                temperature: 0.2,
                system_prompt: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            throw new Error(`MiniMax API error ${response.status}`);
        }
        const data = await response.json();
        raw = (data?.content && Array.isArray(data.content))
            ? (data.content.find(c => c.type === 'text')?.text || '')
            : (data?.choices?.[0]?.message?.content || '');
    }

    // 提取 JSON — 兼容 markdown code fence 和嵌套对象
    function extractJSON(text) {
        if (!text || !text.trim()) return null;

        // 策略1: 提取 ```json ... ``` 或 ``` ... ``` 包裹的 JSON
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            const candidate = codeBlockMatch[1].trim();
            try {
                return JSON.parse(candidate);
            } catch (_) {
                // 代码块内容解析失败，尝试策略2
            }
        }

        // 策略2: 从第一个 { 找到完整（平衡）的 }
        const firstBrace = text.indexOf('{');
        if (firstBrace === -1) return null;

        let depth = 0;
        let end = -1;
        for (let i = firstBrace; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }

        if (end === -1) return null;
        const candidate = text.slice(firstBrace, end + 1);
        try {
            return JSON.parse(candidate);
        } catch (_) {
            return null;
        }
    }

    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.memories)) {
        return [];
    }
    return parsed.memories;
}

// ========== 写入 client_memory（INSERT IGNORE + 可选 confidence 覆盖）==========

/**
 * upsertMemory — 写入单条记忆
 * @param {object} memory — { memory_type, memory_key, memory_value, confidence, source_record_id }
 * @param {string} clientId — wa_phone
 * @param {object} conn — MySQL connection (optional, uses db pool if not provided)
 * @param {boolean} overwriteOnHigherConfidence — 是否在 confidence 更高时覆盖（默认 false：完全静默跳过）
 * @returns {Promise<{inserted: boolean, duplicate: boolean, overwritten: boolean}>}
 */
async function upsertMemory(memory, clientId, _conn = null, overwriteOnHigherConfidence = false) {
    const { memory_type, memory_key, memory_value, confidence = 1, source_record_id = null } = memory;
    const pool = getPool();

    // 先查询是否存在
    const [existing] = await pool.execute(
        'SELECT id, confidence FROM client_memory WHERE client_id = ? AND memory_type = ? AND memory_key = ?',
        [clientId, memory_type, memory_key]
    );

    if (existing.length > 0) {
        const old = existing[0];
        if (overwriteOnHigherConfidence && confidence > old.confidence) {
            await pool.execute(
                'UPDATE client_memory SET memory_value = ?, confidence = ?, source_record_id = COALESCE(?, source_record_id), updated_at = NOW() WHERE id = ?',
                [memory_value, confidence, source_record_id, old.id]
            );
            return { inserted: false, duplicate: false, overwritten: true };
        }
        return { inserted: false, duplicate: true, overwritten: false };
    }

    await pool.execute(
        `INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value, confidence, source_record_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, memory_type, memory_key, memory_value, confidence, source_record_id]
    );
    return { inserted: true, duplicate: false, overwritten: false };
}

// ========== 核心入口函数 ==========

/**
 * extractAndSaveMemories — 从对话中提取记忆并写入 client_memory
 *
 * @param {object} params
 * @param {string} params.client_id  — wa_phone
 * @param {string} params.owner      — 'Beau' | 'Yiyun'
 * @param {Array}  params.messages   — 最近对话 [{role, text, timestamp}]
 * @param {string} params.trigger_type — 'ai_generate' | 'sft_select' | 'event_create'
 * @param {number} [params.source_record_id] — 关联记录 ID（如 sft_memory.id）
 * @returns {Promise<{extracted: number, inserted: number, skipped: number, errors: number}>}
 */
async function extractAndSaveMemories({ client_id, owner, messages, trigger_type, source_record_id = null }) {
    if (!client_id || !messages || messages.length === 0) {
        return { extracted: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    // 取最近 10 条消息用于提取
    const recentMessages = messages.slice(-10);

    let extractedMemories;
    try {
        extractedMemories = await callLLMExtract(recentMessages, owner, trigger_type);
    } catch (e) {
        console.error(`[memoryExtraction] LLM extraction failed for ${maskClientId(client_id)}: ${e.message}`);
        return { extracted: 0, inserted: 0, skipped: 0, errors: 1 };
    }

    if (!extractedMemories || extractedMemories.length === 0) {
        return { extracted: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    const stats = { extracted: extractedMemories.length, inserted: 0, skipped: 0, errors: 0 };

    for (const mem of extractedMemories) {
        try {
            const result = await upsertMemory(
                { ...mem, source_record_id },
                client_id
            );
            if (result.inserted) stats.inserted++;
            else stats.skipped++;
        } catch (e) {
            console.error(`[memoryExtraction] upsert failed: ${e.message}`);
            stats.errors++;
        }
    }

    if (stats.extracted > 0 && VERBOSE_LOGS) {
        console.log(`[memoryExtraction] ${maskClientId(client_id)} [${trigger_type}]: extracted=${stats.extracted} inserted=${stats.inserted} skipped=${stats.skipped}`);
    }
    return stats;
}

module.exports = {
    extractAndSaveMemories,
    upsertMemory,
    callLLMExtract,
};
