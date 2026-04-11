/**
 * Local SFT Training Placeholder
 *
 * 这是一个本地训练占位脚本：
 * - 读取 trainingWorker 导出的 jsonl
 * - 做数据完整性校验
 * - 产出训练摘要与元数据文件
 *
 * 用法：
 *   node scripts/train-sft-local.cjs /tmp/sft-export-2026-04.jsonl
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function fail(message) {
    console.error(`[train-sft-local] ${message}`);
    process.exit(1);
}

function safeJson(line, lineNo) {
    try {
        return JSON.parse(line);
    } catch (err) {
        fail(`line ${lineNo} JSON parse failed: ${err.message}`);
    }
}

function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        fail('missing export path argument');
    }
    if (!fs.existsSync(inputPath)) {
        fail(`export file not found: ${inputPath}`);
    }

    const raw = fs.readFileSync(inputPath, 'utf8').trim();
    const lines = raw ? raw.split('\n') : [];
    if (lines.length ***REMOVED***= 0) {
        fail('empty export file');
    }

    const sceneMap = new Map();
    let missingAssistant = 0;
    let missingUser = 0;
    let invalidMessages = 0;
    let tooShortAssistant = 0;

    for (let i = 0; i < lines.length; i++) {
        const rec = safeJson(lines[i], i + 1);
        const messages = Array.isArray(rec.messages) ? rec.messages : [];
        if (!Array.isArray(messages) || messages.length < 2) {
            invalidMessages++;
            continue;
        }

        const first = messages[0] || {};
        const second = messages[1] || {};
        const firstContent = typeof first.content ***REMOVED***= 'string' ? first.content.trim() : '';
        const secondContent = typeof second.content ***REMOVED***= 'string' ? second.content.trim() : '';

        if (!firstContent) missingUser++;
        if (!secondContent) missingAssistant++;
        if (secondContent && secondContent.length < 6) tooShortAssistant++;

        const scene = rec.metadata?.scene || 'unknown';
        sceneMap.set(scene, (sceneMap.get(scene) || 0) + 1);
    }

    const sceneCoverage = Array.from(sceneMap.entries())
        .map(([scene, count]) => ({ scene, count }))
        .sort((a, b) => b.count - a.count);

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const outDir = path.join('/tmp/sft-train-artifacts', stamp);
    fs.mkdirSync(outDir, { recursive: true });

    const summary = {
        created_at: now.toISOString(),
        input_path: inputPath,
        total_records: lines.length,
        validation: {
            invalid_messages: invalidMessages,
            missing_user: missingUser,
            missing_assistant: missingAssistant,
            too_short_assistant: tooShortAssistant,
        },
        scene_coverage: sceneCoverage,
        model_artifact: {
            type: 'placeholder',
            name: `wa-crm-sft-placeholder-${stamp}`,
            note: 'replace with real finetune artifact once TRAINING_SCRIPT is connected to actual trainer',
        },
    };

    const summaryPath = path.join(outDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    // 输出一段简短文本，trainingWorker 会截断并写入 training_log.detail
    console.log(`local-train-placeholder ok; records=${lines.length}; scenes=${sceneCoverage.length}; summary=${summaryPath}`);
}

main();

