/**
 * 数据迁移脚本
 * 将 data/*.json 中的 WA 数据迁移到 SQLite crm.db
 *
 * 使用方式: node migrate.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'wa-ai-crm', 'data');
const DB_PATH = path.join(__dirname, 'crm.db');

// 进度显示
const BAR_WIDTH = 40;
function showProgress(current, total, label) {
    const ratio = current / total;
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    process.stdout.write(`\r[${bar}] ${current}/${total} ${label}`);
    if (current ***REMOVED***= total) {
        console.log('\n');
    }
}

// 初始化数据库连接
const db = new Database(DB_PATH);

// 标准化名字
function cleanName(name) {
    if (!name) return '';
    return name
        .replace(/\([^)]*\)/g, '')    // 去括号内容
        .replace(/[（）]/g, ' ')       // 去中文括号
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // 去emoji
        .replace(/[_\-\.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// 获取或创建 creator
const getOrCreateCreator = db.prepare(`
    INSERT INTO creators (primary_name, wa_phone, source)
    VALUES (?, ?, ?)
    ON CONFLICT(wa_phone) DO UPDATE SET
        primary_name = excluded.primary_name,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id
`);

// 插入消息（去重：同一 creator 同一 timestamp 同一 text 只插入一次）
const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO wa_messages (creator_id, role, text, timestamp)
    VALUES (?, ?, ?, ?)
`);

// 插入 WA CRM 数据
const insertWacrm = db.prepare(`
    INSERT OR REPLACE INTO wa_crm_data (
        creator_id, priority, next_action, event_score, urgency_level,
        monthly_fee_status, monthly_fee_amount, monthly_fee_deducted,
        beta_status, beta_cycle_start, beta_program_type,
        agency_bound, agency_bound_at, agency_deadline,
        video_count, video_target, video_last_checked,
        updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

// 批量消息插入
const insertMessagesBatch = db.transaction((creatorId, messages) => {
    for (const msg of messages) {
        insertMessage.run(creatorId, msg.role, msg.text, msg.timestamp);
    }
});

async function migrate() {
    console.log('='.repeat(50));
    console.log('WA CRM v2 数据迁移脚本');
    console.log('='.repeat(50));
    console.log('');

    // 获取所有 JSON 文件
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`数据目录: ${DATA_DIR}`);
    console.log(`待处理文件: ${files.length}`);
    console.log('');

    let successCount = 0;
    let errorCount = 0;
    let totalMessages = 0;

    // 进度统计
    let processed = 0;

    for (const file of files) {
        try {
            const filePath = path.join(DATA_DIR, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // 创建或获取 creator
            const creator = getOrCreateCreator.get(
                data.name || 'Unknown',
                data.phone,
                data.source || 'unknown'
            );
            const creatorId = creator.id;

            // 插入消息
            if (data.messages && data.messages.length > 0) {
                insertMessagesBatch(creatorId, data.messages);
                totalMessages += data.messages.length;
            }

            // 插入 WA CRM 数据
            const events = data.events || {};
            const score = data.score || {};

            insertWacrm.run(
                creatorId,
                data.priority || 'low',
                data.next_action || '',
                score.event_score || 0,
                score.urgency_level || 5,
                events.monthly_fee?.status || 'pending',
                events.monthly_fee?.amount || 20,
                events.monthly_fee?.deducted ? 1 : 0,
                events.monthly_beta?.status || 'not_introduced',
                events.monthly_beta?.cycle_start_date || null,
                events.monthly_beta?.program_type || '20_day_beta',
                events.agency_binding?.bound ? 1 : 0,
                events.agency_binding?.bound_at || null,
                events.agency_binding?.deadline || null,
                events.weekly_videos?.current_count || 0,
                events.weekly_videos?.target_weekly || 35,
                events.weekly_videos?.last_checked || null
            );

            successCount++;
            processed++;
            showProgress(processed, files.length, '迁移中');

        } catch (err) {
            console.error(`\n错误 [${file}]: ${err.message}`);
            errorCount++;
            processed++;
            showProgress(processed, files.length, '迁移中');
        }
    }

    // 统计结果
    console.log('');
    console.log('='.repeat(50));
    console.log('迁移完成');
    console.log('='.repeat(50));
    console.log(`成功: ${successCount} 个联系人`);
    console.log(`失败: ${errorCount} 个文件`);
    console.log(`消息总数: ${totalMessages} 条`);

    // 验证数据
    const creatorCount = db.prepare('SELECT COUNT(*) as count FROM creators').get();
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM wa_messages').get();
    console.log('');
    console.log('数据库验证:');
    console.log(`  creators 表: ${creatorCount.count} 条记录`);
    console.log(`  wa_messages 表: ${messageCount.count} 条记录`);

    db.close();
}

migrate().catch(err => {
    console.error('迁移失败:', err);
    db.close();
    process.exit(1);
});
