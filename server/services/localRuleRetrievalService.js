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
            console.error('[localRuleRetrieval] Failed to load manifest:', e.message);
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
        maxSources = 3
    } = context;

    const manifest = loadManifest();
    const candidates = [];

    for (const source of manifest.sources) {
        let score = 0;

        // Scene 匹配（最高优先级）
        if (scene && source.scene && source.scene.includes(scene)) {
            score += 10;
        }

        // Operator 特定规则（playbook 类型）
        if (operator && source.type === 'playbook') {
            const sourceTitle = source.title.toLowerCase();
            if (sourceTitle.includes(operator.toLowerCase())) {
                score += 8;
            }
        }

        // Policy 类型优先级最高
        if (source.type === 'policy') {
            score += 5;
        }

        // SOP 类型次之
        if (source.type === 'sop') {
            score += 3;
        }

        // FAQ 类型用于通用问题
        if (source.type === 'faq') {
            score += 2;
        }

        // 关键词匹配（平衡实现）
        if (userMessage) {
            const keywords = extractKeywords(userMessage);
            const sourceText = (source.title + ' ' + (source.scene || []).join(' ')).toLowerCase();

            for (const keyword of keywords) {
                if (sourceText.includes(keyword)) {
                    score += 1;
                }
            }

            // 特定关键词与源类型的强关联（仅在明确匹配时加分）
            const lowerMsg = userMessage.toLowerCase();

            // "safe" / "risk" / "violation" 强关联到 violation SOP
            if ((lowerMsg.includes('safe') || lowerMsg.includes('risk') || lowerMsg.includes('violation'))
                && source.id.includes('violation')) {
                score += 3;
            }

            // "product" / "recommend" 强关联到 product/faq
            if ((lowerMsg.includes('product') || lowerMsg.includes('recommend'))
                && (source.id.includes('product') || source.type === 'faq')) {
                score += 3;
            }

            // "post" / "posting" / "cadence" 强关联到 posting safety
            if ((lowerMsg.includes('post') || lowerMsg.includes('cadence') || lowerMsg.includes('spammy'))
                && source.id.includes('posting')) {
                score += 3;
            }
        }

        // 只保留有分数的候选
        if (score > 0) {
            candidates.push({
                ...source,
                score
            });
        }
    }

    // 按分数排序，取前 N 个
    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // 分数相同时，优先级高的在前
        return a.priority - b.priority;
    });

    return candidates.slice(0, maxSources);
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
        console.error(`[localRuleRetrieval] Failed to load source ${source.id}:`, e.message);
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
function extractTemplateFromSource(content, sourceId) {
    if (!content) return null;

    // 策略 1: 提取 "Suggested Reply Template" 章节中的代码块
    const templateSectionMatch = content.match(/##\s+Suggested Reply Template[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i);
    if (templateSectionMatch && templateSectionMatch[1]) {
        return templateSectionMatch[1].trim();
    }

    // 策略 2: 提取任何代码块（排除代码示例）
    const codeBlockMatches = content.match(/```(?:text)?\s*([\s\S]*?)```/g);
    if (codeBlockMatches && codeBlockMatches.length > 0) {
        // 取第一个代码块
        const firstBlock = codeBlockMatches[0].replace(/```(?:text)?/g, '').trim();
        if (firstBlock.length > 20 && firstBlock.length < 500) {
            return firstBlock;
        }
    }

    // 策略 3: 提取 "## How to ..." 或 "## When to ..." 之后的第一段文本
    const howToMatch = content.match(/##\s+(?:How|When|What)[\s\S]*?\n\n([\s\S]*?)(?:\n\n##|\n\n-|$)/i);
    if (howToMatch && howToMatch[1]) {
        const text = howToMatch[1].trim();
        if (text.length > 30 && text.length < 500 && !text.startsWith('-')) {
            return text;
        }
    }

    // 策略 4: 如果是 playbook 类型，提取第一个实际段落（跳过元数据）
    if (sourceId.includes('playbook')) {
        const lines = content.split('\n');
        let inContent = false;
        let paragraph = [];

        for (const line of lines) {
            // 跳过元数据部分
            if (line.startsWith('## Scope') || line.startsWith('## Core Style') || line.startsWith('## Do Not')) {
                inContent = false;
                continue;
            }

            // 找到实际内容段落
            if (line.startsWith('## ') && !line.includes('Scope') && !line.includes('Version')) {
                inContent = true;
                continue;
            }

            if (inContent && line.trim() && !line.startsWith('#') && !line.startsWith('-')) {
                paragraph.push(line.trim());
                if (paragraph.join(' ').length > 100) {
                    break;
                }
            }
        }

        if (paragraph.length > 0) {
            return paragraph.join('\n').trim();
        }
    }

    return null;
}

module.exports = {
    retrieveLocalRules,
    loadSourceContent,
    buildLocalRulesText,
    retrieveAndBuildLocalRules,
    extractTemplateFromSource
};
