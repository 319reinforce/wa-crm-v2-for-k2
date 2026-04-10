/**
 * WA 聊天记录 → 事件生成脚本
 *
 * 从 wa_messages 聊天历史中，通过 LLM 语义分析生成 events 记录。
 * 支持全量运行和单达人运行。
 *
 * 使用方法：
 *   node scripts/generate-events-from-chat.cjs              # 全量分析所有有消息的达人
 *   node scripts/generate-events-from-chat.cjs --creator=123 # 仅分析指定达人
 *   node scripts/generate-events-from-chat.cjs --dry-run     # 预览，不写入数据库
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wa_crm_v2',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

// API 配置（支持 OpenAI 和 MiniMax）
const USE_OPENAI = process.env.USE_OPENAI ***REMOVED***= 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE = 'https://api.minimaxi.com/anthropic/v1';

// 解析命令行参数
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CREATOR_ARG = args.find(a => a.startsWith('--creator='));
const TARGET_CREATOR_ID = CREATOR_ARG ? parseInt(CREATOR_ARG.split('=')[1]) : null;

if (DRY_RUN) console.log('[DRY RUN 模式 — 不写入数据库]\n');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 事件类型定义 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
const EVENT_DEFINITIONS = [
  {
    event_key: 'trial_7day',
    event_type: 'challenge',
    beau_keywords: ['20 day beta', '20-day beta', 'beta program', '$200 incentive', '$10 per day', '20天beta', '20天试用'],
    yiyun_keywords: ['7 day trial', '7-day trial', '7天试用', '7天任务包', '20 ai generations'],
    status_hint: '如果对话中提到参与或完成试用计划，填 completed；正在邀请中填 active',
  },
  {
    event_key: 'monthly_challenge',
    event_type: 'challenge',
    beau_keywords: ['$20 monthly', 'monthly fee', '$20 a month', '35 videos a week', '每周35条'],
    yiyun_keywords: ['$20 monthly', 'monthly fee', '$20 from video subsidy'],
    status_hint: '如果对话确认月费缴纳或持续参与，填 completed',
  },
  {
    event_key: 'agency_bound',
    event_type: 'agency',
    beau_keywords: ['drifto', 'sign agreement', 'sign the drifto', 'agency contract', 'mcn contract', '2 month contract', '签约', '绑定agency'],
    yiyun_keywords: ['drifto link', 'sign drifto', 'agency agreement', 'willing to sign'],
    status_hint: '如果对话中确认签约/绑定，填 completed；正在讨论中填 active',
  },
  {
    event_key: 'gmv_milestone',
    event_type: 'gmv',
    beau_keywords: ['congratulations on $5k', 'congrats $5k', '$5k gmv', 'reached $5k', '$10k gmv milestone', 'achieved $10k', 'congrats on your', 'milestone'],
    yiyun_keywords: [],
    status_hint: '从对话中提取 GMV 金额（如 $5k, $10k），填 completed，并在 meta 中记录 threshold',
  },
  {
    event_key: 'beta_program',
    event_type: 'incentive_task',
    beau_keywords: ['beta program', '20 day', '$200 bonus', 'violation compensation', '$10 per violation'],
    yiyun_keywords: [],
    status_hint: '如果对话确认参与 Beta 计划，填 completed',
  },
  {
    event_key: 'referral',
    event_type: 'referral',
    beau_keywords: ['referral code', 'invite code', 'refer a friend', 'invite someone', '推荐码', '介绍达人'],
    yiyun_keywords: ['referral code', 'invite code', 'recommend'],
    status_hint: '如果对话中发送了邀请码或确认推荐行为，填 completed',
  },
];

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 构建 system prompt ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
function buildSystemPrompt(owner) {
  const eventList = EVENT_DEFINITIONS.map(e => {
    const keywords = owner ***REMOVED***= 'Yiyun' ? e.yiyun_keywords : e.beau_keywords;
    return `  - ${e.event_key} (${e.event_type}): ${keywords.join(', ')}`;
  }).join('\n');

  return `You are an expert WhatsApp CRM event analyst. Your task is to analyze chat history between a creator account manager (me/Beau/Yiyun) and a creator (user), and identify structured CRM events.

## Event Types to Detect
${eventList}

## Detection Rules
1. Each event_key can appear at most ONCE per creator (unless status is different: active vs completed)
2. Only identify events that are CLEARLY mentioned or confirmed in the conversation
3. Do NOT guess or infer events without textual evidence in the messages
4. If no events are detected, return events: []
5. Extract the earliest timestamp for each detected event as start_at (format: YYYY-MM-DD)
6. If a milestone (like GMV) is mentioned, extract the specific amount/threshold into meta

## Owner Context
The account manager is "${owner}". Only use the keywords relevant for this owner. Yiyun does NOT have Beta program events.

## Response Format
Return ONLY a valid JSON object, no markdown, no explanation:
{
  "events": [
    {
      "event_key": "...",
      "event_type": "...",
      "status": "completed" | "active" | "pending",
      "trigger_source": "llm_analysis",
      "trigger_text": "a short natural language summary of what happened (max 100 chars)",
      "start_at": "YYYY-MM-DD or null",
      "meta": { ... additional event-specific data ... }
    }
  ],
  "analysis_note": "brief explanation of reasoning (1-2 sentences, in English)"
}`;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 调用 LLM API（支持 OpenAI / MiniMax）+ Rate Limit 重试***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function callLLM(messages, owner, retryCount = 0) {
  const systemPrompt = buildSystemPrompt(owner);

  const conversationText = messages.map(m => {
    const role = m.role ***REMOVED***= 'me' ? 'Creator Manager' : 'Creator';
    const text = (m.text || '').replace(/"/g, "'");
    const date = new Date(m.timestamp * 1000).toISOString().slice(0, 10);
    return `[${date}] ${role}: ${text}`;
  }).join('\n');

  const userPrompt = `Chat History (most recent last):\n${conversationText}`;

  let raw;
  if (USE_OPENAI) {
    // OpenAI 格式
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
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const err = await response.text();
      // 429 Rate Limit：等待 15 秒重试一次
      if (response.status ***REMOVED***= 429 && retryCount ***REMOVED***= 0) {
        console.log(`\n  [Rate Limit] 等待 15 秒后重试...`);
        await new Promise(r => setTimeout(r, 15000));
        return callLLM(messages, owner, retryCount + 1);
      }
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }
    const data = await response.json();
    raw = data.choices?.[0]?.message?.content || '';
  } else {
    // MiniMax Anthropic 兼容格式
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
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errText}`);
    }
    const data = await response.json();
    raw = (data?.content && Array.isArray(data.content))
      ? (data.content.find(c => c.type ***REMOVED***= 'text')?.text || '')
      : (data?.choices?.[0]?.message?.content || '');
  }

  // 提取 JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in LLM response: ${raw.slice(0, 200)}`);
  }

  return JSON.parse(jsonMatch[0]);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 检查事件是否已存在 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function eventExists(conn, creatorId, eventKey) {
  const [rows] = await conn.query(
    `SELECT id, status FROM events
     WHERE creator_id = ? AND event_key = ?
     AND status IN ('active', 'completed')
     ORDER BY created_at DESC LIMIT 1`,
    [creatorId, eventKey]
  );
  return rows[0] || null;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 插入事件（处理 unique index 冲突）***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function insertEvent(conn, creatorId, owner, eventData) {
  const { event_key, event_type, status, trigger_text, start_at, meta } = eventData;
  try {
    const [result] = await conn.query(
      `INSERT INTO events (creator_id, event_key, event_type, owner, status,
        trigger_source, trigger_text, start_at, meta)
       VALUES (?, ?, ?, ?, ?, 'llm_analysis', ?, ?, ?)`,
      [creatorId, event_key, event_type, owner, status, trigger_text, start_at || null, meta ? JSON.stringify(meta) : null]
    );
    return { inserted: true, id: result.insertId };
  } catch (e) {
    // Unique index 冲突（同一个 creator_id + event_key + status 已存在）
    if (e.code ***REMOVED***= 'ER_DUP_ENTRY' || e.message.includes('Duplicate entry')) {
      return { inserted: false, duplicate: true };
    }
    throw e;
  }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 主流程 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function main() {
  if (USE_OPENAI && !OPENAI_API_KEY) {
    console.error('错误: USE_OPENAI=true 但 OPENAI_API_KEY 环境变量未设置');
    process.exit(1);
  }
  if (!USE_OPENAI && !MINIMAX_API_KEY) {
    console.error('错误: USE_OPENAI=false 且 MINIMAX_API_KEY 环境变量未设置');
    process.exit(1);
  }

  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(DB_CONFIG);

  console.log('═'.repeat(60));
  console.log('  WA 聊天记录 → 事件生成');
  console.log(`  Provider: ${USE_OPENAI ? 'OpenAI' : 'MiniMax'} (${USE_OPENAI ? OPENAI_MODEL : 'mini-max-typing'})`);
  console.log(`  模式: ${DRY_RUN ? 'DRY RUN（不写入）' : 'LIVE（写入数据库）'}`);
  console.log('═'.repeat(60));
  console.log('');

  // 1. 获取待处理的达人
  let sql = `
    SELECT c.id, c.primary_name, c.wa_phone, c.wa_owner,
           COUNT(wm.id) as msg_count
    FROM creators c
    JOIN wa_messages wm ON wm.creator_id = c.id
    WHERE c.wa_phone IS NOT NULL
  `;
  const params = [];

  if (TARGET_CREATOR_ID) {
    sql += ' AND c.id = ?';
    params.push(TARGET_CREATOR_ID);
  }

  sql += ' GROUP BY c.id ORDER BY msg_count DESC';

  const [creators] = await conn.query(sql, params);
  console.log(`待分析达人: ${creators.length} 个\n`);

  if (creators.length ***REMOVED***= 0) {
    console.log('没有需要分析的达人，退出。');
    await conn.end();
    return;
  }

  const stats = { total: creators.length, processed: 0, events_created: 0, skipped: 0, errors: 0 };

  for (const creator of creators) {
    stats.processed++;
    process.stdout.write(
      `[${stats.processed}/${stats.total}] ${creator.primary_name} (${creator.wa_phone}) `
    );

    try {
      // 2. 获取该达人的消息（最新 80 条）
      const [msgs] = await conn.query(
        `SELECT role, text, timestamp FROM wa_messages
         WHERE creator_id = ?
         ORDER BY timestamp ASC
         LIMIT 80`,
        [creator.id]
      );

      if (msgs.length ***REMOVED***= 0) {
        console.log('— 无消息，跳过');
        stats.skipped++;
        continue;
      }

      // 3. 调用 LLM 分析
      let analysis;
      try {
        analysis = await callLLM(msgs, creator.wa_owner);
      } catch (e) {
        console.log(`\n  [LLM 错误] ${e.message.slice(0, 100)}`);
        stats.errors++;
        continue;
      }

      const detectedEvents = Array.isArray(analysis.events) ? analysis.events : [];

      if (detectedEvents.length ***REMOVED***= 0) {
        console.log(`— 无事件 (${(analysis.analysis_note || '').slice(0, 60)})`);
        stats.skipped++;
        continue;
      }

      // 4. 去重 + 写入
      let created = 0;
      for (const evt of detectedEvents) {
        const existing = await eventExists(conn, creator.id, evt.event_key);

        if (existing) {
          // 同 key + 同 status → 跳过
          if (existing.status ***REMOVED***= evt.status) {
            console.log(`\n  [跳过] ${evt.event_key} (${evt.status}) 已存在`);
            continue;
          }
          // 不同 status（如 pending → active）：后续按 INSERT IGNORE 处理，数据库唯一索引会拒绝
        }

        if (DRY_RUN) {
          console.log(`\n  [DRY] 将创建: ${evt.event_key} (${evt.status}) — ${evt.trigger_text}`);
          created++;
          stats.events_created++;
        } else {
          const result = await insertEvent(conn, creator.id, creator.wa_owner, evt);
          if (result.inserted) {
            console.log(`\n  [+事件] ${evt.event_key} (${evt.status}) id=${result.id} — ${evt.trigger_text}`);
            created++;
            stats.events_created++;
          } else if (result.duplicate) {
            console.log(`\n  [跳过] ${evt.event_key} (${evt.status}) 已存在`);
          }
        }
      }

      if (created ***REMOVED***= 0) console.log('— 无新事件');
    } catch (e) {
      console.log(`\n  [错误] ${e.message.slice(0, 100)}`);
      stats.errors++;
    }
  }

  // 5. 结果汇总
  console.log('\n' + '═'.repeat(60));
  console.log('  分析完成');
  console.log('═'.repeat(60));
  console.log(`  总达人:    ${stats.total}`);
  console.log(`  处理:      ${stats.processed}`);
  console.log(`  新建事件:  ${stats.events_created}`);
  console.log(`  跳过:      ${stats.skipped}`);
  console.log(`  错误:      ${stats.errors}`);

  if (!DRY_RUN) {
    const [evCount] = await conn.query('SELECT COUNT(*) as cnt FROM events');
    console.log(`\n  events 表当前总量: ${evCount[0].cnt} 条`);
  }

  await conn.end();
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
