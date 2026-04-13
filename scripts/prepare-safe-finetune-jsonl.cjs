/**
 * Prepare Safe Fine-tune JSONL
 *
 * 目标：
 * 1) 将 /api/sft-export 的多轮样本压缩为最小训练格式（user + assistant）
 * 2) 对隐私字段脱敏（URL/邮箱/手机号/handle/长数字）
 * 3) 过滤高风险文本，降低 OpenAI fine-tune 的 unsafe_file 概率
 *
 * 用法：
 *   node scripts/prepare-safe-finetune-jsonl.cjs --input=/tmp/sft-export-2026-04.jsonl
 *   node scripts/prepare-safe-finetune-jsonl.cjs --input=/tmp/in.jsonl --output=/tmp/out.safe.jsonl --report=/tmp/out.safe.report.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_USER = Math.max(parseInt(process.env.FT_SAFE_MAX_USER_LEN || '1200', 10) || 1200, 100);
const DEFAULT_MAX_ASSISTANT = Math.max(parseInt(process.env.FT_SAFE_MAX_ASSISTANT_LEN || '2200', 10) || 2200, 200);
const DEFAULT_MIN_ASSISTANT = Math.max(parseInt(process.env.FT_SAFE_MIN_ASSISTANT_LEN || '6', 10) || 6, 1);
const DEFAULT_DROP_RISKY = process.env.FT_SAFE_DROP_RISKY !== 'false';

const RISKY_PATTERN = /\b(porn|nude|naked|escort|sex|sexual|rape|suicide|self-harm|kill|murder|bomb|weapon|cocaine|meth|heroin|terror)\b|黄色|裸聊|约炮|强奸|自杀|炸弹|毒品|仇恨|种族灭绝/i;
const PLACEHOLDER_USER_PATTERNS = [
    /^\[\s*请回复这位达人\s*]$/i,
    /^\[\s*please\s+reply/i,
    /^reply\s+to\s+the\s+creator$/i,
];

function boolFromArg(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === 'true' || value === '1' || value === 'yes') return true;
    if (value === false || value === 'false' || value === '0' || value === 'no') return false;
    return fallback;
}

function parseArgs(argv) {
    const map = {};
    for (const item of argv) {
        if (!item.startsWith('--')) continue;
        const eq = item.indexOf('=');
        if (eq === -1) {
            map[item.slice(2)] = 'true';
        } else {
            map[item.slice(2, eq)] = item.slice(eq + 1);
        }
    }
    return map;
}

function inferFallbackPaths(inputPath, outputPath, reportPath) {
    if (!outputPath) {
        const ext = path.extname(inputPath);
        const base = ext ? inputPath.slice(0, -ext.length) : inputPath;
        outputPath = `${base}.safe.minimal.jsonl`;
    }
    if (!reportPath) {
        const ext = path.extname(outputPath);
        const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
        reportPath = `${base}.report.json`;
    }
    return { outputPath, reportPath };
}

function isPlaceholderUser(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    return PLACEHOLDER_USER_PATTERNS.some((pattern) => pattern.test(t));
}

function sanitizeText(input, redactStats) {
    if (typeof input !== 'string') return '';
    let text = input;

    // Normalize line breaks and remove hidden control chars.
    text = text.replace(/\r\n?/g, '\n');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    text = text.replace(/https?:\/\/\S+/gi, () => {
        redactStats.url += 1;
        return '[REDACTED_URL]';
    });
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => {
        redactStats.email += 1;
        return '[REDACTED_EMAIL]';
    });
    text = text.replace(/(?<!\d)(\+?\d[\d\s\-()]{6,}\d)(?!\d)/g, () => {
        redactStats.phone += 1;
        return '[REDACTED_PHONE]';
    });
    text = text.replace(/@[a-zA-Z0-9_\-.]{3,}/g, () => {
        redactStats.handle += 1;
        return '@[REDACTED_HANDLE]';
    });
    text = text.replace(/\b\d{6,}\b/g, () => {
        redactStats.long_number += 1;
        return '[REDACTED_NUMBER]';
    });

    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
}

function parseScene(record, messages) {
    const metadataScene = record?.metadata?.scene;
    if (typeof metadataScene === 'string' && metadataScene.trim()) {
        return metadataScene.trim();
    }
    const systemMsg = (messages || []).find((m) => m?.role === 'system' && typeof m.content === 'string');
    const match = systemMsg?.content?.match(/场景[:：]\s*([a-zA-Z_]+)/);
    return match ? match[1] : 'follow_up';
}

function buildFallbackUserPrompt(scene) {
    return `Please draft one concise and polite customer-support reply for scene "${scene}".`;
}

function toMinimalRecord(rawRecord, options, redactStats) {
    const messages = Array.isArray(rawRecord?.messages) ? rawRecord.messages : [];
    if (messages.length === 0) {
        return { ok: false, reason: 'empty_messages' };
    }

    let assistant = '';
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
            assistant = msg.content;
            break;
        }
    }
    if (!assistant) {
        return { ok: false, reason: 'missing_assistant' };
    }

    let user = '';
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.role !== 'user' || typeof msg.content !== 'string') continue;
        if (isPlaceholderUser(msg.content)) continue;
        if (!msg.content.trim()) continue;
        user = msg.content;
        break;
    }
    if (!user) {
        user = buildFallbackUserPrompt(parseScene(rawRecord, messages));
    }

    user = sanitizeText(user, redactStats);
    assistant = sanitizeText(assistant, redactStats);

    if (!user) return { ok: false, reason: 'empty_user_after_sanitize' };
    if (!assistant) return { ok: false, reason: 'empty_assistant_after_sanitize' };
    if (assistant.length < options.minAssistantLen) return { ok: false, reason: 'assistant_too_short' };

    if (options.dropRisky) {
        const combined = `${user}\n${assistant}`;
        if (RISKY_PATTERN.test(combined)) {
            return { ok: false, reason: 'risky_content' };
        }
    }

    const clippedUser = user.slice(0, options.maxUserLen);
    const clippedAssistant = assistant.slice(0, options.maxAssistantLen);
    return {
        ok: true,
        record: {
            messages: [
                { role: 'user', content: clippedUser },
                { role: 'assistant', content: clippedAssistant },
            ],
        },
    };
}

function sha256(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function prepareDataset({
    inputPath,
    outputPath,
    reportPath,
    maxUserLen = DEFAULT_MAX_USER,
    maxAssistantLen = DEFAULT_MAX_ASSISTANT,
    minAssistantLen = DEFAULT_MIN_ASSISTANT,
    dropRisky = DEFAULT_DROP_RISKY,
}) {
    if (!inputPath) throw new Error('inputPath is required');
    if (!fs.existsSync(inputPath)) throw new Error(`input file not found: ${inputPath}`);

    const raw = fs.readFileSync(inputPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    const options = {
        maxUserLen: Math.max(parseInt(maxUserLen, 10) || DEFAULT_MAX_USER, 100),
        maxAssistantLen: Math.max(parseInt(maxAssistantLen, 10) || DEFAULT_MAX_ASSISTANT, 200),
        minAssistantLen: Math.max(parseInt(minAssistantLen, 10) || DEFAULT_MIN_ASSISTANT, 1),
        dropRisky: boolFromArg(dropRisky, DEFAULT_DROP_RISKY),
    };

    const dropped = {
        invalid_json: 0,
        empty_messages: 0,
        missing_assistant: 0,
        empty_user_after_sanitize: 0,
        empty_assistant_after_sanitize: 0,
        assistant_too_short: 0,
        risky_content: 0,
        deduplicated: 0,
        other: 0,
    };
    const droppedSamples = [];
    const redactStats = { url: 0, email: 0, phone: 0, handle: 0, long_number: 0 };
    const dedupSet = new Set();
    const outputRecords = [];

    for (let index = 0; index < lines.length; index++) {
        let parsed;
        try {
            parsed = JSON.parse(lines[index]);
        } catch (_) {
            dropped.invalid_json += 1;
            continue;
        }

        const normalized = toMinimalRecord(parsed, options, redactStats);
        if (!normalized.ok) {
            const reason = dropped[normalized.reason] !== undefined ? normalized.reason : 'other';
            dropped[reason] += 1;
            if (droppedSamples.length < 40) {
                droppedSamples.push({
                    line: index + 1,
                    reason,
                });
            }
            continue;
        }

        const user = normalized.record.messages[0].content;
        const assistant = normalized.record.messages[1].content;
        const key = sha256(`${user}\n---\n${assistant}`);
        if (dedupSet.has(key)) {
            dropped.deduplicated += 1;
            continue;
        }
        dedupSet.add(key);
        outputRecords.push(normalized.record);
    }

    fs.writeFileSync(outputPath, outputRecords.map((item) => JSON.stringify(item)).join('\n') + (outputRecords.length ? '\n' : ''), 'utf8');

    const report = {
        created_at: new Date().toISOString(),
        input_path: inputPath,
        output_path: outputPath,
        options,
        total_input_lines: lines.length,
        kept_lines: outputRecords.length,
        dropped_lines: lines.length - outputRecords.length,
        dropped_breakdown: dropped,
        redact_stats: redactStats,
        dropped_samples: droppedSamples,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    return {
        inputPath,
        outputPath,
        reportPath,
        total: lines.length,
        kept: outputRecords.length,
        dropped: lines.length - outputRecords.length,
    };
}

function printUsageAndExit() {
    console.error('Usage: node scripts/prepare-safe-finetune-jsonl.cjs --input=<jsonl> [--output=<jsonl>] [--report=<json>]');
    process.exit(1);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = args.input || args.in;
    if (!inputPath) printUsageAndExit();

    const inferred = inferFallbackPaths(inputPath, args.output || args.out, args.report);
    const result = prepareDataset({
        inputPath,
        outputPath: inferred.outputPath,
        reportPath: inferred.reportPath,
        maxUserLen: args.max_user || args.maxUser || DEFAULT_MAX_USER,
        maxAssistantLen: args.max_assistant || args.maxAssistant || DEFAULT_MAX_ASSISTANT,
        minAssistantLen: args.min_assistant || args.minAssistant || DEFAULT_MIN_ASSISTANT,
        dropRisky: boolFromArg(args.drop_risky, DEFAULT_DROP_RISKY),
    });

    console.log(JSON.stringify({
        ok: true,
        ...result,
    }, null, 2));
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error('[prepare-safe-finetune-jsonl] fatal:', err.message);
        process.exit(1);
    }
}

module.exports = {
    prepareDataset,
};
