/**
 * Local Rule Retrieval Service
 *
 * 根据 scene/operator/user_message 从 docs/rag/sources/ 检索相关知识源
 * 并注入到 grounding_json.local_rules
 *
 * Design: docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN.md
 */

const fs = require('fs');
const path = require('path');

// Load knowledge manifest
const MANIFEST_PATH = path.join(__dirname, '../../docs/rag/knowledge-manifest.json');
let manifest = null;

function loadManifest() {
    if (!manifest) {
        try {
            const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
            manifest = JSON.parse(content);
        } catch (e) {
            manifest = { sources: [] };
        }
    }
    return manifest;
}

/**
 * 检索相关知识源
 * @param {Object} context - 检索上下文
 * @param {string} context.scene - 场景标识 (e.g., "trial_intro", "monthly_inquiry")
 * @param {string} context.operator - 运营人员 (e.g., "Beau", "Yiyun")
 * @param {string} context.userMessage - 用户最新消息（可选，用于关键词匹配）
 * @param {number} context.maxSources - 最多返回几个源（默认 3）
 * @returns {Array} 匹配的知识源列表
 */
function retrieveLocalRules(context) {
    const {
        scene = null,
        operator = null,
        userMessage = '',
        recentMessages = [],
        currentTopic = null,
        autoDetectedTopic = null,
        activeEvents = [],
        lifecycle = null,
        forceTemplateSources = false,
        maxSources = 3
    } = context;

    const manifest = loadManifest();
    const candidates = [];
    const resolvedTopic = currentTopic?.topic_key || autoDetectedTopic?.topic_key || null;
    const resolvedStage = lifecycle?.stage_key || null;
    const recentText = (Array.isArray(recentMessages) ? recentMessages : [])
        .map((message) => String(message?.text || '').trim())
        .filter(Boolean)
        .join(' \n ');
    const combinedText = [userMessage, recentText].filter(Boolean).join(' \n ');
    const keywords = extractKeywords(combinedText);
    const normalizedEventKeys = (Array.isArray(activeEvents) ? activeEvents : [])
        .filter((event) => event?.status === 'active')
        .map((event) => String(event?.event_key || '').toLowerCase())
        .filter(Boolean);

    for (const source of manifest.sources) {
        let score = 0;
        const matchedBy = [];
        const sourceTitle = String(source.title || '').toLowerCase();
        const sourceId = String(source.id || '').toLowerCase();
        const sourceScenes = Array.isArray(source.scene) ? source.scene : [];
        const sourceTopics = normalizeManifestField(source.topic);
        const sourceLifecycleStages = normalizeManifestField(source.lifecycle_stage);
        const sourceEventStages = normalizeManifestField(source.event_stage);
        const sourceKeywords = normalizeManifestField(source.keywords);
        const sourceText = [
            sourceTitle,
            sourceId,
            sourceScenes.join(' '),
            sourceTopics.join(' '),
            sourceLifecycleStages.join(' '),
            sourceEventStages.join(' '),
            sourceKeywords.join(' '),
        ].join(' ').toLowerCase();

        if (scene && sourceScenes.includes(scene)) {
            score += 10;
            matchedBy.push('scene');
        }

        if (operator && source.type === 'playbook' && sourceTitle.includes(String(operator).toLowerCase())) {
            score += 8;
            matchedBy.push('operator');
        }

        if (forceTemplateSources && (source.type === 'playbook' || source.type === 'sop')) {
            score += 6;
            matchedBy.push('template_source');
        } else if (source.type === 'policy') {
            score += 5;
        } else if (source.type === 'sop') {
            score += 3;
        } else if (source.type === 'faq') {
            score += 2;
        }

        if (resolvedTopic) {
            const normalizedTopic = String(resolvedTopic).toLowerCase();
            if (sourceTopics.includes(normalizedTopic) || sourceId.includes(normalizedTopic) || sourceTitle.includes(normalizedTopic)) {
                score += 9;
                matchedBy.push('topic');
            }
        }

        if (resolvedStage) {
            const normalizedStage = String(resolvedStage).toLowerCase();
            if (sourceLifecycleStages.includes(normalizedStage) || sourceEventStages.includes(normalizedStage) || sourceText.includes(normalizedStage)) {
                score += 5;
                matchedBy.push('stage');
            }
        }

        if (normalizedEventKeys.length > 0) {
            const eventMatch = normalizedEventKeys.some((eventKey) => sourceEventStages.includes(eventKey) || sourceText.includes(eventKey));
            if (eventMatch) {
                score += 4;
                matchedBy.push('active_event');
            }
        }

        for (const keyword of keywords) {
            if (sourceText.includes(keyword)) {
                score += sourceKeywords.includes(keyword) ? 2 : 1;
                matchedBy.push(`keyword:${keyword}`);
            }
        }

        if (combinedText) {
            const lowerMsg = combinedText.toLowerCase();

            if ((lowerMsg.includes('safe') || lowerMsg.includes('risk') || lowerMsg.includes('violation'))
                && source.id.includes('violation')) {
                score += 3;
                matchedBy.push('keyword:violation');
            }

            if ((lowerMsg.includes('product') || lowerMsg.includes('recommend'))
                && (source.id.includes('product') || source.type === 'faq')) {
                score += 3;
                matchedBy.push('keyword:product');
            }

            if ((lowerMsg.includes('post') || lowerMsg.includes('cadence') || lowerMsg.includes('spammy'))
                && source.id.includes('posting')) {
                score += 3;
                matchedBy.push('keyword:posting');
            }
        }

        if (score > 0) {
            candidates.push({
                ...source,
                score,
                matchedBy: Array.from(new Set(matchedBy)),
                resolvedTopic,
                resolvedStage,
            });
        }
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const priorityA = Number.isFinite(a.priority) ? a.priority : Number.MAX_SAFE_INTEGER;
        const priorityB = Number.isFinite(b.priority) ? b.priority : Number.MAX_SAFE_INTEGER;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return candidates.slice(0, maxSources);
}

function normalizeManifestField(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').toLowerCase().trim())
            .filter(Boolean);
    }

    if (typeof value === 'string' && value.trim()) {
        return [value.toLowerCase().trim()];
    }

    return [];
}

/**
 * 提取用户消息中的关键词
 * @param {string} message - 用户消息
 * @returns {Array<string>} 关键词列表
 */
function extractKeywords(message) {
    const lowerMessage = message.toLowerCase();
    const keywords = [];

    // 关键词映射表
    const keywordMap = {
        'trial': ['trial', '试用', '7-day', '7天'],
        'monthly': ['monthly', 'month', '月费', '$20', '20美元'],
        'payment': ['payment', 'pay', 'payout', '付款', '结算'],
        'mcn': ['mcn', 'agency', 'bind', '绑定', '机构'],
        'video': ['video', 'post', 'posting', '视频', '发布'],
        'violation': ['violation', 'ban', 'risk', '违规', '封号'],
        'product': ['product', 'recommend', '产品', '推荐'],
        'safety': ['safety', 'safe', 'risk', '安全', '风险']
    };

    for (const [key, patterns] of Object.entries(keywordMap)) {
        for (const pattern of patterns) {
            if (lowerMessage.includes(pattern)) {
                keywords.push(key);
                break;
            }
        }
    }

    return keywords;
}

/**
 * 加载知识源内容
 * @param {Object} source - 知识源元数据
 * @returns {string|null} 知识源内容
 */
function loadSourceContent(source) {
    try {
        const fullPath = path.join(__dirname, '../../', source.path);
        return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        return null;
    }
}

/**
 * 构建 local_rules 注入文本
 * @param {Array} sources - 检索到的知识源列表
 * @returns {string} 格式化的 local_rules 文本
 */
function buildLocalRulesText(sources) {
    if (!sources || sources.length === 0) {
        return '';
    }

    let text = '\n\n【本地知识库规则 — Local Rules】\n';
    text += '以下规则来自已审核的知识源，优先级高于通用知识。\n\n';

    for (const source of sources) {
        const content = loadSourceContent(source);
        if (!content) continue;

        text += `\n--- [${source.id}] ${source.title} ---\n`;
        text += `类型: ${source.type} | 优先级: ${source.priority} | 生效日期: ${source.effective_from}\n\n`;
        text += content;
        text += '\n\n';
    }

    return text;
}

/**
 * 主入口：检索并构建 local_rules
 * @param {Object} context - 检索上下文
 * @returns {Object} { sources: Array, text: string }
 */
function retrieveAndBuildLocalRules(context) {
    const sources = retrieveLocalRules(context);
    const text = buildLocalRulesText(sources);

    return {
        sources: sources.map(s => ({
            id: s.id,
            title: s.title,
            type: s.type,
            score: s.score
        })),
        text
    };
}

/**
 * 从知识源内容中提取纯话术文本
 * @param {string} content - Markdown 内容
 * @param {string} sourceId - 知识源 ID
 * @returns {string|null} 提取的话术文本
 */
function extractTemplateFromSource(content, sourceId, sourceType = '') {
    if (!content) return null;

    const explicitTemplatePatterns = [
        /##\s+Suggested Reply Template[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i,
        /##\s+Creator Reply Templates?[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i,
        /##\s+Standard response[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i,
        /##\s+Short explanation[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i,
    ];

    for (const pattern of explicitTemplatePatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            const text = sanitizeTemplateText(match[1]);
            if (isUsableTemplate(text)) {
                return text;
            }
        }
    }

    if (String(sourceType).toLowerCase() === 'playbook') {
        const playbookTemplate = extractPlaybookParagraph(content);
        if (isUsableTemplate(playbookTemplate)) {
            return playbookTemplate;
        }
    }

    return null;
}

function sanitizeTemplateText(text) {
    return String(text || '')
        .replace(/```(?:text)?/g, '')
        .trim();
}

function isUsableTemplate(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 20 || trimmed.length > 600) return false;
    if (trimmed.startsWith('#') || trimmed.startsWith('|')) return false;
    return /[.!?。！？]/.test(trimmed) || trimmed.split('\n').length >= 2;
}

function extractPlaybookParagraph(content) {
    const lines = content.split('\n');
    let inContent = false;
    const paragraph = [];

    for (const line of lines) {
        if (line.startsWith('## Scope') || line.startsWith('## Core Style') || line.startsWith('## Do Not') || line.startsWith('## Version')) {
            inContent = false;
            continue;
        }

        if (line.startsWith('## ') && !line.includes('Scope') && !line.includes('Version')) {
            inContent = true;
            paragraph.length = 0;
            continue;
        }

        if (inContent && line.trim() && !line.startsWith('#') && !line.startsWith('-')) {
            paragraph.push(line.trim());
            if (paragraph.join(' ').length > 120) {
                break;
            }
        }
    }

    return paragraph.join('\n').trim();
}

module.exports = {
    loadManifest,
    retrieveLocalRules,
    loadSourceContent,
    buildLocalRulesText,
    retrieveAndBuildLocalRules,
    extractTemplateFromSource,
};
