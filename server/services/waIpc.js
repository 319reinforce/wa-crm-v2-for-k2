const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { perfLog } = require('./perfLog');

const ROOT_DIR = path.join(__dirname, '../../.wa_ipc');
const STATUS_DIR = path.join(ROOT_DIR, 'status');
const COMMANDS_DIR = path.join(ROOT_DIR, 'commands');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeSessionId(value, fallback = 'unknown') {
    const raw = String(value || fallback).trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || fallback;
}

function ensureSessionDirs(sessionId) {
    const safeSessionId = sanitizeSessionId(sessionId);
    ensureDir(ROOT_DIR);
    ensureDir(STATUS_DIR);
    ensureDir(path.join(COMMANDS_DIR, safeSessionId, 'pending'));
    ensureDir(path.join(COMMANDS_DIR, safeSessionId, 'processing'));
    ensureDir(path.join(RESULTS_DIR, safeSessionId));
    return safeSessionId;
}

function statusFilePath(sessionId) {
    return path.join(STATUS_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

function resultFilePath(sessionId, commandId) {
    return path.join(RESULTS_DIR, sanitizeSessionId(sessionId), `${commandId}.json`);
}

function pendingDir(sessionId) {
    return path.join(COMMANDS_DIR, sanitizeSessionId(sessionId), 'pending');
}

function processingDir(sessionId) {
    return path.join(COMMANDS_DIR, sanitizeSessionId(sessionId), 'processing');
}

function writeJsonAtomic(filePath, payload) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tempPath, filePath);
}

function writeSessionStatus(sessionId, payload) {
    ensureSessionDirs(sessionId);
    writeJsonAtomic(statusFilePath(sessionId), {
        session_id: sanitizeSessionId(sessionId),
        updated_at: new Date().toISOString(),
        ...payload,
    });
}

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function readSessionStatus(sessionId) {
    return readJsonSafe(statusFilePath(sessionId));
}

function listStatusSessions() {
    ensureDir(STATUS_DIR);
    return fs.readdirSync(STATUS_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort();
}

function createSessionCommand(sessionId, payload) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const commandId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const filePath = path.join(pendingDir(safeSessionId), `${commandId}.json`);
    writeJsonAtomic(filePath, {
        id: commandId,
        session_id: safeSessionId,
        created_at: new Date().toISOString(),
        ...payload,
    });
    perfLog('cmd_sent', {
        cmdId: commandId,
        sessionId: safeSessionId,
        cmd: payload && payload.cmd,
    });
    return commandId;
}

function claimNextSessionCommand(sessionId) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const dir = pendingDir(safeSessionId);
    const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort();
    if (files.length === 0) return null;

    for (const file of files) {
        const source = path.join(dir, file);
        const target = path.join(processingDir(safeSessionId), file);
        try {
            fs.renameSync(source, target);
            const command = readJsonSafe(target);
            if (!command) {
                fs.unlinkSync(target);
                continue;
            }
            perfLog('cmd_claimed', {
                cmdId: command.id,
                sessionId: safeSessionId,
                cmd: command.cmd,
                createdAt: command.created_at,
            });
            return { command, filePath: target };
        } catch (_) {
            continue;
        }
    }
    return null;
}

function completeClaimedCommand(claimed, result) {
    if (!claimed?.command?.session_id || !claimed?.command?.id) return;
    const sessionId = claimed.command.session_id;
    ensureSessionDirs(sessionId);
    writeJsonAtomic(resultFilePath(sessionId, claimed.command.id), {
        id: claimed.command.id,
        session_id: sessionId,
        completed_at: new Date().toISOString(),
        ...result,
    });
    try {
        fs.unlinkSync(claimed.filePath);
    } catch (_) {}
    perfLog('cmd_completed', {
        cmdId: claimed.command.id,
        sessionId,
        cmd: claimed.command.cmd,
        ok: result && result.ok !== false,
    });
}

async function waitForSessionCommandResult(sessionId, commandId, timeoutMs = 20000) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const filePath = resultFilePath(safeSessionId, commandId);
    const started = Date.now();
    perfLog('cmd_wait_start', {
        cmdId: commandId,
        sessionId: safeSessionId,
        timeoutMs,
    });

    while (Date.now() - started < timeoutMs) {
        if (fs.existsSync(filePath)) {
            const payload = readJsonSafe(filePath);
            try {
                fs.unlinkSync(filePath);
            } catch (_) {}
            perfLog('cmd_wait_end', {
                cmdId: commandId,
                sessionId: safeSessionId,
                outcome: 'resolved',
                waitedMs: Date.now() - started,
                ok: payload && payload.ok !== false,
            });
            return payload || { ok: false, error: 'invalid command result' };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    perfLog('cmd_wait_end', {
        cmdId: commandId,
        sessionId: safeSessionId,
        outcome: 'timeout',
        waitedMs: Date.now() - started,
    });
    throw new Error(`session command timeout: ${safeSessionId}/${commandId}`);
}

module.exports = {
    createSessionCommand,
    claimNextSessionCommand,
    completeClaimedCommand,
    listStatusSessions,
    readSessionStatus,
    sanitizeSessionId,
    waitForSessionCommandResult,
    writeSessionStatus,
};
