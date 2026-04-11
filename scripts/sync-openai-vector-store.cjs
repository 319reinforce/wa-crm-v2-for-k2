#!/usr/bin/env node
/**
 * 将 knowledge-manifest 中的知识源同步到 OpenAI Vector Store
 *
 * 用法：
 *   npm run rag:sync
 *   npm run rag:sync -- --dry-run
 *   npm run rag:sync -- --include-draft
 *   npm run rag:sync -- --create-store="wa-crm-rag-prod"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const DEFAULT_MANIFEST_PATH = process.env.KNOWLEDGE_MANIFEST_PATH || 'docs/rag/knowledge-manifest.json';
const DEFAULT_STATE_PATH = process.env.OPENAI_VECTOR_SYNC_STATE_PATH || 'docs/rag/.openai-vector-sync-state.json';

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        dryRun: false,
        includeDraft: false,
        manifestPath: DEFAULT_MANIFEST_PATH,
        statePath: DEFAULT_STATE_PATH,
        createStoreName: '',
    };
    for (const arg of args) {
        if (arg ***REMOVED***= '--dry-run') out.dryRun = true;
        else if (arg ***REMOVED***= '--include-draft') out.includeDraft = true;
        else if (arg.startsWith('--manifest=')) out.manifestPath = arg.slice('--manifest='.length);
        else if (arg.startsWith('--state=')) out.statePath = arg.slice('--state='.length);
        else if (arg.startsWith('--create-store=')) out.createStoreName = arg.slice('--create-store='.length);
    }
    return out;
}

function ensureOpenAIConfig() {
    if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY missing');
    }
}

function sha256Buffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeReadJson(absPath, fallback) {
    if (!fs.existsSync(absPath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    } catch (_) {
        return fallback;
    }
}

function safeWriteJson(absPath, payload) {
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(payload, null, 2) + '\n');
}

async function openaiJson(pathname, init = {}) {
    ensureOpenAIConfig();
    const response = await fetch(`${OPENAI_API_BASE}${pathname}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            ...(init.headers || {}),
        },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI ${pathname} failed: ${detail}`);
    }
    return payload;
}

async function openaiMultipart(pathname, form) {
    ensureOpenAIConfig();
    const response = await fetch(`${OPENAI_API_BASE}${pathname}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI ${pathname} failed: ${detail}`);
    }
    return payload;
}

async function createVectorStore(name) {
    return openaiJson('/vector_stores', {
        method: 'POST',
        body: JSON.stringify({ name: name || `wa-crm-rag-${Date.now()}` }),
    });
}

async function uploadFile(absPath) {
    const filename = path.basename(absPath);
    const bytes = fs.readFileSync(absPath);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', blob, filename);
    return openaiMultipart('/files', form);
}

async function attachFileToVectorStore(vectorStoreId, fileId, attributes = {}) {
    return openaiJson(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, {
        method: 'POST',
        body: JSON.stringify({
            file_id: fileId,
            attributes,
        }),
    });
}

async function deleteVectorStoreFile(vectorStoreId, fileId) {
    return openaiJson(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
    });
}

async function getVectorStoreFile(vectorStoreId, fileId) {
    return openaiJson(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`, {
        method: 'GET',
    });
}

async function pollVectorStoreFile(vectorStoreId, fileId, timeoutMs = 120000, intervalMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await getVectorStoreFile(vectorStoreId, fileId);
        const status = String(last?.status || '');
        if (status ***REMOVED***= 'completed') return last;
        if (status ***REMOVED***= 'failed' || status ***REMOVED***= 'cancelled') return last;
        await delay(intervalMs);
    }
    return last || { status: 'timeout' };
}

function normalizeAttributes(source, manifestVersion) {
    return {
        source_id: String(source.id || ''),
        title: String(source.title || '').slice(0, 200),
        type: String(source.type || '').slice(0, 64),
        status: String(source.status || '').slice(0, 32),
        scene: Array.isArray(source.scene) ? source.scene.join(',').slice(0, 400) : '',
        updated_at: String(source.updated_at || '').slice(0, 32),
        manifest_version: String(manifestVersion || '').slice(0, 32),
    };
}

function buildMetaSignature(source, manifestVersion) {
    return JSON.stringify({
        id: source?.id || '',
        title: source?.title || '',
        type: source?.type || '',
        status: source?.status || '',
        scene: Array.isArray(source?.scene) ? source.scene : [],
        updated_at: source?.updated_at || '',
        priority: source?.priority || null,
        sensitivity: source?.sensitivity || '',
        manifest_version: manifestVersion || '',
    });
}

function shouldSyncSource(source, includeDraft) {
    if (!source || typeof source !***REMOVED*** 'object') return false;
    if (source.status ***REMOVED***= 'approved') return true;
    if (includeDraft && source.status ***REMOVED***= 'draft') return true;
    return false;
}

async function main() {
    const args = parseArgs();
    const absManifestPath = path.resolve(process.cwd(), args.manifestPath);
    const absStatePath = path.resolve(process.cwd(), args.statePath);

    if (!fs.existsSync(absManifestPath)) {
        throw new Error(`manifest not found: ${args.manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(absManifestPath, 'utf-8'));
    const allSources = Array.isArray(manifest.sources) ? manifest.sources : [];
    const syncSources = allSources.filter((item) => shouldSyncSource(item, args.includeDraft));

    let vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID || '';
    if (!vectorStoreId && args.createStoreName) {
        if (args.dryRun) {
            console.log(`[DRY-RUN] will create vector store: ${args.createStoreName}`);
            vectorStoreId = 'vs_dry_run';
        } else {
            const created = await createVectorStore(args.createStoreName);
            vectorStoreId = created.id;
            console.log(`[vector-store] created: ${vectorStoreId}`);
        }
    }

    if (!vectorStoreId) {
        throw new Error('OPENAI_VECTOR_STORE_ID missing. set env or use --create-store');
    }

    const state = safeReadJson(absStatePath, {
        vector_store_id: vectorStoreId,
        updated_at: new Date().toISOString(),
        files: {},
    });
    state.vector_store_id = vectorStoreId;

    let planned = 0;
    let skipped = 0;
    let uploaded = 0;
    let failed = 0;

    for (const source of syncSources) {
        const relPath = String(source.path || '');
        const absPath = path.resolve(process.cwd(), relPath);
        if (!fs.existsSync(absPath)) {
            console.warn(`[skip] file not found: ${relPath}`);
            skipped += 1;
            continue;
        }

        const bytes = fs.readFileSync(absPath);
        const hash = sha256Buffer(bytes);
        const old = state.files[source.id];
        const metaSignature = buildMetaSignature(source, manifest.version || '');
        const unchanged = old
            && old.sha256 ***REMOVED***= hash
            && old.status ***REMOVED***= 'completed'
            && old.vector_store_id ***REMOVED***= vectorStoreId
            && old.meta_signature ***REMOVED***= metaSignature;

        if (unchanged) {
            console.log(`[skip] unchanged: ${source.id} (${relPath})`);
            skipped += 1;
            continue;
        }

        planned += 1;
        console.log(`[sync] ${source.id} -> ${relPath}`);
        if (args.dryRun) continue;

        try {
            if (old?.file_id && old.vector_store_id ***REMOVED***= vectorStoreId) {
                try {
                    await deleteVectorStoreFile(vectorStoreId, old.file_id);
                    console.log(`[cleanup] removed previous file: ${old.file_id}`);
                } catch (cleanupErr) {
                    console.warn(`[cleanup] failed for ${old.file_id}: ${cleanupErr.message}`);
                }
            }
            const fileObj = await uploadFile(absPath);
            const fileId = fileObj.id;
            const attrs = normalizeAttributes(source, manifest.version || '');
            await attachFileToVectorStore(vectorStoreId, fileId, attrs);
            const polled = await pollVectorStoreFile(vectorStoreId, fileId);
            const status = String(polled?.status || 'unknown');

            state.files[source.id] = {
                source_id: source.id,
                path: relPath,
                sha256: hash,
                size_bytes: bytes.length,
                file_id: fileId,
                status,
                last_error: polled?.last_error || null,
                vector_store_id: vectorStoreId,
                attributes: attrs,
                meta_signature: metaSignature,
                uploaded_at: new Date().toISOString(),
            };

            if (status ***REMOVED***= 'completed') {
                uploaded += 1;
                console.log(`[ok] completed: ${source.id} file_id=${fileId}`);
            } else {
                failed += 1;
                console.warn(`[warn] status=${status}: ${source.id} file_id=${fileId}`);
            }
        } catch (err) {
            failed += 1;
            console.error(`[error] ${source.id}: ${err.message}`);
            state.files[source.id] = {
                source_id: source.id,
                path: relPath,
                sha256: hash,
                status: 'failed',
                last_error: err.message,
                vector_store_id: vectorStoreId,
                meta_signature: metaSignature,
                uploaded_at: new Date().toISOString(),
            };
        }
    }

    if (!args.dryRun) {
        state.updated_at = new Date().toISOString();
        safeWriteJson(absStatePath, state);
        console.log(`[state] wrote ${path.relative(process.cwd(), absStatePath)}`);
    }

    console.log('');
    console.log('[summary]');
    console.log(`- vector_store_id: ${vectorStoreId}`);
    console.log(`- source_total: ${allSources.length}`);
    console.log(`- source_selected: ${syncSources.length}`);
    console.log(`- planned: ${planned}`);
    console.log(`- uploaded: ${uploaded}`);
    console.log(`- skipped: ${skipped}`);
    console.log(`- failed: ${failed}`);
    if (args.dryRun) {
        console.log('- mode: dry-run');
    }
}

main().catch((err) => {
    console.error('[sync-openai-vector-store] fatal:', err.message);
    process.exit(1);
});
