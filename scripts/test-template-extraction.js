/**
 * 测试标准话术检索 API
 */
const { retrieveLocalRules, loadSourceContent, extractTemplateFromSource } = require('../server/services/localRuleRetrievalService');

console.log('='.repeat(80));
console.log('测试标准话术检索功能');
console.log('='.repeat(80));
console.log();

// 测试用例 1: Yiyun - 月费咨询
console.log('[测试 1] Yiyun - 月费咨询');
const sources1 = retrieveLocalRules({
    scene: 'monthly_inquiry',
    operator: 'Yiyun',
    userMessage: 'Do I need to pay the $20 monthly fee upfront?',
    maxSources: 1
});

if (sources1.length > 0) {
    console.log(`✓ 检索到 ${sources1.length} 个知识源`);
    console.log(`  - ID: ${sources1[0].id}`);
    console.log(`  - 标题: ${sources1[0].title}`);
    console.log(`  - 分数: ${sources1[0].score}`);

    const content = loadSourceContent(sources1[0]);
    if (content) {
        console.log(`✓ 加载内容成功 (${content.length} 字符)`);

        const template = extractTemplateFromSource(content, sources1[0].id);
        if (template) {
            console.log(`✓ 提取话术成功:`);
            console.log('---');
            console.log(template);
            console.log('---');
        } else {
            console.log('✗ 提取话术失败');
        }
    } else {
        console.log('✗ 加载内容失败');
    }
} else {
    console.log('✗ 未检索到知识源');
}

console.log();

// 测试用例 2: Beau - 发帖安全
console.log('[测试 2] Beau - 发帖安全');
const sources2 = retrieveLocalRules({
    scene: 'follow_up',
    operator: 'Beau',
    userMessage: 'Can I post more than 5 videos per day?',
    maxSources: 1
});

if (sources2.length > 0) {
    console.log(`✓ 检索到 ${sources2.length} 个知识源`);
    console.log(`  - ID: ${sources2[0].id}`);
    console.log(`  - 标题: ${sources2[0].title}`);
    console.log(`  - 分数: ${sources2[0].score}`);

    const content = loadSourceContent(sources2[0]);
    if (content) {
        const template = extractTemplateFromSource(content, sources2[0].id);
        if (template) {
            console.log(`✓ 提取话术成功 (${template.length} 字符)`);
        } else {
            console.log('✗ 提取话术失败');
        }
    }
} else {
    console.log('✗ 未检索到知识源');
}

console.log();
console.log('='.repeat(80));
console.log('测试完成');
console.log('='.repeat(80));
