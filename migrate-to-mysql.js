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
            const mapped = rows.map(r => ({
                id: r.id,
                primary_name: r.creator_name,
                wa_phone: r.whatsapp_phone || null,
                keeper_username: r.tiktok_username || null,
                wa_owner: r.wa_owner || 'Beau',
                source: r.source || 'unknown',
                is_active: 1,
                created_at: r.created_at || null,
                updated_at: r.updated_at || null,
            }));
            log(`迁移 creators: ${mapped.length} 条`);
            await batchInsert('creators', cols, mapped);
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

        // 4. wa_crm_data (源表: SQLite wa_crm_link)
        {
            const rows = sqliteDb.prepare('SELECT * FROM wa_crm_link').all();
            const cols = ['id', 'creator_id', 'priority', 'next_action',
                'event_score', 'urgency_level',
                'monthly_fee_status', 'monthly_fee_amount', 'monthly_fee_deducted',
                'beta_status', 'beta_cycle_start', 'beta_program_type',
                'agency_bound', 'agency_bound_at', 'agency_deadline',
                'video_count', 'video_target', 'video_last_checked',
                'created_at', 'updated_at'];
            const mapped = rows.map(r => ({
                id: r.id,
                creator_id: r.creator_id,
                priority: r.priority || 'low',
                next_action: r.next_action || null,
                event_score: r.event_score ?? 0,
                urgency_level: r.urgency_level ?? 5,
                monthly_fee_status: r.monthly_fee_status || 'pending',
                monthly_fee_amount: r.monthly_fee_amount ?? 20,
                monthly_fee_deducted: r.monthly_fee_deducted ?? 0,
                beta_status: r.beta_status || 'not_introduced',
                beta_cycle_start: r.beta_cycle_start ?? null,
                beta_program_type: r.beta_program_type || '20_day_beta',
                agency_bound: r.agency_bound || 0,
                agency_bound_at: r.agency_bound_at ?? null,
                agency_deadline: r.agency_deadline ?? null,
                video_count: r.video_count ?? 0,
                video_target: r.video_target ?? 35,
                video_last_checked: r.video_last_checked ?? null,
                created_at: r.last_synced || null,
                updated_at: r.last_synced || null,
            }));
            log(`迁移 wa_crm_data: ${mapped.length} 条`);
            await batchInsert('wa_crm_data', cols, mapped);
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
            const mapped = rows.map(r => ({
                id: r.id, creator_id: r.creator_id, creator_name_jb: r.creator_name_jb,
                jb_gmv: r.jb_gmv, jb_status: r.jb_status, jb_priority: r.jb_priority,
                jb_next_action: r.jb_next_action, last_message: r.last_message,
                days_since_msg: r.days_since_msg, invite_code_jb: r.invite_code_jb,
                ev_joined: r.ev_joined, ev_ready_sent: r.ev_ready_sent,
                ev_trial_7day: r.ev_trial_7day,
                ev_trial_active: r.ev_trial_active ?? r.ev_trial_7day ?? 0,
                ev_monthly_started: r.ev_monthly_started ?? r.ev_monthly_invited ?? 0,
                ev_monthly_invited: r.ev_monthly_invited,
                ev_monthly_joined: r.ev_monthly_joined, ev_whatsapp_shared: r.ev_whatsapp_shared,
                ev_gmv_1k: r.ev_gmv_1k,
                ev_gmv_2k: r.ev_gmv_2k ?? r.ev_gmv_3k ?? 0,
                ev_gmv_5k: r.ev_gmv_5k ?? 0,
                ev_gmv_10k: r.ev_gmv_10k,
                ev_agency_bound: r.ev_agency_bound, ev_churned: r.ev_churned,
                last_synced: r.last_synced,
            }));
            log(`迁移 joinbrands_link: ${mapped.length} 条`);
            if (mapped.length > 0) await batchInsert('joinbrands_link', cols, mapped);
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

        // 10. audit_log（跳过 before_value/after_value 非 JSON 的测试记录）
        {
            const rows = sqliteDb.prepare('SELECT * FROM audit_log').all();
            const cols = ['id', 'action', 'table_name', 'record_id', 'operator', 'before_value', 'after_value', 'ip_address', 'user_agent', 'created_at'];
            log(`迁移 audit_log: ${rows.length} 条`);
            const validRows = rows.filter(r => {
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
                'chosen_output', 'rejected_output', 'system_prompt_used', 'created_at'];
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

        // 19. operator_experiences（无 SQLite 源，从 schema.sql 种子数据回填）
        {
            log('写入 operator_experiences 种子数据...');
            const oeRows = [
                {
                    operator: 'Beau',
                    display_name: 'Beau 的运营体验',
                    description: 'Beau 专属话术体系，20天Beta计划，$200激励，DRIFTO MCN',
                    system_prompt_base: `[BASE_PROMPT]\n\n【Beau 专属规则】\n- Monthly Beta Program：20天周期，$200激励，$10/天\n- GMV里程碑庆祝：$5k / $10k GMV\n- 违规$10补偿承诺\n- 透明成本：$3/视频，$2100/月/人\n- 多账号管理（Trial / Referral）\n- DRIFTO MCN 解释：100%佣金先到 agency 再 PayPal 返还\n- 签约期仅2个月，到期自动解除`,
                    scene_config: JSON.stringify({
                        "trial_intro": "重点介绍20天Beta计划，$200激励",
                        "beta_cycle_start": "结算时明确起始日期+激励金额",
                        "violation_appeal": "提供申诉模板，承诺$10补偿",
                        "mcn_binding": "解释DRIFTO结构，透明佣金流程",
                        "gmv_milestone": "祝贺+$5k/$10k数据刺激",
                        "content_request": "5个/天最佳，超6个TikTok降权"
                    }),
                    forbidden_rules: JSON.stringify(["不提Yiyun的话术", "不承诺Beta永久持续(around May正式发布)", "不在MCN犹豫时给压力"]),
                    priority: 1
                },
                {
                    operator: 'Yiyun',
                    display_name: 'Yiyun 的运营体验',
                    description: 'Yiyun 专属话术体系，7天试用，$20月费，保守回复策略',
                    system_prompt_base: `[BASE_PROMPT]\n\n【Yiyun 专属规则】\n- 7天试用任务包，20 AI generations/day\n- $20月费：从视频补贴扣除\n- 一问一答，不过度展开，不主动延伸\n- 保守回复，不承诺不确定内容\n- 不主动发超过3条连续消息\n- 不在非工作时间（北京时间23:00后）主动联系`,
                    scene_config: JSON.stringify({
                        "trial_intro": "介绍7天试用包，20 generations/day",
                        "monthly_inquiry": "说明$20月费从视频补贴扣除",
                        "content_request": "简短回复，不主动展开话题"
                    }),
                    forbidden_rules: JSON.stringify(["不提Beta program", "不说guarantee/definitely", "不攻击其他MCN", "不发超过3条连续消息", "不在北京时间23:00后主动联系"]),
                    priority: 2
                }
            ];
            for (const row of oeRows) {
                await new Promise((resolve) => {
                    mysqlConn.query(
                        `INSERT INTO operator_experiences (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority) VALUES (?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            display_name = VALUES(display_name),
                            description = VALUES(description),
                            system_prompt_base = VALUES(system_prompt_base),
                            scene_config = VALUES(scene_config),
                            forbidden_rules = VALUES(forbidden_rules),
                            priority = VALUES(priority)`,
                        [row.operator, row.display_name, row.description, row.system_prompt_base, row.scene_config, row.forbidden_rules, row.priority],
                        (err) => {
                            if (err && err.code !***REMOVED*** 'ER_DUP_ENTRY') logError(`operator_experiences: ${err.message}`);
                            else resolve();
                        }
                    );
                });
            }
            log(`  ✓ operator_experiences (${oeRows.length} 条)`);
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
