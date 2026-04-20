/**
 * Update Yiyun operator_experiences with April 2026 config
 */
const { getDb, closeDb } = require('../db.js');
const fs = require('fs');
const path = require('path');

async function updateYiyunConfig() {
    const db = getDb();

    try {
        const draftPath = path.join(__dirname, '../docs/rag/operator-config/yiyun-apr-2026-draft.json');
        const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

        const systemPromptBase = `[BASE_PROMPT]

【Yiyun 专属规则 - 2026年4月版】
- 一问一答，先回答直接问题，再给一个下一步
- 语气保守、简洁，不做夸张承诺
- 邀请码/注册/WhatsApp/用户名跟进要清楚，但不要连续施压
- 月费说明优先使用"有可用补贴或 eligible earnings 时可扣除"的口径
- MCN 解释以"权限、跟踪、支持"为主，不与其他 MCN 对立
- 遇到技术问题先安抚，再给排查或 tech follow-up
- 不承诺 guaranteed earnings、guaranteed safety、exact payout date`;

        const sceneConfig = JSON.stringify(draft.scene_config);
        const forbiddenRules = JSON.stringify(draft.forbidden_rules);

        const result = await db.prepare(`
            UPDATE operator_experiences
            SET
                description = ?,
                system_prompt_base = ?,
                scene_config = ?,
                forbidden_rules = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE operator = 'Yiyun'
        `).run(
            draft.description,
            systemPromptBase,
            sceneConfig,
            forbiddenRules
        );

        console.log('✓ Updated Yiyun config:', result);

        // Verify
        const updated = await db.prepare('SELECT * FROM operator_experiences WHERE operator = ?').get('Yiyun');
        console.log('\n✓ Verified update:');
        console.log('  - operator:', updated.operator);
        console.log('  - description:', updated.description);
        console.log('  - system_prompt_base length:', updated.system_prompt_base.length);

        // MySQL JSON fields are already parsed as objects
        const sceneConfigObj = typeof updated.scene_config === 'string'
            ? JSON.parse(updated.scene_config)
            : updated.scene_config;
        const forbiddenRulesArr = typeof updated.forbidden_rules === 'string'
            ? JSON.parse(updated.forbidden_rules)
            : updated.forbidden_rules;

        console.log('  - scene_config keys:', Object.keys(sceneConfigObj).length);
        console.log('  - forbidden_rules count:', forbiddenRulesArr.length);
        console.log('  - updated_at:', updated.updated_at);

    } catch (e) {
        console.error('✗ Error:', e.message);
        throw e;
    } finally {
        await closeDb();
    }
}

updateYiyunConfig();
