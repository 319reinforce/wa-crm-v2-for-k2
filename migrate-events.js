/**
 * 事件系统数据库迁移
 * 运行: node migrate-events.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crm.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('***REMOVED***= 事件系统迁移 ***REMOVED***=');
console.log('数据库:', DB_PATH);

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 1. 创建 events 表 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
console.log('\n[1/4] 创建 events 表...');
db.exec(`
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id      INTEGER NOT NULL REFERENCES creators(id),
    event_key       TEXT NOT NULL,            -- 'trial_7day', 'monthly_challenge', 'agency_bound'
    event_type      TEXT NOT NULL,             -- 'challenge', 'gmv', 'referral', 'incentive_task', 'agency'
    owner           TEXT NOT NULL,             -- 'Beau' | 'Yiyun'
    status          TEXT DEFAULT 'pending',    -- 'pending' | 'active' | 'completed' | 'cancelled'
    trigger_source  TEXT,                      -- 'semantic_auto' | 'manual' | 'gmv_crosscheck'
    trigger_text    TEXT,                     -- 触发时的原始语义文本
    start_at        DATETIME,                  -- 事件开始时间
    end_at          DATETIME,                  -- 事件结束时间（null=进行中）
    meta            TEXT,                      -- JSON，事件特定配置
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_creator ON events(creator_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_active
    ON events(creator_id, event_key, status)
    WHERE status = 'active';
`);
console.log('✓ events 表创建完成');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 2. 创建 event_periods 表 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
console.log('\n[2/4] 创建 event_periods 表...');
db.exec(`
CREATE TABLE IF NOT EXISTS event_periods (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       INTEGER NOT NULL REFERENCES events(id),
    period_start    DATETIME NOT NULL,         -- 周期开始时间
    period_end      DATETIME NOT NULL,         -- 周期结束时间
    video_count     INTEGER DEFAULT 0,         -- 实际发布数
    bonus_earned    REAL DEFAULT 0,            -- 本周期奖励金额
    status          TEXT DEFAULT 'pending',   -- 'pending' | 'settled'
    meta            TEXT,                      -- JSON，额外数据（如跨平台核对结果）
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_periods_event ON event_periods(event_id);
CREATE INDEX IF NOT EXISTS idx_periods_status ON event_periods(status);
`);
console.log('✓ event_periods 表创建完成');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 3. 验证表结构 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
console.log('\n[3/4] 验证表结构...');
const eventsCols = db.prepare("PRAGMA table_info(events)").all();
const periodsCols = db.prepare("PRAGMA table_info(event_periods)").all();
console.log('events 表字段:', eventsCols.map(c => c.name).join(', '));
console.log('event_periods 表字段:', periodsCols.map(c => c.name).join(', '));

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 4. 写入初始策略配置 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
console.log('\n[4/4] 写入 Beau 事件策略配置...');

// Beau 策略存入 events_policy 表（如果需要独立存储策略的话）
db.exec(`
CREATE TABLE IF NOT EXISTS events_policy (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner           TEXT NOT NULL,             -- 'Beau' | 'Yiyun'
    event_key       TEXT NOT NULL,             -- 'trial_7day', 'monthly_challenge'
    policy_json     TEXT NOT NULL,              -- JSON 配置
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, event_key)
);
`);

const beauTrialPolicy = JSON.stringify({
    weekly_target: 35,
    bonus_per_video: 5,
    max_periods: 4,
    currency: 'USD',
    crosscheck_platforms: ['tiktok', 'instagram']
});

const beauMonthlyPolicy = JSON.stringify({
    weekly_target: 35,
    bonus_per_video: 5,
    max_periods: 12,
    currency: 'USD',
});

const beauAgencyPolicy = JSON.stringify({
    description: 'Agency 绑定后解锁 GMV 激励任务和推荐激励任务',
    parallel_with_challenge: true
});

const insertPolicy = db.prepare(`
    INSERT OR REPLACE INTO events_policy (owner, event_key, policy_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
`);

insertPolicy.run('Beau', 'trial_7day', beauTrialPolicy);
insertPolicy.run('Beau', 'monthly_challenge', beauMonthlyPolicy);
insertPolicy.run('Beau', 'agency_bound', beauAgencyPolicy);

console.log('✓ Beau 策略配置写入完成');

console.log('\n***REMOVED***= 迁移完成 ***REMOVED***=');
console.log('新建表: events, event_periods, events_policy');
console.log('状态: 所有表已创建并验证');

db.close();
