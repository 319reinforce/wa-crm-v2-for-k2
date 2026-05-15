import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const scanRoots = ['server/routes', 'server/services']
const joinPattern = /\b(?:LEFT|RIGHT|INNER|OUTER|CROSS)\s+JOIN\b|\bJOIN\s+(?:[`A-Za-z_$({])/

const historicalJoinAllowlist = new Set([
  'server/routes/audit.js::ownerJoin = \'LEFT JOIN creators c ON c.wa_phone = gl.client_id\';',
  'server/routes/audit.js::LEFT JOIN retrieval_snapshot rs ON rs.id = gl.retrieval_snapshot_id',
  'server/routes/audit.js::joinClause = \'LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))\';',
  'server/routes/audit.js::joinClause = \'LEFT JOIN creators c ON c.wa_phone = sf.client_id\';',
  'server/routes/audit.js::LEFT JOIN creators c ON c.wa_phone = gl.client_id',
  'server/routes/audit.js::LEFT JOIN creators c ON c.wa_phone = rs.client_id',
  'server/routes/creators.js::LEFT JOIN wa_messages wm ON wm.creator_id = c.id',
  'server/routes/creators.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/routes/creators.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/routes/creators.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/routes/creators.js::${rosterOnly ? `INNER JOIN ${ROSTER_TABLE} ocr ON ocr.creator_id = c.id AND ocr.is_primary = 1` : \'\'}',
  'server/routes/events.js::LEFT JOIN creators c ON c.id = e.creator_id',
  'server/routes/events.js::LEFT JOIN creators c ON c.id = cur.creator_id',
  'server/routes/events.js::JOIN creators c ON c.id = e.creator_id',
  'server/routes/experience.js::LEFT JOIN wa_messages wm ON wm.creator_id = c.id',
  'server/routes/experience.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/routes/experience.js::FROM creators c LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/routes/messages.js::LEFT JOIN media_assets ma',
  'server/routes/operatorRoster.js::JOIN creators c ON c.id = r.creator_id',
  'server/routes/operatorRoster.js::JOIN ${ROSTER_TABLE} r ON r.creator_id = e.creator_id',
  'server/routes/operatorRoster.js::JOIN creators c ON c.id = e.creator_id',
  'server/routes/profile.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/routes/profile.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/routes/sft.js::LEFT JOIN creators c',
  'server/routes/stats.js::? `INNER JOIN ${ROSTER_TABLE} ocr ON ocr.creator_id = c.id AND ocr.is_primary = 1`',
  'server/routes/stats.js::? `INNER JOIN ${ROSTER_TABLE} ocr2 ON ocr2.creator_id = c2.id AND ocr2.is_primary = 1`',
  'server/routes/stats.js::? `INNER JOIN ${ROSTER_TABLE} ocr3 ON ocr3.creator_id = c3.id AND ocr3.is_primary = 1`',
  'server/routes/stats.js::INNER JOIN creators c2 ON c2.id = wm.creator_id',
  'server/routes/stats.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/routes/stats.js::LEFT JOIN creator_event_snapshot ces ON ces.creator_id = c.id',
  'server/routes/stats.js::INNER JOIN creators c ON c.id = wc.creator_id',
  'server/routes/stats.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/routes/stats.js::INNER JOIN creators c ON c.id = e.creator_id',
  'server/routes/stats.js::LEFT JOIN creators c3',
  'server/routes/v1Board.js::JOIN wa_messages wm ON wm.creator_id = c.id',
  'server/routes/v1Board.js::JOIN wa_crm_data w ON w.creator_id = c.id',
  'server/routes/v1Board.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/routes/v1Board.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/routes/v1Board.js::INNER JOIN creators c ON c.id = cls.creator_id',
  'server/routes/wa.js::JOIN creators c ON c.id = wm.creator_id',
  'server/routes/wa.js::LEFT JOIN creators c ON c.id = ma.creator_id',
  'server/services/activeEventDetectionService.js::JOIN wa_messages wm ON wm.creator_id = c.id',
  'server/services/activeEventDetectionService.js::LEFT JOIN event_detection_cursor cur ON cur.creator_id = c.id',
  'server/services/canonicalCreatorResolver.js::JOIN creators c ON c.id = r.creator_id',
  'server/services/canonicalCreatorResolver.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/services/canonicalCreatorResolver.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/services/canonicalCreatorResolver.js::LEFT JOIN creator_aliases a ON a.creator_id = c.id',
  'server/services/canonicalCreatorResolver.js::LEFT JOIN wa_messages wm ON wm.creator_id = c.id',
  'server/services/groupMessageService.js::JOIN wa_group_chats gc ON gc.id = gm.group_chat_id',
  'server/services/groupMessageService.js::LEFT JOIN wa_group_messages gm ON gm.group_chat_id = gc.id',
  'server/services/lifecycleDashboardService.js::INNER JOIN creators c ON c.id = cls.creator_id',
  'server/services/lifecyclePersistenceService.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/services/lifecyclePersistenceService.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/services/lifecyclePersistenceService.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/services/mediaCleanupService.js::LEFT JOIN cleanup_exemptions ce ON ce.media_asset_id = ma.id',
  'server/services/operatorRosterService.js::JOIN creators c ON c.id = r.creator_id',
  'server/services/profileAnalysisService.js::JOIN creators c ON c.wa_phone = pas.client_id',
  'server/services/profileAnalysisService.js::LEFT JOIN creators c ON c.wa_phone = e.client_id',
  'server/services/profileService.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/services/profileService.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/services/replyStrategyService.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/services/replyStrategyService.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/services/replyStrategyService.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/services/retrievalService.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/services/sftService.js::LEFT JOIN creators c',
  'server/services/sftService.js::LEFT JOIN creators c ON c.wa_phone = sf.client_id',
  'server/services/singleCreatorChurnAnalysisService.js::LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id',
  'server/services/singleCreatorChurnAnalysisService.js::LEFT JOIN keeper_link k ON k.creator_id = c.id',
  'server/services/singleCreatorChurnAnalysisService.js::LEFT JOIN joinbrands_link j ON j.creator_id = c.id',
  'server/services/userSessionRepo.js::JOIN users u ON u.id = s.user_id',
  'server/services/waMessageRepairService.js::JOIN wa_messages m2',
])

function listJsFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listJsFiles(abs))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(abs)
  }
  return files
}

test('runtime business code does not add unreviewed multi-table JOINs', () => {
  const violations = []
  for (const root of scanRoots) {
    for (const file of listJsFiles(join(repoRoot, root))) {
      const rel = relative(repoRoot, file)
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('//') || !joinPattern.test(trimmed)) return
        const key = `${rel}::${trimmed}`
        if (!historicalJoinAllowlist.has(key)) violations.push(`${rel}:${index + 1}: ${trimmed}`)
      })
    }
  }

  assert.deepEqual(violations, [])
})

test('audit evaluation summary builders stay JOIN-free', () => {
  const source = readFileSync(join(repoRoot, 'server/routes/audit.js'), 'utf8')
  const abBody = source.match(/async function buildAbEvaluationSummary[\s\S]*?\n}\n\nfunction incrementCountBucket/)?.[0] || ''
  const generationBody = source.match(/async function buildGenerationStatsSummary[\s\S]*?\n}\n\nasync function fetchGenerationLogDetail/)?.[0] || ''

  assert.ok(abBody, 'buildAbEvaluationSummary body should be found')
  assert.ok(generationBody, 'buildGenerationStatsSummary body should be found')
  assert.doesNotMatch(abBody, joinPattern)
  assert.doesNotMatch(generationBody, joinPattern)
})
