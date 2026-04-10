/**
 * 完整数据迁移填充脚本
 * 运行: node migrate-seed-data.js
 * 目标: MySQL wa_crm_v2
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wa_crm_v2',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('***REMOVED***= 完整数据迁移填充 ***REMOVED***=\n');

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 1. 填充 events_policy ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('[1/6] 填充 events_policy...');
  const eventPolicies = [
    ['Beau', 'trial_7day', JSON.stringify({
      weekly_target: 35, bonus_per_video: 5, max_periods: 4,
      currency: 'USD', crosscheck_platforms: ['tiktok', 'instagram']
    })],
    ['Beau', 'monthly_challenge', JSON.stringify({
      weekly_target: 35, bonus_per_video: 5, max_periods: 12, currency: 'USD'
    })],
    ['Beau', 'agency_bound', JSON.stringify({
      description: 'Agency绑定后解锁GMV激励任务和推荐激励任务',
      parallel_with_challenge: true
    })],
    ['Beau', 'gmv_milestone', JSON.stringify({
      gmv_milestones: [
        { threshold: 1000, reward_type: 'commission_boost', value: 0.5, condition: 'weekly_video >= 35' },
        { threshold: 5000, reward_type: 'cash', value: 100 },
        { threshold: 10000, reward_type: 'cash', value: 120 },
        { threshold: 20000, reward_type: 'cash', value: 200 },
      ]
    })],
    ['Yiyun', 'trial_7day', JSON.stringify({
      weekly_target: 20, bonus_per_video: 3, max_periods: 4,
      currency: 'USD', crosscheck_platforms: ['tiktok']
    })],
    ['Yiyun', 'monthly_challenge', JSON.stringify({
      weekly_target: 20, bonus_per_video: 3, max_periods: 12, currency: 'USD'
    })],
    ['Yiyun', 'agency_bound', JSON.stringify({
      description: 'Agency绑定后可参与推荐激励',
      parallel_with_challenge: true
    })],
    ['Beau', 'gmv_milestone_10k', JSON.stringify({
      gmv_milestones: [
        { threshold: 1000, reward_type: 'commission_boost', value: 0.5, condition: 'weekly_video >= 35' },
        { threshold: 5000, reward_type: 'cash', value: 100 },
        { threshold: 10000, reward_type: 'cash', value: 120 },
        { threshold: 20000, reward_type: 'cash', value: 200 },
      ]
    })],
    ['Beau', 'referral', JSON.stringify({
      reward_per_referral: 10, reward_tier2: 15,
      description: '推荐达人奖励：1-10人$10/人，11人以上$15/人'
    })],
    ['Beau', 'beta_program', JSON.stringify({
      description: 'Beta Program 20天挑战',
      incentive: 200, cycle_days: 20
    })],
    ['Yiyun', 'gmv_milestone', JSON.stringify({
      gmv_milestones: [
        { threshold: 1000, reward_type: 'commission_boost', value: 0.5 },
        { threshold: 5000, reward_type: 'cash', value: 100 },
        { threshold: 10000, reward_type: 'cash', value: 120 },
      ]
    })],
    ['Yiyun', 'referral', JSON.stringify({
      reward_per_referral: 10, reward_tier2: 15,
      description: '推荐达人奖励：1-10人$10/人，11人以上$15/人'
    })],
    ['Yiyun', 'beta_program', JSON.stringify({
      description: 'Beta Program 7天试用',
      incentive: 0, cycle_days: 7
    })],
  ];

  for (const [owner, event_key, policy_json] of eventPolicies) {
    await conn.execute(
      `INSERT IGNORE INTO events_policy (owner, event_key, policy_json) VALUES (?, ?, ?)`,
      [owner, event_key, policy_json]
    );
  }
  console.log('  ✓ events_policy 填充完成');

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 2. 填充 wa_crm_data (为所有没有的 creator 初始化) ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('\n[2/6] 填充 wa_crm_data...');
  const [missing] = await conn.execute(`
    SELECT c.id FROM creators c
    LEFT JOIN wa_crm_data w ON w.creator_id = c.id
    WHERE w.id IS NULL
  `);
  if (missing.length > 0) {
    const values = missing.map(() => '(?)').join(',');
    await conn.query(
      `INSERT IGNORE INTO wa_crm_data (creator_id) VALUES ${values}`,
      missing.map(r => r.id)
    );
    console.log(`  ✓ 新增 ${missing.length} 条 wa_crm_data`);
  } else {
    console.log('  ✓ wa_crm_data 已完整');
  }

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 3. 填充 creator_aliases (从 joinbrands_link 和 keeper_link 推导) ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('\n[3/6] 填充 creator_aliases...');
  const [creatorsWithLinks] = await conn.execute(`
    SELECT DISTINCT c.id as creator_id,
      j.creator_name_jb as jb_name,
      k.keeper_username
    FROM creators c
    LEFT JOIN joinbrands_link j ON j.creator_id = c.id
    LEFT JOIN keeper_link k ON k.creator_id = c.id
    WHERE j.creator_name_jb IS NOT NULL OR k.keeper_username IS NOT NULL
  `);

  let aliasCount = 0;
  for (const row of creatorsWithLinks) {
    if (row.keeper_username) {
      try {
        await conn.execute(
          `INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, 'keeper_user', ?, 1)`,
          [row.creator_id, row.keeper_username]
        );
        aliasCount++;
      } catch (e) { /* duplicate */ }
    }
    if (row.jb_name) {
      try {
        await conn.execute(
          `INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, 'jb_name', ?, 1)`,
          [row.creator_id, row.jb_name]
        );
        aliasCount++;
      } catch (e) { /* duplicate */ }
    }
  }
  console.log(`  ✓ 新增 ${aliasCount} 条 creator_aliases`);

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 4. 从 joinbrands_link 历史数据生成 events 记录 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('\n[4/6] 从 joinbrands_link 历史数据生成 events...');
  const [jbCreators] = await conn.execute(`
    SELECT c.id as creator_id, c.wa_owner,
      j.ev_joined, j.ev_trial_active, j.ev_monthly_started,
      j.ev_monthly_joined, j.ev_gmv_5k, j.ev_gmv_10k, j.ev_agency_bound
    FROM creators c
    JOIN joinbrands_link j ON j.creator_id = c.id
    WHERE j.ev_joined = 1 OR j.ev_trial_active = 1 OR j.ev_monthly_started = 1
      OR j.ev_agency_bound = 1 OR j.ev_gmv_5k = 1 OR j.ev_gmv_10k = 1
  `);

  let eventCount = 0;
  const eventInserts = [
    { key: 'trial_7day', cond: row => row.ev_trial_active, type: 'challenge', threshold: null },
    { key: 'monthly_challenge', cond: row => row.ev_monthly_started || row.ev_monthly_joined, type: 'challenge', threshold: null },
    { key: 'agency_bound', cond: row => row.ev_agency_bound, type: 'agency', threshold: null },
    { key: 'gmv_milestone', cond: row => row.ev_gmv_5k, type: 'gmv', threshold: 5000 },
    { key: 'gmv_milestone_10k', cond: row => row.ev_gmv_10k, type: 'gmv', threshold: 10000 },
  ];

  for (const row of jbCreators) {
    for (const evt of eventInserts) {
      if (evt.cond(row)) {
        const [ex] = await conn.execute(
          `SELECT id FROM events WHERE creator_id = ? AND event_key = ? LIMIT 1`,
          [row.creator_id, evt.key]
        );
        if (ex.length ***REMOVED***= 0) {
          const meta = evt.threshold ? JSON.stringify({ threshold: evt.threshold }) : null;
          await conn.execute(
            `INSERT INTO events (creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, meta, start_at)
             VALUES (?, ?, ?, ?, 'completed', 'semantic_auto', '从joinbrands数据迁移', ?, NOW())`,
            [row.creator_id, evt.key, evt.type, row.wa_owner, meta]
          );
          eventCount++;
        }
      }
    }
  }
  console.log(`  ✓ 新增 ${eventCount} 条 events 记录`);

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 5. 填充 policy_documents ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('\n[5/6] 填充 policy_documents...');
  const policyDocItems = [
    {
      policy_key: 'beta_program',
      policy_version: 'v1',
      policy_content: {
        name: 'Beta Program 政策',
        rules: [
          '20天Beta周期，$200激励，$10/天结算',
          '每周视频≥35条可获得Bonus',
          '违规补偿：$10/次',
          'DRIFTO MCN签约期仅2个月，到期自动解除'
        ],
        incentives: {
          gmv_1k: { reward: '额外50%佣金', condition: 'video>=35/week' },
          gmv_5k: { reward: '$100现金' },
          gmv_10k: { reward: '$120现金' },
          gmv_20k: { reward: '$200现金' }
        }
      },
      applicable_scenarios: ['trial_intro', 'beta_cycle_start', 'violation_appeal']
    },
    {
      policy_key: 'monthly_fee',
      policy_version: 'v1',
      policy_content: {
        name: '月费政策',
        rules: [
          '$20月费：从视频补贴扣除，当周不足$20则不扣除',
          '付款周期：每周一结算',
          '7天试用任务包，20 AI generations/day'
        ]
      },
      applicable_scenarios: ['monthly_inquiry', 'payment_issue']
    },
    {
      policy_key: 'content_policy',
      policy_version: 'v1',
      policy_content: {
        name: '内容政策',
        rules: [
          '5个视频/天最佳，超6个TikTok降权',
          '不得发布违反平台政策的内容',
          '违规$10补偿承诺（需在24小时内申诉）'
        ]
      },
      applicable_scenarios: ['content_request', 'violation_appeal']
    }
  ];

  for (const p of policyDocItems) {
    await conn.execute(
      `INSERT IGNORE INTO policy_documents (policy_key, policy_version, policy_content, applicable_scenarios)
       VALUES (?, ?, ?, ?)`,
      [p.policy_key, p.policy_version, JSON.stringify(p.policy_content), JSON.stringify(p.applicable_scenarios)]
    );
  }
  console.log('  ✓ policy_documents 填充完成');

  // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 6. 验证最终状态 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
  console.log('\n[6/6] 验证最终状态...');
  const tables = ['events', 'events_policy', 'policy_documents', 'creator_aliases', 'wa_crm_data', 'audit_log'];
  for (const tbl of tables) {
    const [r] = await conn.execute(`SELECT COUNT(*) as c FROM ${tbl}`);
    console.log(`  ${tbl}: ${r[0].c}`);
  }

  await conn.end();
  console.log('\n***REMOVED***= 填充完成 ***REMOVED***=');
}

main().catch(e => { console.error(e); process.exit(1); });
