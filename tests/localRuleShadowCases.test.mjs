import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const manifestPath = path.join(rootDir, 'docs/rag/knowledge-manifest.json');
const shadowCasesPath = path.join(rootDir, 'docs/rag/shadow-cases/local-rule-shadow-cases.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9$-]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3);
}

function loadManifestSources() {
    const manifest = readJson(manifestPath);
    return new Map((manifest.sources || []).map((source) => [source.id, source]));
}

function readSourceText(source) {
    const sourcePath = path.resolve(rootDir, source.path);
    return fs.readFileSync(sourcePath, 'utf8');
}

function scoreSourceForCase(source, sourceText, testCase) {
    if (source.status !== 'approved') return -Infinity;
    if (!Array.isArray(source.scene) || !source.scene.includes(testCase.scene)) return -Infinity;

    const titleText = normalizeText([source.id, source.title, source.type].join('\n'));
    const leadText = normalizeText(sourceText.slice(0, 1200));
    const content = normalizeText([
        source.id,
        source.title,
        source.type,
        source.scene.join(' '),
        sourceText,
    ].join('\n'));
    const queryTokens = new Set(tokenize([
        testCase.scene,
        testCase.operator,
        testCase.latest_user_message,
    ].join(' ')));

    let score = 0;
    if (source.scene.includes(testCase.scene)) score += 10;
    if (source.type === 'policy') score += 2;
    if (source.priority === 1) score += 1;

    for (const token of queryTokens) {
        if (content.includes(token)) score += 1;
        if (titleText.includes(token)) score += 2;
        if (leadText.includes(token)) score += 1;
    }

    for (const phrase of testCase.expected_terms || []) {
        const normalizedPhrase = normalizeText(phrase);
        if (content.includes(normalizedPhrase)) score += 4;
        if (titleText.includes(normalizedPhrase)) score += 3;
        if (leadText.includes(normalizedPhrase)) score += 2;
    }

    return score;
}

test('approved manifest sources exist locally', () => {
    const sources = loadManifestSources();
    for (const source of sources.values()) {
        if (source.status !== 'approved') continue;
        assert.ok(source.path, `${source.id} must define path`);
        assert.ok(
            fs.existsSync(path.resolve(rootDir, source.path)),
            `${source.id} path must exist: ${source.path}`
        );
    }
});

test('shadow cases reference approved existing sources that cover the requested scene', () => {
    const sources = loadManifestSources();
    const payload = readJson(shadowCasesPath);

    assert.equal(payload.mode, 'shadow');
    assert.ok(Array.isArray(payload.cases));
    assert.ok(payload.cases.length >= 5);

    for (const testCase of payload.cases) {
        assert.ok(testCase.id, 'shadow case must have id');
        assert.ok(testCase.scene, `${testCase.id} must define scene`);
        assert.ok(testCase.expected_top_source, `${testCase.id} must define expected_top_source`);
        assert.ok(Array.isArray(testCase.expected_sources), `${testCase.id} expected_sources must be array`);

        for (const sourceId of testCase.expected_sources) {
            const source = sources.get(sourceId);
            assert.ok(source, `${testCase.id} references unknown source ${sourceId}`);
            assert.equal(source.status, 'approved', `${sourceId} must be approved`);
            assert.ok(
                fs.existsSync(path.resolve(rootDir, source.path)),
                `${sourceId} path must exist`
            );
            assert.ok(
                Array.isArray(source.scene) && source.scene.includes(testCase.scene),
                `${sourceId} must cover scene ${testCase.scene}`
            );
        }
    }
});

test('shadow cases expected evidence terms exist in referenced source docs', () => {
    const sources = loadManifestSources();
    const payload = readJson(shadowCasesPath);

    for (const testCase of payload.cases) {
        const sourceText = testCase.expected_sources
            .map((sourceId) => readSourceText(sources.get(sourceId)))
            .join('\n\n');
        const normalizedSourceText = normalizeText(sourceText);

        for (const term of testCase.expected_terms || []) {
            assert.ok(
                normalizedSourceText.includes(normalizeText(term)),
                `${testCase.id} expected term not found: ${term}`
            );
        }
    }
});

test('shadow lexical scorer ranks the expected top source first', () => {
    const sources = loadManifestSources();
    const payload = readJson(shadowCasesPath);

    for (const testCase of payload.cases) {
        const ranked = Array.from(sources.values())
            .map((source) => ({
                source,
                score: scoreSourceForCase(source, readSourceText(source), testCase),
            }))
            .filter((item) => Number.isFinite(item.score))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if ((a.source.priority || 99) !== (b.source.priority || 99)) {
                    return (a.source.priority || 99) - (b.source.priority || 99);
                }
                return String(a.source.id).localeCompare(String(b.source.id));
            });

        assert.ok(ranked.length > 0, `${testCase.id} must have ranked candidates`);
        assert.equal(
            ranked[0].source.id,
            testCase.expected_top_source,
            `${testCase.id} expected ${testCase.expected_top_source} first, got ${ranked[0].source.id}`
        );
    }
});
