/**
 * 建表迁移脚本：为 client_profiles 和 client_tags 建表
 * 用法: node migrate-profiles.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crm.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 建表
db.exec(`
-- Client Profiles — 客户独立画像
CREATE TABLE IF NOT EXISTS client_profiles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id           TEXT UNIQUE NOT NULL,
    summary             TEXT,
    tags                TEXT,
    tiktok_data        TEXT,
    stage              TEXT,
    last_interaction   DATETIME,
    last_updated       DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cp_client ON client_profiles(client_id);

-- Client Tags — 动态标签
CREATE TABLE IF NOT EXISTS client_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       TEXT NOT NULL,
    tag             TEXT NOT NULL,
    source          TEXT NOT NULL,
    confidence      INTEGER DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, tag, source)
);

CREATE INDEX IF NOT EXISTS idx_ct_client ON client_tags(client_id);
CREATE INDEX IF NOT EXISTS idx_ct_tag ON client_tags(tag);
`);

// 验证
const cp = db.prepare('SELECT COUNT(*) as cnt FROM client_profiles').get();
const ct = db.prepare('SELECT COUNT(*) as cnt FROM client_tags').get();
console.log('client_profiles:', cp.cnt, '行');
console.log('client_tags:', ct.cnt, '行');
console.log('✅ 建表完成');

db.close();
