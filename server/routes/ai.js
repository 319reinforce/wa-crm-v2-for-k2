/**
 * AI routes
 * POST /api/minimax, POST /api/ai/generate-candidates, POST /api/translate, POST /api/ai/generate
 */
const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const {
    buildReplySystemPrompt,
    generateCandidatesFromMessages,
    generateReplyCandidates,
    resolveAiRequestScope,
} = require('../services/replyGenerationService');

// POST /api/minimax — AI 生成路由（含 USE_FINETUNED 灰度）
router.post('/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id, retrieval_snapshot_id, scene, operator, prompt_version } = req.body || {};
        const result = await generateCandidatesFromMessages({
            req,
            res,
            messages,
            model,
            maxTokens: max_tokens || 500,
            temperature,
            clientId: client_id,
            retrievalSnapshotId: retrieval_snapshot_id || null,
            scene: scene || 'unknown',
            operator,
            promptVersion: prompt_version || null,
            routeName: 'minimax',
        });
        if (!result) return;

        res.json(result);
    } catch (err) {
        console.error('MiniMax proxy error:', err);
        if (err.clientPayload) {
            return res.status(err.statusCode || 500).json(err.clientPayload);
        }
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// POST /api/ai/system-prompt — 兼容端点，构建完整 system prompt（与 sft-export 对齐）
// 新主链路改为 /api/ai/generate-candidates 单次完成 prompt + candidate generation
router.post('/ai/generate-candidates', async (req, res) => {
    try {
        const {
            client_id,
            scene,
            operator,
            topicContext,
            richContext,
            conversationSummary,
            query_text,
            latest_user_message,
            messages,
            model,
            max_tokens,
            temperature,
        } = req.body || {};

        const result = await generateReplyCandidates({
            req,
            res,
            clientId: client_id,
            operator,
            scene,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            queryText: query_text || '',
            latestUserMessage: latest_user_message || '',
            messages,
            model,
            maxTokens: max_tokens || 500,
            temperature,
            routeName: 'generate-candidates',
        });
        if (!result) return;

        res.json(result);
    } catch (err) {
        console.error('POST /api/ai/generate-candidates error:', err);
        if (err.clientPayload) {
            return res.status(err.statusCode || 500).json(err.clientPayload);
        }
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

router.post('/ai/system-prompt', async (req, res) => {
    try {
        const {
            client_id,
            scene,
            operator,
            topicContext,
            richContext,
            conversationSummary,
            query_text,
            latest_user_message,
        } = req.body;

        const result = await buildReplySystemPrompt({
            req,
            res,
            clientId: client_id,
            operator,
            scene,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            queryText: query_text || '',
            latestUserMessage: latest_user_message || '',
        });
        if (!result) return;

        res.json({
            systemPrompt: result.systemPrompt,
            version: result.systemPromptVersion,
            operator: result.operator,
            operatorDisplayName: result.operatorDisplayName,
            operatorConfigured: result.operatorConfigured,
            retrieval_snapshot_id: result.retrievalSnapshotId,
        });
    } catch (err) {
        console.error('POST /api/ai/system-prompt error:', err);
        if (err.clientPayload) {
            return res.status(err.statusCode || 500).json(err.clientPayload);
        }
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// POST /api/translate — 翻译接口（固定 MiniMax + 系统提示）
router.post('/translate', async (req, res) => {
    try {
        const { text, role, timestamp, texts } = req.body;
        if (text !== undefined) {
            const result = await aiService.translateText(text, role, timestamp);
            return res.json(result);
        }

        if (!Array.isArray(texts) || texts.length === 0) {
            return res.json([]);
        }

        const result = await aiService.translateBatch(texts);
        return res.json(result);
    } catch (err) {
        console.error('POST /api/translate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/generate — 独立 OpenAI 生成接口
router.post('/ai/generate', async (req, res) => {
    try {
        const { messages, systemPrompt, temperatures = [0.8, 0.4] } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'messages is required and must be an array' });
        }

        if (process.env.USE_OPENAI !== 'true') {
            return res.status(503).json({
                success: false,
                error: 'OpenAI not enabled. Set USE_OPENAI=true in .env to enable.',
                provider: 'minimax',
            });
        }

        const { generateCandidates } = require('../utils/openai');
        const candidates = await generateCandidates(systemPrompt || '', messages, temperatures);
        res.json({ success: true, candidates });
    } catch (err) {
        console.error('AI generate error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
module.exports._private = {
    resolveAiRequestScope,
};
