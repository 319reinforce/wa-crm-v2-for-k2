/**
 * SQLite → MySQL 数据迁移脚本
 * WA CRM v2
 *
 * 使用方法：
 *   node migrate-to-mysql.js          # 正常运行（增量：已迁移的表跳过）
 *   RESET=1 node migrate-to-mysql.js  # 清空 MySQL 表后重新迁移
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2');
const path = require('path');

const SQLITE_PATH = path.join(__dirname, 'crm.db');
const BATCH_SIZE = 500;

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    charset: 'utf8mb4',
    timezone: '+08:00',
};

const RESET = process.env.RESET ***REMOVED***= '1';

function log(msg) {
    console.log(`[migrate] ${new Date().toISOString().slice(11, 19)} ${msg}`);
}

function logError(msg) {
    console.error(`[migrate ERROR] ${new Date().toISOString().slice(11, 19)} ${msg}`);
}

async function main() {
    log('***REMOVED***= SQLite → MySQL 迁移开始 ***REMOVED***=');
    log(`SQLite: ${SQLITE_PATH}`);
    if (RESET) log('模式: RESET（将清空所有 MySQL 表后重新迁移）');

    const sqliteDb = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });

    const mysqlPool = mysql.createPool(MYSQL_CONFIG);
    const mysqlConn = await new Promise((resolve, reject) => {
        mysqlPool.getConnection((err, conn) => {
            if (err) reject(err);
            else resolve(conn);
        });
    });

    try {
        function toMysqlVal(val) {
            if (val ***REMOVED***= null || val ***REMOVED***= undefined || val ***REMOVED***= '') return null;
            if (typeof val ***REMOVED***= 'number') return val;
            if (typeof val ***REMOVED***= 'boolean') return val ? 1 : 0;
            return String(val);
        }

        // 先清空所有 MySQL 表（外键约束先关闭）
        if (RESET) {
            log('清空 MySQL 表...');
            await new Promise((resolve, reject) => {
                mysqlConn.query('SET FOREIGN_KEY_CHECKS = 0', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            const tables = [
                'event_periods', 'events', 'events_policy',
                'client_tags', 'client_profiles', 'client_memory',
                'sft_feedback', 'sft_memory', 'audit_log',
                'sync_log', 'manual_match', 'joinbrands_link', 'keeper_link',
                'wa_crm_data', 'creator_aliases', 'wa_messages', 'creators',
                'operator_experiences', 'policy_documents',
            ];
            for (const t of tables) {
                await new Promise((resolve, reject) => {
                    mysqlConn.query(`DELETE FROM ${t}`, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
            await new Promise((resolve, reject) => {
                mysqlConn.query('SET FOREIGN_KEY_CHECKS = 1', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            log('已清空所有表');
        }

        async function batchInsert(table, columns, rows) {
            if (rows.length ***REMOVED***= 0) return;
            const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
            const values = rows.flatMap(row => columns.map(col => toMysqlVal(row[col])));
            const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;
            await new Promise((resolve, reject) => {
                mysqlConn.query(sql, values, (err) => {
                    if (err) {
                        if (err.code ***REMOVED***= 'ER_DUP_ENTRY') {
                            log(`  [跳过] ${table} 重复键`);
                            resolve();
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve();
                    }
                });
            });
        }

        // 迁移顺序按外键依赖排列
        // 1. creators
        {
            const rows = sqliteDb.prepare('SELECT * FROM creators').all();
            const cols = ['id', 'primary_name', 'wa_phone', 'keeper_username', 'wa_owner', 'source', 'is_active', 'created_at', 'updated_at'];
            log(`迁移 creators: ${rows.length} 条`);
            await batchInsert('creators', cols, rows);
            log(`  ✓ creators`);
        }

        // 2. creator_aliases
        {
            const rows = sqliteDb.prepare('SELECT * FROM creator_aliases').all();
            const cols = ['id', 'creator_id', 'alias_type', 'alias_value', 'is_verified', 'matched_at'];
            log(`迁移 creator_aliases: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('creator_aliases', cols, rows);
            log(`  ✓ creator_aliases`);
        }

        // 3. wa_messages（最大表）
        {
            const total = sqliteDb.prepare('SELECT COUNT(*) as c FROM wa_messages').get().c;
            const cols = ['id', 'creator_id', 'role', 'operator', 'text', 'timestamp', 'created_at'];
            log(`迁移 wa_messages: ${total} 条`);
            let offset = 0;
            while (offset < total) {
                const rows = sqliteDb.prepare(`SELECT * FROM wa_messages ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`).all();
                await batchInsert('wa_messages', cols, rows);
                offset += BATCH_SIZE;
                log(`  进度 ${Math.min(offset, total)}/${total}`);
            }
            log(`  ✓ wa_messages`);
        }

        // 4. wa_crm_data
        {
            const rows = sqliteDb.prepare('SELECT * FROM wa_crm_data').all();
            const cols = ['id', 'creator_id', 'priority', 'next_action', 'event_score', 'urgency_level',
                'monthly_fee_status', 'monthly_fee_amount', 'monthly_fee_deducted',
                'beta_status', 'beta_cycle_start', 'beta_program_type',
                'agency_bound', 'agency_bound_at', 'agency_deadline',
                'video_count', 'video_target', 'video_last_checked', 'created_at', 'updated_at'];
            log(`迁移 wa_crm_data: ${rows.length} 条`);
            await batchInsert('wa_crm_data', cols, rows);
            log(`  ✓ wa_crm_data`);
        }

        // 5. keeper_link
        {
            const rows = sqliteDb.prepare('SELECT * FROM keeper_link').all();
            const cols = ['id', 'creator_id', 'keeper_username', 'keeper_gmv', 'keeper_gmv30',
                'keeper_orders', 'keeper_videos', 'keeper_videos_posted', 'keeper_videos_sold',
                'keeper_card_rate', 'keeper_order_rate', 'keeper_reg_time', 'keeper_activate_time', 'last_synced'];
            log(`迁移 keeper_link: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('keeper_link', cols, rows);
            log(`  ✓ keeper_link`);
        }

        // 6. joinbrands_link
        {
            const rows = sqliteDb.prepare('SELECT * FROM joinbrands_link').all();
            const cols = ['id', 'creator_id', 'creator_name_jb', 'jb_gmv', 'jb_status', 'jb_priority', 'jb_next_action',
                'last_message', 'days_since_msg', 'invite_code_jb',
                'ev_joined', 'ev_ready_sent', 'ev_trial_7day', 'ev_trial_active',
                'ev_monthly_started', 'ev_monthly_invited', 'ev_monthly_joined',
                'ev_whatsapp_shared', 'ev_gmv_1k', 'ev_gmv_2k', 'ev_gmv_5k', 'ev_gmv_10k',
                'ev_agency_bound', 'ev_churned', 'last_synced'];
            log(`迁移 joinbrands_link: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('joinbrands_link', cols, rows);
            log(`  ✓ joinbrands_link`);
        }

        // 7. manual_match
        {
            const rows = sqliteDb.prepare('SELECT * FROM manual_match').all();
            const cols = ['id', 'creator_id', 'keeper_username', 'joinbrands_name', 'wa_phone', 'matched_by', 'matched_at'];
            log(`迁移 manual_match: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('manual_match', cols, rows);
            log(`  ✓ manual_match`);
        }

        // 8. client_memory
        {
            const rows = sqliteDb.prepare('SELECT * FROM client_memory').all();
            const cols = ['id', 'client_id', 'memory_type', 'memory_key', 'memory_value', 'source_record_id', 'confidence', 'created_at', 'updated_at'];
            log(`迁移 client_memory: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('client_memory', cols, rows);
            log(`  ✓ client_memory`);
        }

        // 9. policy_documents（跳过无效 JSON content）
        {
            const rows = sqliteDb.prepare('SELECT * FROM policy_documents').all();
            const cols = ['id', 'policy_key', 'policy_version', 'policy_content', 'applicable_scenarios', 'is_active', 'created_at', 'updated_at'];
            log(`迁移 policy_documents: ${rows.length} 条`);
            const validRows = rows.filter(r => {
                try {
                    if (r.policy_content) JSON.parse(r.policy_content);
                    return true;
                } catch {
                    logError(`  [跳过] id=${r.id} policy_key=${r.policy_key}: policy_content 不是合法 JSON`);
                    return false;
                }
            });
            if (validRows.length > 0) await batchInsert('policy_documents', cols, validRows);
            log(`  ✓ policy_documents`);
        }

        // 10. audit_log（跳过 record_id 非整数、before_value/after_value 非 JSON 的测试记录）
        {
            const rows = sqliteDb.prepare('SELECT * FROM audit_log').all();
            const cols = ['id', 'action', 'table_name', 'record_id', 'operator', 'before_value', 'after_value', 'ip_address', 'user_agent', 'created_at'];
            log(`迁移 audit_log: ${rows.length} 条`);
            const validRows = rows.filter(r => {
                // record_id 必须是整数（MySQL INT）
                if (r.record_id !***REMOVED*** null && r.record_id !***REMOVED*** undefined && isNaN(Number(r.record_id))) {
                    logError(`  [跳过] audit_log id=${r.id}: record_id="${r.record_id}" 不是整数`);
                    return false;
                }
                // before_value/after_value 必须是合法 JSON（或 null）
                try {
                    if (r.before_value) JSON.parse(r.before_value);
                    if (r.after_value) JSON.parse(r.after_value);
                    return true;
                } catch {
                    logError(`  [跳过] audit_log id=${r.id}: before/after_value 不是合法 JSON`);
                    return false;
                }
            });
            if (validRows.length > 0) await batchInsert('audit_log', cols, validRows);
            log(`  ✓ audit_log`);
        }

        // 11. sft_memory
        {
            const rows = sqliteDb.prepare('SELECT * FROM sft_memory').all();
            const cols = ['id', 'model_opt1', 'model_opt2', 'human_selected', 'human_output', 'model_predicted', 'model_rejected',
                'is_custom_input', 'human_reason', 'context_json', 'status', 'reviewed_by',
                'similarity', 'scene', 'message_history', 'system_prompt_version',
                'client_id_hash', 'input_text_hash', 'human_output_hash', 'created_date',
                'chosen_output', 'rejected_output', 'created_at'];
            log(`迁移 sft_memory: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('sft_memory', cols, rows);
            log(`  ✓ sft_memory`);
        }

        // 12. sft_feedback
        {
            const rows = sqliteDb.prepare('SELECT * FROM sft_feedback').all();
            const cols = ['id', 'client_id', 'feedback_type', 'input_text', 'opt1', 'opt2', 'final_output', 'scene', 'detail', 'reject_reason', 'created_at'];
            log(`迁移 sft_feedback: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('sft_feedback', cols, rows);
            log(`  ✓ sft_feedback`);
        }

        // 13. events
        {
            const rows = sqliteDb.prepare('SELECT * FROM events').all();
            const cols = ['id', 'creator_id', 'event_key', 'event_type', 'owner', 'status', 'trigger_source', 'trigger_text', 'start_at', 'end_at', 'meta', 'created_at', 'updated_at'];
            log(`迁移 events: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('events', cols, rows);
            log(`  ✓ events`);
        }

        // 14. event_periods
        {
            const rows = sqliteDb.prepare('SELECT * FROM event_periods').all();
            const cols = ['id', 'event_id', 'period_start', 'period_end', 'video_count', 'bonus_earned', 'status', 'meta', 'created_at', 'updated_at'];
            log(`迁移 event_periods: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('event_periods', cols, rows);
            log(`  ✓ event_periods`);
        }

        // 15. events_policy
        {
            const rows = sqliteDb.prepare('SELECT * FROM events_policy').all();
            const cols = ['id', 'owner', 'event_key', 'policy_json', 'created_at', 'updated_at'];
            log(`迁移 events_policy: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('events_policy', cols, rows);
            log(`  ✓ events_policy`);
        }

        // 16. client_profiles
        {
            const rows = sqliteDb.prepare('SELECT * FROM client_profiles').all();
            const cols = ['id', 'client_id', 'summary', 'tags', 'tiktok_data', 'stage', 'last_interaction', 'last_updated', 'created_at'];
            log(`迁移 client_profiles: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('client_profiles', cols, rows);
            log(`  ✓ client_profiles`);
        }

        // 17. client_tags
        {
            const rows = sqliteDb.prepare('SELECT * FROM client_tags').all();
            const cols = ['id', 'client_id', 'tag', 'source', 'confidence', 'created_at'];
            log(`迁移 client_tags: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('client_tags', cols, rows);
            log(`  ✓ client_tags`);
        }

        // 18. sync_log
        {
            const rows = sqliteDb.prepare('SELECT * FROM sync_log').all();
            const cols = ['id', 'bot_name', 'record_count', 'synced_at', 'status', 'note'];
            log(`迁移 sync_log: ${rows.length} 条`);
            if (rows.length > 0) await batchInsert('sync_log', cols, rows);
            log(`  ✓ sync_log`);
        }

        // 验证
        const counts = await new Promise((resolve, reject) => {
            mysqlConn.query(`
                SELECT 'creators' as tbl, COUNT(*) as c FROM creators
                UNION ALL SELECT 'wa_messages', COUNT(*) FROM wa_messages
                UNION ALL SELECT 'wa_crm_data', COUNT(*) FROM wa_crm_data
                UNION ALL SELECT 'client_profiles', COUNT(*) FROM client_profiles
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        log('***REMOVED***= 迁移完成 ***REMOVED***=');
        for (const r of counts) {
            log(`  ${r.tbl}: ${r.c} rows`);
        }

    } catch (err) {
        logError(`迁移失败: ${err.message}`);
        process.exit(1);
    } finally {
        sqliteDb.close();
        mysqlConn.release();
        mysqlPool.end();
    }
}

main().catch(err => {
    logError(`Fatal: ${err.message}`);
    process.exit(1);
});
