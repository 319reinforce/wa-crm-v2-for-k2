/**
 * 从历史对话回填 SFT 数据（MySQL 版本）
 *
 * 用法：
 *   node scripts/generate-sft-from-history.cjs
 *   node scripts/generate-sft-from-history.cjs --dry-run
 *   node scripts/generate-sft-from-history.cjs --creator=123
 */
require('dotenv').config();
const crypto = require('crypto');
const db = require('../db');
const { buildFullSystemPrompt } = require('../systemPromptBuilder.cjs');
const { generateCandidates: generateOpenAICandidates } = require('../src/utils/openai');

const API_KEY = process.env.MINIMAX_API_KEY;
const API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/anthropic';
const USE_OPENAI = process.env.USE_OPENAI ***REMOVED***= 'true';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const creatorArg = args.find((item) => item.startsWith('--creator='));
const targetCreatorId = creatorArg ? parseInt(creatorArg.split('=')[1], 10) : null;
const maxPairsArg = args.find((item) => item.startsWith('--max-pairs='));
const maxPairs = maxPairsArg ? Math.max(parseInt(maxPairsArg.split('=')[1], 10) || 0, 0) : 0;

if (!USE_OPENAI && !API_KEY) {
    console.error('[generate-sft-from-history] MINIMAX_API_KEY is required');
    process.exit(1);
}

function sha256(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function isQualityHumanReply(text) {
    if (!text || typeof text !***REMOVED*** 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/u.test(trimmed)) return false;
    if (/^[.,!?，。！？、:;：；\-_+=*#\s]+$/.test(trimmed)) return false;
    return true;
}

function inferScene(text, betaStatus, messageCount = 0) {
    if (!text) return 'unknown';
    const lowerText = text.toLowerCase();
    if (/\b(trial|7[\s-]?day|7day|free\s*try|试用)\b/.test(lowerText)) return 'trial_intro';
    if (/\b(monthly|month|membership|月费|包月)\b/.test(lowerText)) return 'monthly_inquiry';
    if (/\b(commission|分成|提成|revenue|佣金|收入)\b/.test(lowerText)) return 'commission_query';
    if (/\b(mcn|agency|经纪|代理|绑定|contract|签约)\b/.test(lowerText)) return 'mcn_binding';
    if (/\b(video\s*(not|doesn'?t|can'?t|didn)?t?\s*(load|generat|creat|show|appear)|视频\s*(生成|加载|显示|出现)?(不了|失败|慢|卡)|内容\s*(不符|不对|错误))\b/.test(lowerText)) return 'video_not_loading';
    if (/\b(video|内容|content|创作|post|发帖|发布)\b/.test(lowerText) && !/\bnot\s*(load|generat|creat)\b/.test(lowerText)) return 'content_request';
    if (/\b(gmv|sales|订单|销售|收入|earnings)\b/.test(lowerText)) return 'gmv_inquiry';
    if (/\b(payment|paypal|付款|收款|转账|汇款|没收到|没到账)\b/.test(lowerText)) return 'payment_issue';
    if (/\b(violation|appeal|申诉|违规|flagged|strike|封号|banned|suspended)\b/.test(lowerText)) return 'violation_appeal';
    if (betaStatus ***REMOVED***= 'introduced' && messageCount > 3) return 'follow_up';
    return messageCount <= 1 ? 'first_contact' : 'follow_up';
}

async function generateResponse(messages, temperature) {
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Authorization': `Bearer ${API_KEY}`,
        'anthropic-version': '2023-06-01',
    };
    const response = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: 'mini-max-typing',
            messages,
            max_tokens: 500,
            temperature,
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`MiniMax API error: ${response.status} - ${error.slice(0, 180)}`);
    }

    const data = await response.json();
    return data.content?.find((item) => item.type ***REMOVED***= 'text')?.text || '';
}

async function generateCandidates(systemPrompt, conversationMsgs) {
    const messages = conversationMsgs.map((item) => ({
        role: item.role ***REMOVED***= 'me' ? 'assistant' : 'user',
        content: item.text,
    }));
    if (messages.length > 0 && messages[messages.length - 1].role ***REMOVED***= 'assistant') {
        messages.push({ role: 'user', content: '[请回复这位达人]' });
    }
    if (USE_OPENAI) {
        return generateOpenAICandidates(systemPrompt, messages, [0.8, 0.4]);
    }
    const allMessages = [{ role: 'system', content: systemPrompt }, ...messages];
    const [opt1, opt2] = await Promise.all([generateResponse(allMessages, 0.8), generateResponse(allMessages, 0.4)]);
    return { opt1, opt2 };
}

async function main() {
    const db2 = db.getDb();
    console.log('[generate-sft-from-history] start');
    if (DRY_RUN) console.log('[generate-sft-from-history] dry-run mode');
    if (USE_OPENAI) console.log('[generate-sft-from-history] provider=openai');
    else console.log('[generate-sft-from-history] provider=minimax');

    const sftColumnRows = await db2.prepare(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sft_memory'
    `).all();
    const sftColumns = new Set(sftColumnRows.map((row) => row.COLUMN_NAME));

    const creatorsSql = `
        SELECT
            c.id,
            c.primary_name AS name,
            c.wa_phone AS phone,
            c.wa_owner,
            wc.beta_status,
            wc.priority,
            COUNT(wm.id) AS msg_count
        FROM creators c
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        WHERE (? IS NULL OR c.id = ?)
        GROUP BY c.id
        HAVING msg_count > 0
        ORDER BY msg_count DESC
    `;
    const creators = await db2.prepare(creatorsSql).all(targetCreatorId, targetCreatorId);
    console.log(`[generate-sft-from-history] creators with messages: ${creators.length}`);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const creator of creators) {
        const messages = await db2.prepare(
            'SELECT id, role, text, timestamp FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
        ).all(creator.id);
        if (!messages.length) continue;

        const existingRows = await db2.prepare(`
            SELECT JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.user_timestamp')) AS uts
            FROM sft_memory
            WHERE JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.history_source')) = 'wa_messages'
              AND JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.client_id')) = ?
        `).all(creator.phone);
        const existingTimestamps = new Set(existingRows.map((row) => String(row.uts)));

        const pairs = [];
        for (let index = 0; index < messages.length - 1; index++) {
            if (messages[index].role ***REMOVED***= 'user' && messages[index + 1].role ***REMOVED***= 'me') {
                pairs.push({ userMsg: messages[index], humanReply: messages[index + 1] });
            }
        }

        let pendingPairs = pairs.filter((pair) => !existingTimestamps.has(String(pair.userMsg.timestamp)));
        if (maxPairs > 0) {
            pendingPairs = pendingPairs.slice(0, maxPairs);
        }
        if (!pendingPairs.length) {
            skipped += pairs.length;
            console.log(`[generate-sft-from-history] creator#${creator.id} no pending pairs`);
            continue;
        }

        console.log(`[generate-sft-from-history] creator#${creator.id} pending ${pendingPairs.length}/${pairs.length}`);
        for (let index = 0; index < pendingPairs.length; index++) {
            const { userMsg, humanReply } = pendingPairs[index];
            if (!isQualityHumanReply(humanReply.text)) {
                skipped++;
                continue;
            }

            const userIndex = messages.findIndex((item) => item.id ***REMOVED***= userMsg.id);
            const conversationMsgs = messages.slice(Math.max(0, userIndex - 9), userIndex + 1);
            const scene = inferScene(userMsg.text, creator.beta_status, creator.msg_count);

            try {
                const { prompt, version } = await buildFullSystemPrompt(creator.phone, scene, conversationMsgs, {
                    topicContext: '',
                    richContext: '',
                    conversationSummary: '',
                    systemPromptVersion: 'v2',
                });
                const { opt1, opt2 } = await generateCandidates(prompt, conversationMsgs);
                const now = new Date();
                const createdDate = now.toISOString().slice(0, 10);
                const contextJson = JSON.stringify({
                    history_source: 'wa_messages',
                    client_id: creator.phone,
                    client_name: creator.name,
                    wa_owner: creator.wa_owner,
                    beta_status: creator.beta_status || 'unknown',
                    priority: creator.priority || 'normal',
                    conversion_stage: creator.beta_status || 'unknown',
                    scene,
                    user_timestamp: userMsg.timestamp,
                    human_reply_timestamp: humanReply.timestamp,
                    input_text: userMsg.text,
                    is_retroactive: true,
                });

                if (!DRY_RUN) {
                    const candidateRecord = {
                        model_opt1: opt1 || null,
                        model_opt2: opt2 || null,
                        human_selected: 'custom',
                        human_output: humanReply.text,
                        model_predicted: null,
                        model_rejected: null,
                        is_custom_input: 1,
                        human_reason: '历史对话回填：人工回复作为训练标签，待运营审核',
                        context_json: contextJson,
                        status: 'pending_review',
                        reviewed_by: 'history_backfill',
                        similarity: null,
                        scene,
                        message_history: JSON.stringify(conversationMsgs.slice(-10)),
                        client_id_hash: sha256(creator.phone),
                        input_text_hash: sha256(userMsg.text || ''),
                        human_output_hash: sha256(humanReply.text || ''),
                        created_date: createdDate,
                        chosen_output: humanReply.text,
                        rejected_output: opt1 || null,
                        system_prompt_used: prompt || null,
                        system_prompt_version: version || 'v2',
                    };

                    const insertColumns = Object.keys(candidateRecord).filter((column) => sftColumns.has(column));
                    const placeholders = insertColumns.map(() => '?').join(', ');
                    const values = insertColumns.map((column) => candidateRecord[column]);
                    await db2.prepare(`
                        INSERT INTO sft_memory (${insertColumns.join(', ')})
                        VALUES (${placeholders})
                    `).run(...values);
                }

                inserted++;
                process.stdout.write(`  [creator#${creator.id}] ${index + 1}/${pendingPairs.length} inserted\n`);
                await new Promise((resolve) => setTimeout(resolve, 400));
            } catch (err) {
                errors++;
                process.stdout.write(`  [creator#${creator.id}] ${index + 1}/${pendingPairs.length} error: ${err.message}\n`);
            }
        }
    }

    console.log('[generate-sft-from-history] done');
    console.log(`[generate-sft-from-history] inserted=${inserted} skipped=${skipped} errors=${errors}`);
    await db.closeDb();
}

main().catch(async (err) => {
    console.error('[generate-sft-from-history] fatal:', err.message);
    await db.closeDb();
    process.exit(1);
});
