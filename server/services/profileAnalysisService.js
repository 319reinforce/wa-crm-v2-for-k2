const db = require('../../db');
const { publishSse } = require('./realtimeBus');
const creatorCache = require('./creatorCache');
const { rebuildReplyStrategyForClient } = require('./replyStrategyService');

const STRONG_SIGNAL_REGEX = /\b(how|can i|price|try)\b/i;
const TRIGGER_THRESHOLD = 5;
const FALLBACK_HOURS = 48;
let schemaEnsured = false;
const REQUIRED_PROFILE_ANALYSIS_TABLES = [
    'profile_analysis_state',
    'client_profile_snapshots',
    'client_profile_change_events',
];

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function clampConfidence(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(3, Math.round(n)));
}

function normalizeField(value, allowed = []) {
    const v = String(value || '').trim().toLowerCase();
    return allowed.includes(v) ? v : null;
}

function buildHeuristicResult(messages = []) {
    const texts = messages.map((m) => String(m.text || '')).join('\n').toLowerCase();
    const lastUserMsg = [...messages].reverse().find((m) => m.role !== 'me')?.text || '';
    const userCount = messages.filter((m) => m.role !== 'me').length;

    const frequency = userCount >= 8 ? 'high' : (userCount >= 3 ? 'medium' : 'low');
    const difficulty = /(what do you mean|not understand|不懂|解释|why)/i.test(texts) ? 'high' : 'medium';
    const intent = /\b(how|can i|where|try)\b/i.test(texts) ? 'strong' : (/\b(interesting|interested|cool)\b/i.test(texts) ? 'medium' : 'weak');
    const emotion = /(love|great|excited|nice|awesome|谢谢|太好了)/i.test(texts)
        ? 'positive'
        : (/(scam|expensive|too much|不信|质疑|麻烦)/i.test(texts) ? 'negative' : 'neutral');

    const motivationPositive = [];
    if (/(commission|佣金|赚)/i.test(texts)) motivationPositive.push('想赚佣金');
    if (/(subsidy|补贴|bonus)/i.test(texts)) motivationPositive.push('想赚补贴');
    if (/(ai tool|ai|automation)/i.test(texts)) motivationPositive.push('想使用ai工具');
    if (/(monetize|变现|gmv)/i.test(texts)) motivationPositive.push('账号变现');

    const painPoints = [];
    if (/(edit|剪辑|不会剪)/i.test(texts)) painPoints.push('不会剪辑');
    if (/(no time|没时间|busy)/i.test(texts)) painPoints.push('没时间做内容');
    if (/(unstable|不稳定|波动)/i.test(texts)) painPoints.push('内容不稳定');
    if (/(price|贵|cost)/i.test(texts)) painPoints.push('价格敏感');
    if (/(choose product|选品|product pick)/i.test(texts)) painPoints.push('不会选品');

    const evidence = String(lastUserMsg || '').slice(0, 180);
    const summary = `沟通频次${frequency}，沟通意愿${intent}，情绪${emotion}。`;

    return {
        frequency: { value: frequency, confidence: 2, evidence },
        difficulty: { value: difficulty, confidence: 2, evidence },
        intent: { value: intent, confidence: 2, evidence },
        emotion: { value: emotion, confidence: 2, evidence },
        motivation_positive: { value: motivationPositive, confidence: 2, evidence },
        pain_points: { value: painPoints, confidence: 2, evidence },
        summary,
    };
}

async function analyzeWithLLM(messages = [], owner = 'Beau') {
    const USE_OPENAI = process.env.USE_OPENAI === 'true';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

    const convo = messages.slice(-30).map((m) => {
        const role = m.role === 'me' ? owner : 'Creator';
        return `[${role}] ${String(m.text || '').replace(/\n+/g, ' ').slice(0, 300)}`;
    }).join('\n');

    const schemaPrompt = `你是CRM画像分析器。请基于对话输出JSON，不要输出其他文字。
字段:
{
 "frequency":{"value":"high|medium|low","confidence":1-3,"evidence":"最近消息片段"},
 "difficulty":{"value":"high|medium|low","confidence":1-3,"evidence":"最近消息片段"},
 "intent":{"value":"strong|medium|weak","confidence":1-3,"evidence":"最近消息片段"},
 "emotion":{"value":"positive|neutral|negative","confidence":1-3,"evidence":"最近消息片段"},
 "motivation_positive":{"value":["想赚佣金","想赚补贴","想使用ai工具","账号变现"],"confidence":1-3,"evidence":"最近消息片段"},
 "pain_points":{"value":["不会剪辑","没时间做内容","内容不稳定","起号困难","流量不可复制","价格敏感","不会选品"],"confidence":1-3,"evidence":"最近消息片段"},
 "summary":"100字以内总结"
}
要求:
1) 只根据对话，不臆测
2) 未出现可返回空数组
3) evidence必须引用最近消息语义`;

    let raw = '';
    if (USE_OPENAI && OPENAI_API_KEY) {
        const { generateResponseFor } = require('../utils/openai');
        raw = await generateResponseFor(
            'profile-analysis',
            [
                { role: 'system', content: schemaPrompt },
                { role: 'user', content: convo },
            ],
            {
                temperature: 0.2,
                maxTokens: 1000,
                source: 'profileAnalysisService.analyzeWithLLM',
            }
        );
    } else if (MINIMAX_API_KEY) {
        const resp = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                'x-api-key': MINIMAX_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'mini-max-typing',
                temperature: 0.2,
                max_tokens: 1000,
                messages: [{ role: 'user', content: `${schemaPrompt}\n\n${convo}` }],
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) throw new Error(`MiniMax error ${resp.status}`);
        const data = await resp.json();
        raw = data?.content?.find((c) => c.type === 'text')?.text || '';
    } else {
        throw new Error('No LLM API key configured');
    }

    const cleaned = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM returned non-JSON profile payload');
    return JSON.parse(match[0]);
}

function normalizeProfilePayload(payload = {}) {
    const safeArray = (v) => Array.isArray(v) ? v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
    const frequencyValue = normalizeField(payload?.frequency?.value, ['high', 'medium', 'low']);
    const difficultyValue = normalizeField(payload?.difficulty?.value, ['high', 'medium', 'low']);
    const intentValue = normalizeField(payload?.intent?.value, ['strong', 'medium', 'weak']);
    const emotionValue = normalizeField(payload?.emotion?.value, ['positive', 'neutral', 'negative']);

    return {
        frequency: {
            value: frequencyValue,
            confidence: clampConfidence(payload?.frequency?.confidence),
            evidence: String(payload?.frequency?.evidence || '').slice(0, 250),
        },
        difficulty: {
            value: difficultyValue,
            confidence: clampConfidence(payload?.difficulty?.confidence),
            evidence: String(payload?.difficulty?.evidence || '').slice(0, 250),
        },
        intent: {
            value: intentValue,
            confidence: clampConfidence(payload?.intent?.confidence),
            evidence: String(payload?.intent?.evidence || '').slice(0, 250),
        },
        emotion: {
            value: emotionValue,
            confidence: clampConfidence(payload?.emotion?.confidence),
            evidence: String(payload?.emotion?.evidence || '').slice(0, 250),
        },
        motivation_positive: {
            value: safeArray(payload?.motivation_positive?.value),
            confidence: clampConfidence(payload?.motivation_positive?.confidence),
            evidence: String(payload?.motivation_positive?.evidence || '').slice(0, 250),
        },
        pain_points: {
            value: safeArray(payload?.pain_points?.value),
            confidence: clampConfidence(payload?.pain_points?.confidence),
            evidence: String(payload?.pain_points?.evidence || '').slice(0, 250),
        },
        summary: String(payload?.summary || '').slice(0, 500),
    };
}

function diffProfiles(oldProfile = null, newProfile = null) {
    if (!newProfile) return [];
    const changed = [];
    const fields = ['frequency', 'difficulty', 'intent', 'emotion'];
    fields.forEach((field) => {
        const prev = oldProfile?.[field]?.value || null;
        const next = newProfile?.[field]?.value || null;
        if (prev !== next && next) {
            changed.push({
                field,
                old: prev,
                new: next,
                confidence: newProfile[field].confidence,
                evidence: newProfile[field].evidence || '',
            });
        }
    });

    const oldMotivation = JSON.stringify(oldProfile?.motivation_positive?.value || []);
    const newMotivation = JSON.stringify(newProfile?.motivation_positive?.value || []);
    if (oldMotivation !== newMotivation) {
        changed.push({
            field: 'motivation_positive',
            old: oldProfile?.motivation_positive?.value || [],
            new: newProfile?.motivation_positive?.value || [],
            confidence: newProfile?.motivation_positive?.confidence || 1,
            evidence: newProfile?.motivation_positive?.evidence || '',
        });
    }

    const oldPain = JSON.stringify(oldProfile?.pain_points?.value || []);
    const newPain = JSON.stringify(newProfile?.pain_points?.value || []);
    if (oldPain !== newPain) {
        changed.push({
            field: 'pain_points',
            old: oldProfile?.pain_points?.value || [],
            new: newProfile?.pain_points?.value || [],
            confidence: newProfile?.pain_points?.confidence || 1,
            evidence: newProfile?.pain_points?.evidence || '',
        });
    }

    return changed;
}

async function ensureStateRow(clientId) {
    await ensureProfileAnalysisSchema();
    const db2 = db.getDb();
    await db2.prepare(
        'INSERT IGNORE INTO profile_analysis_state (client_id, pending_unanalyzed_count) VALUES (?, 0)'
    ).run(clientId);
}

async function ensureProfileAnalysisSchema() {
    if (schemaEnsured) return;
    const db2 = db.getDb();
    const rows = await db2.prepare(`
        SELECT TABLE_NAME AS table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${REQUIRED_PROFILE_ANALYSIS_TABLES.map(() => '?').join(', ')})
    `).all(...REQUIRED_PROFILE_ANALYSIS_TABLES);
    const existing = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_PROFILE_ANALYSIS_TABLES.filter((table) => !existing.has(table));
    if (missing.length > 0) {
        throw new Error(`Profile analysis schema is missing ${missing.join(', ')}; run server/migrations/006_managed_runtime_tables.sql`);
    }

    schemaEnsured = true;
}

async function getClientByIdOrPhone({ creatorId = null, clientId = null }) {
    const db2 = db.getDb();
    if (creatorId) {
        return await creatorCache.getCreator(db2, creatorId, 'id, wa_phone, wa_owner, primary_name');
    }
    if (clientId) {
        return await creatorCache.getCreatorByPhone(db2, clientId, 'id, wa_phone, wa_owner, primary_name');
    }
    return null;
}

async function fetchRecentMessages(creatorId, limit = 30) {
    const db2 = db.getDb();
    const rows = await db2.prepare(
        `SELECT role, text, timestamp FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT ${Math.max(5, Math.min(limit, 80))}`
    ).all(creatorId);
    return rows.reverse();
}

async function getLatestSnapshot(clientId) {
    const db2 = db.getDb();
    const row = await db2.prepare(
        'SELECT * FROM client_profile_snapshots WHERE client_id = ? ORDER BY id DESC LIMIT 1'
    ).get(clientId);
    if (!row) return null;
    return {
        id: row.id,
        frequency: { value: row.frequency_level, confidence: row.frequency_conf, evidence: row.frequency_evidence || '' },
        difficulty: { value: row.difficulty_level, confidence: row.difficulty_conf, evidence: row.difficulty_evidence || '' },
        intent: { value: row.intent_level, confidence: row.intent_conf, evidence: row.intent_evidence || '' },
        emotion: { value: row.emotion_level, confidence: row.emotion_conf, evidence: row.emotion_evidence || '' },
        motivation_positive: { value: parseJsonSafe(row.motivation_positive, []), confidence: row.motivation_conf, evidence: row.motivation_evidence || '' },
        pain_points: { value: parseJsonSafe(row.pain_points, []), confidence: row.pain_conf, evidence: row.pain_evidence || '' },
        summary: row.summary || '',
    };
}

function snapshotRowToProfile(row) {
    if (!row) return null;
    return {
        frequency: { value: row.frequency_level || null, confidence: row.frequency_conf || 1, evidence: row.frequency_evidence || '' },
        difficulty: { value: row.difficulty_level || null, confidence: row.difficulty_conf || 1, evidence: row.difficulty_evidence || '' },
        intent: { value: row.intent_level || null, confidence: row.intent_conf || 1, evidence: row.intent_evidence || '' },
        emotion: { value: row.emotion_level || null, confidence: row.emotion_conf || 1, evidence: row.emotion_evidence || '' },
        motivation_positive: { value: parseJsonSafe(row.motivation_positive, []), confidence: row.motivation_conf || 1, evidence: row.motivation_evidence || '' },
        pain_points: { value: parseJsonSafe(row.pain_points, []), confidence: row.pain_conf || 1, evidence: row.pain_evidence || '' },
        summary: row.summary || '',
    };
}

async function insertSnapshot(clientId, profile, source = 'system') {
    const db2 = db.getDb();
    const result = await db2.prepare(`
        INSERT INTO client_profile_snapshots
        (client_id, frequency_level, frequency_conf, frequency_evidence,
         difficulty_level, difficulty_conf, difficulty_evidence,
         intent_level, intent_conf, intent_evidence,
         emotion_level, emotion_conf, emotion_evidence,
         motivation_positive, motivation_conf, motivation_evidence,
         pain_points, pain_conf, pain_evidence, summary, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        clientId,
        profile.frequency.value, profile.frequency.confidence, profile.frequency.evidence,
        profile.difficulty.value, profile.difficulty.confidence, profile.difficulty.evidence,
        profile.intent.value, profile.intent.confidence, profile.intent.evidence,
        profile.emotion.value, profile.emotion.confidence, profile.emotion.evidence,
        JSON.stringify(profile.motivation_positive.value || []), profile.motivation_positive.confidence, profile.motivation_positive.evidence,
        JSON.stringify(profile.pain_points.value || []), profile.pain_points.confidence, profile.pain_points.evidence,
        profile.summary || null,
        source
    );
    return result.lastInsertRowid;
}

async function applySnapshotToClientProfile(clientId, snapshotId) {
    const db2 = db.getDb();
    const snapshot = await db2.prepare(
        'SELECT summary, pain_points, motivation_positive FROM client_profile_snapshots WHERE id = ?'
    ).get(snapshotId);
    if (!snapshot) return;
    const summary = snapshot.summary || '';
    const updated = await db2.prepare(
        'UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
    ).run(summary, clientId);
    if (updated.changes === 0) {
        await db2.prepare(
            'INSERT INTO client_profiles (client_id, summary) VALUES (?, ?)'
        ).run(clientId, summary);
    }
}

async function runProfileAnalysis({ clientId, triggerType = 'manual', triggerText = '' }) {
    await ensureProfileAnalysisSchema();
    const client = await getClientByIdOrPhone({ clientId });
    if (!client) {
        return { ok: false, reason: 'client_not_found' };
    }

    await ensureStateRow(client.wa_phone);
    const messages = await fetchRecentMessages(client.id, 30);
    if (messages.length === 0) {
        return { ok: false, reason: 'no_messages' };
    }

    let normalized;
    try {
        const llm = await analyzeWithLLM(messages, client.wa_owner || 'Beau');
        normalized = normalizeProfilePayload(llm);
    } catch (_) {
        normalized = buildHeuristicResult(messages);
    }

    const oldSnapshot = await getLatestSnapshot(client.wa_phone);
    const changes = diffProfiles(oldSnapshot, normalized);
    const newSnapshotId = await insertSnapshot(client.wa_phone, normalized, 'system');

    const db2 = db.getDb();
    const eventResult = await db2.prepare(`
        INSERT INTO client_profile_change_events
        (client_id, old_snapshot_id, new_snapshot_id, status, change_summary, trigger_type, trigger_text)
        VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(
        client.wa_phone,
        oldSnapshot?.id || null,
        newSnapshotId,
        JSON.stringify({ changed_fields: changes }),
        triggerType,
        triggerText || null
    );

    await db2.prepare(`
        UPDATE profile_analysis_state
        SET pending_unanalyzed_count = 0,
            last_profile_analyzed_at = NOW(),
            last_analyzed_message_ts = ?,
            updated_at = NOW()
        WHERE client_id = ?
    `).run(messages[messages.length - 1]?.timestamp || null, client.wa_phone);

    publishSse('profile-change-detected', {
        change_event_id: eventResult.lastInsertRowid,
        client_id: client.wa_phone,
        creator_id: client.id,
        creator_name: client.primary_name || null,
        trigger_type: triggerType,
        changed_count: changes.length,
    });

    return {
        ok: true,
        change_event_id: eventResult.lastInsertRowid,
        new_snapshot_id: newSnapshotId,
        changed_count: changes.length,
    };
}

async function registerIncomingMessages({ creatorId = null, clientId = null, insertedCount = 0, sampleText = '' }) {
    await ensureProfileAnalysisSchema();
    const client = await getClientByIdOrPhone({ creatorId, clientId });
    if (!client) return { ok: false, reason: 'client_not_found' };

    await ensureStateRow(client.wa_phone);
    const db2 = db.getDb();
    await db2.prepare(
        'UPDATE profile_analysis_state SET pending_unanalyzed_count = pending_unanalyzed_count + ?, updated_at = NOW() WHERE client_id = ?'
    ).run(Math.max(0, Number(insertedCount) || 0), client.wa_phone);

    const state = await db2.prepare(
        'SELECT pending_unanalyzed_count, last_profile_analyzed_at FROM profile_analysis_state WHERE client_id = ?'
    ).get(client.wa_phone);
    const pending = Number(state?.pending_unanalyzed_count || 0);
    const signal = STRONG_SIGNAL_REGEX.test(String(sampleText || ''));
    let triggerType = null;
    if (pending >= TRIGGER_THRESHOLD) triggerType = 'count_5';
    if (!triggerType && signal) triggerType = 'strong_signal';
    if (!triggerType) return { ok: true, triggered: false, pending_count: pending };

    const analyzed = await runProfileAnalysis({
        clientId: client.wa_phone,
        triggerType,
        triggerText: String(sampleText || '').slice(0, 180),
    });
    return { ok: true, triggered: true, trigger_type: triggerType, pending_count: pending, analyzed };
}

async function runFallbackAnalysisScan() {
    await ensureProfileAnalysisSchema();
    const db2 = db.getDb();
    await db2.prepare(`
        INSERT IGNORE INTO profile_analysis_state (client_id, pending_unanalyzed_count)
        SELECT wa_phone, 0 FROM creators WHERE wa_phone IS NOT NULL AND wa_phone <> ''
    `).run();
    const rows = await db2.prepare(`
        SELECT pas.client_id
        FROM profile_analysis_state pas
        WHERE pas.last_profile_analyzed_at IS NULL
           OR pas.last_profile_analyzed_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY pas.last_profile_analyzed_at ASC
        LIMIT 30
    `).all(FALLBACK_HOURS);

    const result = { scanned: rows.length, triggered: 0, failed: 0 };
    for (const row of rows) {
        try {
            const ret = await runProfileAnalysis({
                clientId: row.client_id,
                triggerType: 'fallback_48h',
                triggerText: 'fallback_48h_scheduler',
            });
            if (ret?.ok) result.triggered++;
            else result.failed++;
        } catch (_) {
            result.failed++;
        }
    }
    return result;
}

async function listPendingChanges({ limit = 50, clientId = null }) {
    await ensureProfileAnalysisSchema();
    const db2 = db.getDb();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const where = clientId ? 'WHERE e.status = \'pending\' AND e.client_id = ?' : 'WHERE e.status = \'pending\'';
    const rows = clientId
        ? await db2.prepare(`
            SELECT e.*, c.id AS creator_id, c.primary_name AS creator_name
            FROM client_profile_change_events e
            LEFT JOIN creators c ON c.wa_phone = e.client_id
            ${where}
            ORDER BY e.created_at DESC
            LIMIT ${safeLimit}
        `).all(clientId)
        : await db2.prepare(`
            SELECT e.*, c.id AS creator_id, c.primary_name AS creator_name
            FROM client_profile_change_events e
            LEFT JOIN creators c ON c.wa_phone = e.client_id
            ${where}
            ORDER BY e.created_at DESC
            LIMIT ${safeLimit}
        `).all();

    const db2b = db.getDb();
    const enriched = [];
    for (const row of rows) {
        const newSnapRow = await db2b.prepare(
            'SELECT * FROM client_profile_snapshots WHERE id = ?'
        ).get(row.new_snapshot_id);
        const oldSnapRow = row.old_snapshot_id
            ? await db2b.prepare('SELECT * FROM client_profile_snapshots WHERE id = ?').get(row.old_snapshot_id)
            : null;
        enriched.push({
            ...row,
            change_summary: parseJsonSafe(row.change_summary, { changed_fields: [] }),
            new_profile: snapshotRowToProfile(newSnapRow),
            old_profile: snapshotRowToProfile(oldSnapRow),
        });
    }
    return enriched;
}

async function reviewChange({ changeEventId, action, reviewedBy = 'operator', note = '', edited = null }) {
    await ensureProfileAnalysisSchema();
    const db2 = db.getDb();
    const event = await db2.prepare(
        'SELECT * FROM client_profile_change_events WHERE id = ?'
    ).get(changeEventId);
    if (!event) return { ok: false, reason: 'not_found' };
    if (event.status !== 'pending') return { ok: false, reason: 'already_reviewed' };

    let finalSnapshotId = event.new_snapshot_id;
    let finalStatus = 'accepted';
    if (action === 'reject') {
        finalStatus = 'rejected';
    } else if (action === 'edit') {
        const newSnap = await db2.prepare('SELECT * FROM client_profile_snapshots WHERE id = ?').get(event.new_snapshot_id);
        if (!newSnap) return { ok: false, reason: 'snapshot_not_found' };
        const merged = {
            frequency: { value: normalizeField(edited?.frequency?.value || newSnap.frequency_level, ['high', 'medium', 'low']), confidence: clampConfidence(edited?.frequency?.confidence || newSnap.frequency_conf), evidence: String(edited?.frequency?.evidence || newSnap.frequency_evidence || '') },
            difficulty: { value: normalizeField(edited?.difficulty?.value || newSnap.difficulty_level, ['high', 'medium', 'low']), confidence: clampConfidence(edited?.difficulty?.confidence || newSnap.difficulty_conf), evidence: String(edited?.difficulty?.evidence || newSnap.difficulty_evidence || '') },
            intent: { value: normalizeField(edited?.intent?.value || newSnap.intent_level, ['strong', 'medium', 'weak']), confidence: clampConfidence(edited?.intent?.confidence || newSnap.intent_conf), evidence: String(edited?.intent?.evidence || newSnap.intent_evidence || '') },
            emotion: { value: normalizeField(edited?.emotion?.value || newSnap.emotion_level, ['positive', 'neutral', 'negative']), confidence: clampConfidence(edited?.emotion?.confidence || newSnap.emotion_conf), evidence: String(edited?.emotion?.evidence || newSnap.emotion_evidence || '') },
            motivation_positive: { value: Array.isArray(edited?.motivation_positive?.value) ? edited.motivation_positive.value : parseJsonSafe(newSnap.motivation_positive, []), confidence: clampConfidence(edited?.motivation_positive?.confidence || newSnap.motivation_conf), evidence: String(edited?.motivation_positive?.evidence || newSnap.motivation_evidence || '') },
            pain_points: { value: Array.isArray(edited?.pain_points?.value) ? edited.pain_points.value : parseJsonSafe(newSnap.pain_points, []), confidence: clampConfidence(edited?.pain_points?.confidence || newSnap.pain_conf), evidence: String(edited?.pain_points?.evidence || newSnap.pain_evidence || '') },
            summary: String(edited?.summary || newSnap.summary || ''),
        };
        finalSnapshotId = await insertSnapshot(event.client_id, merged, 'manual');
        finalStatus = 'edited';
    }

    await db2.prepare(`
        UPDATE client_profile_change_events
        SET status = ?, reviewed_by = ?, reviewed_note = ?, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ?
    `).run(finalStatus, reviewedBy, note || null, changeEventId);

    let strategyRebuild = null;
    if (finalStatus === 'accepted' || finalStatus === 'edited') {
        await applySnapshotToClientProfile(event.client_id, finalSnapshotId);
        try {
            strategyRebuild = await rebuildReplyStrategyForClient({
                clientId: event.client_id,
                trigger: finalStatus === 'edited' ? 'profile_change_edited' : 'profile_change_accepted',
                allowSoftAdjust: true,
            });
        } catch (e) {
            strategyRebuild = { ok: false, reason: e.message };
        }
    }

    publishSse('profile-change-reviewed', {
        change_event_id: changeEventId,
        client_id: event.client_id,
        status: finalStatus,
        reviewed_by: reviewedBy,
    });

    return { ok: true, status: finalStatus, snapshot_id: finalSnapshotId, reply_strategy: strategyRebuild };
}

module.exports = {
    STRONG_SIGNAL_REGEX,
    TRIGGER_THRESHOLD,
    FALLBACK_HOURS,
    runProfileAnalysis,
    registerIncomingMessages,
    runFallbackAnalysisScan,
    listPendingChanges,
    reviewChange,
};
