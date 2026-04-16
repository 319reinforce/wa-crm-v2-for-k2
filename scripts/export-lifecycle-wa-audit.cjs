#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../db');

function parseJsonSafe(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toCsv(rows, headers) {
  const escape = (value) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n');
}

(async () => {
  const dbConn = db.getDb();
  const rows = await dbConn.prepare(`
    SELECT
      c.id,
      c.primary_name,
      c.wa_phone,
      c.wa_owner,
      c.source,
      cls.stage_key,
      cls.stage_label,
      cls.flags_json,
      cls.entry_reason,
      cls.option0_label,
      cls.evaluated_at
    FROM creator_lifecycle_snapshot cls
    INNER JOIN creators c ON c.id = cls.creator_id
    ORDER BY c.id ASC
  `).all();

  const normalized = rows.map((row) => {
    const flags = parseJsonSafe(row.flags_json, {});
    return {
      id: row.id,
      primary_name: row.primary_name || '',
      wa_phone: row.wa_phone || '',
      wa_owner: row.wa_owner || '',
      source: row.source || '',
      stage_key: row.stage_key || '',
      stage_label: row.stage_label || '',
      wa_joined: !!flags.wa_joined,
      referral_active: !!flags.referral_active,
      agency_bound: !!flags.agency_bound,
      trial_completed: !!flags.trial_completed,
      gmv_tier: flags.gmv_tier || '',
      entry_reason: row.entry_reason || '',
      option0_label: row.option0_label || '',
      evaluated_at: row.evaluated_at || '',
    };
  });

  const waMainline = normalized.filter((row) => row.wa_joined && row.stage_key !== 'terminated');
  const referralOverlay = normalized.filter((row) => row.wa_joined && row.referral_active);
  const stageCounts = waMainline.reduce((acc, row) => {
    acc[row.stage_key] = (acc[row.stage_key] || 0) + 1;
    return acc;
  }, {});

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(process.cwd(), 'docs/exports');
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, `lifecycle-wa-audit-${stamp}.md`);
  const csvMainPath = path.join(outDir, `lifecycle-wa-mainline-${stamp}.csv`);
  const csvReferralPath = path.join(outDir, `lifecycle-referral-overlay-${stamp}.csv`);

  const md = [
    '# Lifecycle WA Audit',
    '',
    `- Exported at: ${new Date().toISOString()}`,
    `- WA mainline count: ${waMainline.length}`,
    `- Referral overlay count: ${referralOverlay.length}`,
    `- Stage counts: acquisition=${stageCounts.acquisition || 0}, activation=${stageCounts.activation || 0}, retention=${stageCounts.retention || 0}, revenue=${stageCounts.revenue || 0}, terminated=${stageCounts.terminated || 0}`,
    '',
    '## WA Mainline',
    '',
    '| id | name | owner | stage | referral | agency | trial_completed | gmv_tier |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...waMainline.map((row) => `| ${row.id} | ${row.primary_name.replace(/\|/g, '\\|')} | ${row.wa_owner} | ${row.stage_key} | ${row.referral_active ? 'yes' : 'no'} | ${row.agency_bound ? 'yes' : 'no'} | ${row.trial_completed ? 'yes' : 'no'} | ${row.gmv_tier} |`),
    '',
    '## Referral Overlay',
    '',
    '| id | name | owner | stage | agency | gmv_tier |',
    '| --- | --- | --- | --- | --- | --- |',
    ...referralOverlay.map((row) => `| ${row.id} | ${row.primary_name.replace(/\|/g, '\\|')} | ${row.wa_owner} | ${row.stage_key} | ${row.agency_bound ? 'yes' : 'no'} | ${row.gmv_tier} |`),
    '',
  ].join('\n');

  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(csvMainPath, toCsv(waMainline, ['id', 'primary_name', 'wa_phone', 'wa_owner', 'source', 'stage_key', 'stage_label', 'referral_active', 'agency_bound', 'trial_completed', 'gmv_tier', 'entry_reason', 'option0_label', 'evaluated_at']));
  fs.writeFileSync(csvReferralPath, toCsv(referralOverlay, ['id', 'primary_name', 'wa_phone', 'wa_owner', 'source', 'stage_key', 'stage_label', 'agency_bound', 'trial_completed', 'gmv_tier', 'entry_reason', 'option0_label', 'evaluated_at']));

  console.log(JSON.stringify({
    ok: true,
    mdPath,
    csvMainPath,
    csvReferralPath,
    waMainlineCount: waMainline.length,
    referralOverlayCount: referralOverlay.length,
    stageCounts,
  }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
