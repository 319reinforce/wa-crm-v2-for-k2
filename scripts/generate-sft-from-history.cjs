/**
 * 从历史对话生成 SFT 语料
 *
 * 原理：
 * - data/*.json 中有历史对话 (role=me/user)
 * - 对于每个 (user message → me reply) 对，使用 MiniMax API 生成 opt1/opt2 候选
 * - 写入 sft_memory，human_output = 实际运营回复，model_opt1/opt2 = AI 候选
 *
 * 用法：node scripts/generate-sft-from-history.cjs
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'crm.db');
const API_KEY = process.env.MINIMAX_API_KEY;
const API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/anthropic';

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 质量过滤 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

/**
 * 质量过滤：human_reply 至少要有实际内容才能作为 SFT 标签
 */
function isQualityHumanReply(text) {
    if (!text || typeof text !***REMOVED*** 'string') return false;
    const trimmed = text.trim();
    // 过滤空消息、过短消息
    if (trimmed.length < 3) return false;
    // 过滤纯 emoji
    if (/^[🔶✅❌👍👎💬📋✅✨🎉🙏👍👏]+$/.test(trimmed)) return false;
    // 过滤纯符号
    if (/^[.,!?。，！?、：:;；\-—_=+*#]+$/.test(trimmed)) return false;
    return true;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** MiniMax API ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function generateCandidateResponses(conversation, clientInfo, policyDocs = []) {
    const systemPrompt = buildSystemPrompt(clientInfo, policyDocs);

    const recentMessages = (conversation.messages || []).slice(-10);
    const messages = recentMessages.map(msg => ({
        role: msg.role ***REMOVED***= 'me' ? 'assistant' : 'user',
        content: msg.text
    }));

    if (messages.length > 0 && recentMessages[recentMessages.length - 1].role ***REMOVED***= 'me') {
        messages.push({ role: 'user', content: '[请回复这位达人]' });
    }

    const systemMsg = { role: 'system', content: systemPrompt };

    const [opt1, opt2] = await Promise.all([
        generateResponse([systemMsg, ...messages], 0.8),
        generateResponse([systemMsg, ...messages], 0.4),
    ]);

    return { opt1, opt2 };
}

async function generateResponse(messages, temperature = 0.7) {
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
        const error = await response.text();
        throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const textItem = data.content?.find(item => item.type ***REMOVED***= 'text');
    return textItem?.text || '';
}

function buildSystemPrompt(clientInfo, policyDocs) {
    const parts = [
        `你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。`,
        ``,
        `当前达人信息：`,
        `- 姓名: ${clientInfo.name || '未知'}`,
        `- 电话: ${clientInfo.phone || '未知'}`,
        `- 负责人: ${clientInfo.wa_owner || 'Beau'}`,
        `- 建联阶段: ${clientInfo.conversion_stage || '未知'}`,
        `- 优先级: ${clientInfo.priority || 'normal'}`,
        `- 消息数: ${clientInfo.msg_count || 0}`,
        ``,
    ];

    if (policyDocs.length > 0) {
        parts.push(`政策约束（必须遵守）：`);
        for (const doc of policyDocs) {
            if (doc.policy_content) {
                try {
                    const content = typeof doc.policy_content ***REMOVED***= 'string'
                        ? JSON.parse(doc.policy_content)
                        : doc.policy_content;
                    parts.push(`【${doc.policy_key} ${doc.policy_version}】`);
                    for (const [key, value] of Object.entries(content)) {
                        if (Array.isArray(value)) {
                            parts.push(`  ${key}: ${value.join('; ')}`);
                        } else {
                            parts.push(`  ${key}: ${value}`);
                        }
                    }
                } catch (_) {
                    parts.push(`【${doc.policy_key}】${doc.policy_content}`);
                }
            }
        }
        parts.push(``);
    }

    parts.push(`请用简洁、专业的语气回复达人。回复应该是简短的（100字以内），友好的，并且能推动下一步行动。`);
    return parts.join('\n');
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Scene inference ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function inferScene(text, betaStatus, messageCount = 0) {
    if (!text) return 'unknown';
    const t = text.toLowerCase();
    if (/\b(trial|7[\s-]?day|7day|free\s*try|试用)\b/.test(t)) return 'trial_intro';
    if (/\b(monthly|month|membership|月费|包月)\b/.test(t)) return 'monthly_inquiry';
    if (/\b(commission|分成|提成|revenue|佣金|收入)\b/.test(t)) return 'commission_query';
    if (/\b(mcn|agency|经纪|代理|绑定|contract|签约)\b/.test(t)) return 'mcn_binding';
    if (/\b(video\s*(not|doesn'?t|can'?t|didn)?t?\s*(load|generat|creat|show|appear)|视频\s*(生成|加载|显示|出现)?(不了|失败|慢|卡)|内容\s*(不符|不对|错误))\b/.test(t)) return 'video_not_loading';
    if (/\b(video|内容|content|创作|post|发帖|发布)\b/.test(t) && !/\bnot\s*(load|generat|creat)\b/.test(t)) return 'content_request';
    if (/\b(gmv|sales|订单|销售|收入|earnings)\b/.test(t)) return 'gmv_inquiry';
    if (/\b(payment|paypal|付款|收款|转账|汇款|没收到|没到账)\b/.test(t)) return 'payment_issue';
    if (/\b(violation|appeal|申诉|违规|flagged|strike|封号|banned|suspended)\b/.test(t)) return 'violation_appeal';
    if (betaStatus ***REMOVED***= 'introduced' && messageCount > 3) return 'follow_up';
    return messageCount <= 1 ? 'first_contact' : 'follow_up';
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Main ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function main() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    console.log('🔍 读取历史对话...\n');

    // 读取所有有消息的达人
    const creators = db.prepare(`
        SELECT
            c.id,
            c.primary_name as name,
            c.wa_phone as phone,
            c.wa_owner,
            wc.beta_status,
            wc.priority,
            COUNT(wm.id) as msg_count
        FROM creators c
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        GROUP BY c.id
        HAVING msg_count > 0
        ORDER BY msg_count DESC
    `).all();

    // 读取政策文档
    const policyDocs = db.prepare('SELECT * FROM policy_documents WHERE is_active = 1').all()
        .map(p => ({
            ...p,
            applicable_scenarios: p.applicable_scenarios ? JSON.parse(p.applicable_scenarios) : []
        }));

    console.log(`📊 找到 ${creators.length} 个有消息的达人\n`);

    let totalRecords = 0;
    let skipped = 0;
    let errors = 0;

    for (const creator of creators) {
        // 读取该达人的消息
        const messages = db.prepare(
            'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
        ).all(creator.id);

        // 提取 (user → me) 对话片段
        const pairs = [];
        for (let i = 0; i < messages.length - 1; i++) {
            if (messages[i].role ***REMOVED***= 'user' && messages[i + 1].role ***REMOVED***= 'me') {
                pairs.push({
                    userMsg: messages[i],
                    humanReply: messages[i + 1],
                });
            }
        }

        if (pairs.length ***REMOVED***= 0) {
            console.log(`  ⏭ ${creator.name} (${creator.phone}): 无有效对话对，跳过`);
            continue;
        }

        // 构建该达人所有消息的 timestamp → sft_record 映射（精确去重）
        const existingTimestamps = new Set(
            db.prepare(`
                SELECT json_extract(context_json, '$.user_timestamp') as uts
                FROM sft_memory
                WHERE context_json LIKE '%"history_source":"wa_messages"%'
                AND json_extract(context_json, '$.client_id') = ?
            `).all(creator.phone).map(r => String(r.uts))
        );

        // 过滤出需要处理的 pairs（未生成过记录的）
        const pendingPairs = pairs.filter(p => !existingTimestamps.has(String(p.userMsg.timestamp)));

        if (pendingPairs.length ***REMOVED***= 0) {
            console.log(`  ✅ ${creator.name} (${creator.phone}): 已有 ${pairs.length} 条记录，全部已生成，跳过`);
            skipped += pairs.length;
            continue;
        }

        console.log(`\n📁 ${creator.name} (${creator.phone}): ${pairs.length} 个对话片段，${pendingPairs.length} 个待处理，${pairs.length - pendingPairs.length} 个已生成`);

        const clientInfo = {
            name: creator.name,
            phone: creator.phone,
            wa_owner: creator.wa_owner,
            conversion_stage: creator.beta_status || 'unknown',
            priority: creator.priority || 'normal',
            msg_count: creator.msg_count,
        };

        // 建立 message index 映射：timestamp → message 对象
        const msgMap = new Map(messages.map(m => [m.timestamp, m]));

        for (let i = 0; i < pendingPairs.length; i++) {
            const { userMsg, humanReply } = pendingPairs[i];

            // 质量过滤：human_reply 必须是有效内容
            if (!isQualityHumanReply(humanReply.text)) {
                skipped++;
                process.stdout.write(`  ⏭ [${i + 1}/${pendingPairs.length}] human_reply 质量过低，过滤: "${humanReply.text?.slice(0, 20)}"\n`);
                continue;
            }

            // 构建 conversation：包含该 userMsg 之前最多10条消息
            const userMsgIndex = messages.findIndex(m => m.timestamp ***REMOVED***= userMsg.timestamp);
            const conversationMsgs = messages.slice(Math.max(0, userMsgIndex - 9), userMsgIndex + 1);
            const conversation = { messages: conversationMsgs };

            const scene = inferScene(userMsg.text, creator.beta_status);

            try {
                const { opt1, opt2 } = await generateCandidateResponses(conversation, clientInfo, policyDocs);

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

                db.prepare(`
                    INSERT INTO sft_memory
                    (model_opt1, model_opt2, human_selected, human_output,
                     model_predicted, model_rejected, is_custom_input, human_reason,
                     context_json, status, reviewed_by)
                    VALUES (?, ?, 'custom', ?, NULL, NULL, 0,
                     '历史对话回填：人工回复作为训练标签，AI 候选用于对比',
                     ?, 'approved', 'system')
                `).run(
                    opt1,
                    opt2,
                    humanReply.text,
                    contextJson
                );

                totalRecords++;
                process.stdout.write(`  ✅ [${i + 1}/${pairs.length}] 生成成功\n`);

                // Rate limit protection: 500ms delay between API calls
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                errors++;
                console.error(`  ❌ [${i + 1}/${pairs.length}] 失败: ${err.message}`);
                // Continue with next pair
            }
        }
    }

    console.log(`\n\n✅ 完成！`);
    console.log(`   新增 SFT 记录: ${totalRecords}`);
    console.log(`   跳过（已有）: ${skipped}`);
    console.log(`   错误: ${errors}`);

    db.close();
}

main().catch(console.error);
