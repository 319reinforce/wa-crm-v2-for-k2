#!/usr/bin/env node
/**
 * 知识源清单校验
 * 用法:
 *   node scripts/validate-knowledge-manifest.cjs
 *   node scripts/validate-knowledge-manifest.cjs docs/rag/knowledge-manifest.json
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const allowedTypes = new Set(['policy', 'sop', 'faq', 'playbook', 'pricing', 'compliance']);
const allowedStatus = new Set(['approved', 'draft', 'deprecated']);

function fail(msg) {
    console.error(`[ERROR] ${msg}`);
}

function warn(msg) {
    console.warn(`[WARN] ${msg}`);
}

function ok(msg) {
    console.log(`[OK] ${msg}`);
}

function validateSource(source, idx, rootDir) {
    const errors = [];
    const warnings = [];
    const label = `sources[${idx}]`;
    const requiredFields = ['id', 'title', 'type', 'format', 'path', 'scene', 'status'];

    requiredFields.forEach((field) => {
        if (
            source[field] ***REMOVED***= undefined
            || source[field] ***REMOVED***= null
            || (typeof source[field] ***REMOVED***= 'string' && source[field].trim() ***REMOVED***= '')
        ) {
            errors.push(`${label}.${field} is required`);
        }
    });

    if (source.type && !allowedTypes.has(source.type)) {
        errors.push(`${label}.type must be one of: ${Array.from(allowedTypes).join(', ')}`);
    }

    if (source.status && !allowedStatus.has(source.status)) {
        errors.push(`${label}.status must be one of: ${Array.from(allowedStatus).join(', ')}`);
    }

    if (source.scene && !Array.isArray(source.scene)) {
        errors.push(`${label}.scene must be an array`);
    } else if (Array.isArray(source.scene) && source.scene.length ***REMOVED***= 0) {
        errors.push(`${label}.scene must not be empty`);
    }

    if (Array.isArray(source.scene)) {
        source.scene.forEach((item, sceneIdx) => {
            if (typeof item !***REMOVED*** 'string' || item.trim() ***REMOVED***= '') {
                errors.push(`${label}.scene[${sceneIdx}] must be a non-empty string`);
            }
        });
    }

    if (source.path && typeof source.path ***REMOVED***= 'string') {
        if (!source.path.startsWith('docs/rag/sources/')) {
            warnings.push(`${label}.path should be under docs/rag/sources/: ${source.path}`);
        }
        const absolutePath = path.isAbsolute(source.path)
            ? source.path
            : path.resolve(rootDir, source.path);
        if (!fs.existsSync(absolutePath)) {
            warnings.push(`${label}.path target not found: ${source.path}`);
        }
    }

    if (source.format && source.path && typeof source.path ***REMOVED***= 'string') {
        const ext = path.extname(source.path).replace('.', '').toLowerCase();
        const fmt = String(source.format).toLowerCase();
        if (ext && fmt && ext !***REMOVED*** fmt) {
            warnings.push(`${label}.format (${fmt}) not match file ext (${ext})`);
        }
    }

    if (source.updated_at && !/^\d{4}-\d{2}-\d{2}$/.test(String(source.updated_at))) {
        errors.push(`${label}.updated_at must be YYYY-MM-DD`);
    }
    if (source.effective_from && !/^\d{4}-\d{2}-\d{2}$/.test(String(source.effective_from))) {
        errors.push(`${label}.effective_from must be YYYY-MM-DD`);
    }
    if (source.rule_version && typeof source.rule_version !***REMOVED*** 'string') {
        errors.push(`${label}.rule_version must be string`);
    }

    return { errors, warnings };
}

function main() {
    const defaultPath = process.env.KNOWLEDGE_MANIFEST_PATH || 'docs/rag/knowledge-manifest.json';
    const inputPath = process.argv[2] || defaultPath;
    const absolutePath = path.resolve(process.cwd(), inputPath);

    if (!fs.existsSync(absolutePath)) {
        fail(`manifest not found: ${inputPath}`);
        process.exit(1);
    }

    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
    } catch (err) {
        fail(`manifest JSON parse failed: ${err.message}`);
        process.exit(1);
    }

    const errors = [];
    const warnings = [];

    if (!payload || typeof payload !***REMOVED*** 'object') {
        errors.push('manifest root must be an object');
    }

    if (!Array.isArray(payload.sources)) {
        errors.push('manifest.sources must be an array');
    }

    const ids = new Set();
    if (Array.isArray(payload.sources)) {
        payload.sources.forEach((source, idx) => {
            const result = validateSource(source, idx, process.cwd());
            result.errors.forEach((item) => errors.push(item));
            result.warnings.forEach((item) => warnings.push(item));

            if (source && source.id) {
                if (ids.has(source.id)) {
                    errors.push(`duplicate source id: ${source.id}`);
                }
                ids.add(source.id);
            }
        });
    }

    if (warnings.length > 0) {
        warnings.forEach(warn);
    }

    if (errors.length > 0) {
        errors.forEach(fail);
        process.exit(1);
    }

    ok(`manifest passed: ${inputPath}`);
    ok(`sources total: ${(payload.sources || []).length}`);
}

main();
