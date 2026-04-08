/**
 * migrate-experience.js
 * 初始化 operator_experiences 表并预置 Beau/Yiyun 数据
 *
 * 用法: node migrate-experience.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crm.db');

const BEAU_EXPERIENCE = {
    operator: 'Beau',
    display_name: 'Beau 的运营体验',
    description: 'Beau 专属话术体系，20天Beta计划，$200激励，DRIFTO MCN',
    system_prompt_base: `[BASE_PROMPT]

【Beau 专属规则】
- Monthly Beta Program：20天周期，$200激励，$10/天
- GMV里程碑庆祝：$5k / $10k GMV
- 违规$10补偿承诺
- 透明成本：$3/视频，$2100/月/人
- 多账号管理（Trial / Referral）
- DRIFTO MCN 解释：100%佣金先到 agency 再 PayPal 返还
- 签约期仅2个月，到期自动解除`,
    scene_config: JSON.stringify({
        "trial_intro": "重点介绍20天Beta计划，$200激励",
        "beta_cycle_start": "结算时明确起始日期+激励金额",
        "violation_appeal": "提供申诉模板，承诺$10补偿",
        "mcn_binding": "解释DRIFTO结构，透明佣金流程",
        "gmv_milestone": "祝贺+$5k/$10k数据刺激",
        "content_request": "5个/天最佳，超6个TikTok降权"
    }),
    forbidden_rules: JSON.stringify([
        "不提Yiyun的话术",
        "不承诺Beta永久持续(around May正式发布)",
        "不在MCN犹豫时给压力"
    ]),
    priority: 1
};

const YIYUN_EXPERIENCE = {
    operator: 'Yiyun',
    display_name: 'Yiyun 的运营体验',
    description: 'Yiyun 专属话术体系，7天试用，$20月费，保守回复策略',
    system_prompt_base: `[BASE_PROMPT]

【Yiyun 专属规则】
- 7天试用任务包，20 AI generations/day
- $20月费：从视频补贴扣除，当周不足$20则不扣除
- 付款周期：每周一结算
- 一问一答，不过度展开，不主动延伸
- 保守回复策略：不承诺具体日期，不说100%保证`,
    scene_config: JSON.stringify({
        "onboarding_invite": "发送邀请码+下载指引，强调无需拍摄/买样品",
        "monthly_inquiry": "明确从补贴扣除，不预付",
        "video_not_loading": "先道歉，给tech反馈",
        "mcn_binding": "愿签发DRIFTO链接，保留20条/天+100%返还；不愿签只3条/天",
        "payment_issue": "确认PayPal信息，告知周一~周三周期"
    }),
    forbidden_rules: JSON.stringify([
        "不提Beta program",
        "不说guarantee/definitely",
        "不攻击其他MCN",
        "不发超过3条连续消息",
        "不在北京时间23:00后主动联系"
    ]),
    priority: 2
};

function migrate() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    console.log('🔄 开始迁移 operator_experiences...\n');

    // 创建表
    db.exec(`
        CREATE TABLE IF NOT EXISTS operator_experiences (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            operator            TEXT UNIQUE NOT NULL,
            display_name        TEXT NOT NULL,
            description         TEXT,
            system_prompt_base  TEXT NOT NULL,
            scene_config        TEXT,
            forbidden_rules     TEXT,
            is_active           INTEGER DEFAULT 1,
            priority            INTEGER DEFAULT 0,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_oe_operator ON operator_experiences(operator);
    `);
    console.log('✅ 表 operator_experiences 已创建/验证');

    // 插入或更新 Beau 体验
    const insertBeau = db.prepare(`
        INSERT OR REPLACE INTO operator_experiences
        (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `);
    insertBeau.run(
        BEAU_EXPERIENCE.operator,
        BEAU_EXPERIENCE.display_name,
        BEAU_EXPERIENCE.description,
        BEAU_EXPERIENCE.system_prompt_base,
        BEAU_EXPERIENCE.scene_config,
        BEAU_EXPERIENCE.forbidden_rules,
        BEAU_EXPERIENCE.priority
    );
    console.log('✅ Beau 体验已插入/更新');

    // 插入或更新 Yiyun 体验
    const insertYiyun = db.prepare(`
        INSERT OR REPLACE INTO operator_experiences
        (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `);
    insertYiyun.run(
        YIYUN_EXPERIENCE.operator,
        YIYUN_EXPERIENCE.display_name,
        YIYUN_EXPERIENCE.description,
        YIYUN_EXPERIENCE.system_prompt_base,
        YIYUN_EXPERIENCE.scene_config,
        YIYUN_EXPERIENCE.forbidden_rules,
        YIYUN_EXPERIENCE.priority
    );
    console.log('✅ Yiyun 体验已插入/更新');

    // 验证
    const rows = db.prepare('SELECT * FROM operator_experiences ORDER BY priority').all();
    console.log('\n📊 当前体验配置:');
    for (const row of rows) {
        const sceneConfig = row.scene_config ? JSON.parse(row.scene_config) : {};
        console.log(`  - ${row.operator}: ${row.display_name}`);
        console.log(`    场景数: ${Object.keys(sceneConfig).length}`);
        console.log(`    优先级: ${row.priority}`);
    }

    db.close();
    console.log('\n✅ 迁移完成!');
}

migrate();
