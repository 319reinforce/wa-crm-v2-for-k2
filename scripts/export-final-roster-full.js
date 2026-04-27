#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');

const REPORT_ROOT = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(process.cwd(), 'reports');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function toCsv(rows, headers) {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((header) => csvEscape(row[header])).join(','));
    }
    return lines.join('\n');
}

function snapshotFlagExpr(field, fallbackExpr) {
    const safeField = String(field || '').replace(/[^a-zA-Z0-9_]/g, '');
    const jsonPath = `$.${safeField}`;
    return `
            CASE
                WHEN ces.compat_ev_flags_json IS NOT NULL
                 AND JSON_CONTAINS_PATH(ces.compat_ev_flags_json, 'one', '${jsonPath}') = 1
                THEN CASE
                    WHEN JSON_UNQUOTE(JSON_EXTRACT(ces.compat_ev_flags_json, '${jsonPath}')) IN ('true', '1') THEN 1
                    ELSE 0
                END
                ELSE COALESCE(${fallbackExpr}, 0)
            END AS ${safeField}`;
}

async function main() {
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(REPORT_ROOT, `final-roster-export-${runStamp}`);
    ensureDir(reportDir);

    const rows = await db.getDb().prepare(`
        SELECT
            c.id AS creator_id,
            c.primary_name,
            c.wa_phone,
            c.keeper_username,
            c.wa_owner,
            c.source,
            c.is_active,
            c.created_at AS creator_created_at,
            c.updated_at AS creator_updated_at,

            r.operator AS roster_operator,
            r.session_id,
            r.source_file AS roster_source_file,
            r.raw_poc,
            r.raw_name,
            r.raw_handle,
            r.raw_keeper_name,
            r.marketing_channel,
            r.match_strategy,
            r.score AS roster_score,
            r.is_primary AS roster_is_primary,
            r.created_at AS roster_created_at,
            r.updated_at AS roster_updated_at,

            crm.priority,
            crm.next_action,
            crm.event_score,
            crm.urgency_level,
            COALESCE(
                (SELECT ebf.billing_status FROM event_billing_facts ebf WHERE ebf.creator_id = c.id AND ebf.billing_key = 'monthly_fee' ORDER BY ebf.created_at DESC, ebf.id DESC LIMIT 1),
                crm.monthly_fee_status
            ) AS monthly_fee_status,
            COALESCE(
                (SELECT ebf.amount FROM event_billing_facts ebf WHERE ebf.creator_id = c.id AND ebf.billing_key = 'monthly_fee' ORDER BY ebf.created_at DESC, ebf.id DESC LIMIT 1),
                crm.monthly_fee_amount
            ) AS monthly_fee_amount,
            crm.monthly_fee_deducted,
            crm.beta_status,
            crm.beta_cycle_start,
            crm.beta_program_type,
            crm.agency_bound,
            crm.agency_bound_at,
            COALESCE(
                (SELECT edf.deadline_at FROM event_deadline_facts edf WHERE edf.creator_id = c.id AND edf.deadline_key = 'agency_deadline' ORDER BY edf.created_at DESC, edf.id DESC LIMIT 1),
                crm.agency_deadline
            ) AS agency_deadline,
            COALESCE(
                (SELECT epf.video_count FROM event_progress_facts epf WHERE epf.creator_id = c.id AND epf.progress_key = 'video_progress' ORDER BY epf.observed_at DESC, epf.created_at DESC, epf.id DESC LIMIT 1),
                crm.video_count
            ) AS video_count,
            COALESCE(
                (SELECT epf.video_target FROM event_progress_facts epf WHERE epf.creator_id = c.id AND epf.progress_key = 'video_progress' ORDER BY epf.observed_at DESC, epf.created_at DESC, epf.id DESC LIMIT 1),
                crm.video_target
            ) AS video_target,
            COALESCE(
                (SELECT epf.last_checked_at FROM event_progress_facts epf WHERE epf.creator_id = c.id AND epf.progress_key = 'video_progress' ORDER BY epf.observed_at DESC, epf.created_at DESC, epf.id DESC LIMIT 1),
                crm.video_last_checked
            ) AS video_last_checked,

            k.keeper_gmv,
            k.keeper_gmv30,
            k.keeper_orders,
            k.keeper_videos,
            k.keeper_videos_posted,
            k.keeper_videos_sold,
            k.keeper_card_rate,
            k.keeper_order_rate,
            k.keeper_reg_time,
            k.keeper_activate_time,
            k.last_synced AS keeper_last_synced,

            j.creator_name_jb,
            j.jb_gmv,
            j.jb_status,
            j.jb_priority,
            j.jb_next_action,
            j.last_message AS jb_last_message,
            j.days_since_msg,
            j.invite_code_jb,
            j.ev_joined,
            j.ev_ready_sent,
            ${snapshotFlagExpr('ev_trial_7day', 'j.ev_trial_7day')},
            ${snapshotFlagExpr('ev_trial_active', 'j.ev_trial_active')},
            ${snapshotFlagExpr('ev_monthly_started', 'j.ev_monthly_started')},
            j.ev_monthly_invited,
            ${snapshotFlagExpr('ev_monthly_joined', 'j.ev_monthly_joined')},
            j.ev_whatsapp_shared,
            ${snapshotFlagExpr('ev_gmv_1k', 'j.ev_gmv_1k')},
            ${snapshotFlagExpr('ev_gmv_2k', 'j.ev_gmv_2k')},
            ${snapshotFlagExpr('ev_gmv_5k', 'j.ev_gmv_5k')},
            ${snapshotFlagExpr('ev_gmv_10k', 'j.ev_gmv_10k')},
            ${snapshotFlagExpr('ev_agency_bound', 'j.ev_agency_bound')},
            ${snapshotFlagExpr('ev_churned', 'j.ev_churned')},
            j.last_synced AS joinbrands_last_synced,

            cp.summary AS profile_summary,
            cp.tags AS profile_tags,
            cp.tiktok_data AS profile_tiktok_data,
            cp.stage AS profile_stage,
            cp.last_interaction AS profile_last_interaction,
            cp.last_updated AS profile_last_updated,

            COALESCE(msg.msg_count, 0) AS total_message_count,
            msg.first_message_at,
            msg.last_message_at,
            msg.last_user_message_at,
            msg.last_me_message_at,
            msg.last_operator_message_at,

            aliases.alias_values,
            alias_counts.alias_count,
            events.active_event_count,
            events.total_event_count
        FROM operator_creator_roster r
        JOIN creators c ON c.id = r.creator_id
        LEFT JOIN wa_crm_data crm ON crm.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN creator_event_snapshot ces ON ces.creator_id = c.id
        LEFT JOIN client_profiles cp ON BINARY cp.client_id = BINARY CAST(c.id AS CHAR)
        LEFT JOIN (
            SELECT
                creator_id,
                COUNT(*) AS msg_count,
                MIN(FROM_UNIXTIME(timestamp / 1000)) AS first_message_at,
                MAX(FROM_UNIXTIME(timestamp / 1000)) AS last_message_at,
                MAX(CASE WHEN role = 'user' THEN FROM_UNIXTIME(timestamp / 1000) END) AS last_user_message_at,
                MAX(CASE WHEN role = 'me' THEN FROM_UNIXTIME(timestamp / 1000) END) AS last_me_message_at,
                MAX(CASE WHEN operator IS NOT NULL THEN FROM_UNIXTIME(timestamp / 1000) END) AS last_operator_message_at
            FROM wa_messages
            GROUP BY creator_id
        ) msg ON msg.creator_id = c.id
        LEFT JOIN (
            SELECT creator_id, GROUP_CONCAT(CONCAT(alias_type, ':', alias_value) ORDER BY alias_type, alias_value SEPARATOR ' | ') AS alias_values
            FROM creator_aliases
            GROUP BY creator_id
        ) aliases ON aliases.creator_id = c.id
        LEFT JOIN (
            SELECT creator_id, COUNT(*) AS alias_count
            FROM creator_aliases
            GROUP BY creator_id
        ) alias_counts ON alias_counts.creator_id = c.id
        LEFT JOIN (
            SELECT
                creator_id,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_event_count,
                COUNT(*) AS total_event_count
            FROM events
            GROUP BY creator_id
        ) events ON events.creator_id = c.id
        WHERE r.is_primary = 1
        ORDER BY r.operator, c.id
    `).all();

    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['empty'];
    const csvPath = path.join(reportDir, 'final-roster-full.csv');
    const summaryPath = path.join(reportDir, 'summary.json');

    fs.writeFileSync(csvPath, toCsv(rows.length ? rows : [{ empty: '' }], headers));
    fs.writeFileSync(summaryPath, JSON.stringify({
        total_roster: rows.length,
        by_operator: rows.reduce((acc, row) => {
            acc[row.roster_operator] = (acc[row.roster_operator] || 0) + 1;
            return acc;
        }, {}),
        csv: csvPath,
    }, null, 2));

    console.log(JSON.stringify({
        ok: true,
        total_roster: rows.length,
        by_operator: rows.reduce((acc, row) => {
            acc[row.roster_operator] = (acc[row.roster_operator] || 0) + 1;
            return acc;
        }, {}),
        csv: csvPath,
        summary_json: summaryPath,
        sample: rows.slice(0, 5),
    }, null, 2));
}

main()
    .catch(async (error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });
