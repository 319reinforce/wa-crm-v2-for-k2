/**
 * End-to-End Test: Local Rules Integration
 * 测试 local rules 是否正确注入到 system prompt 中
 */

const { buildFullSystemPrompt } = require('../systemPromptBuilder.cjs');

async function testLocalRulesIntegration() {
    console.log('='.repeat(80));
    console.log('End-to-End Test: Local Rules Integration');
    console.log('='.repeat(80));
    console.log();

    const testCases = [
        {
            name: 'Yiyun - Monthly Inquiry',
            clientId: null,
            scene: 'monthly_inquiry',
            operator: 'Yiyun',
            expectedKeywords: ['$20/month', 'deducted from subsidy', 'eligible earnings']
        },
        {
            name: 'Beau - Posting Safety',
            clientId: null,
            scene: 'follow_up',
            operator: 'Beau',
            expectedKeywords: ['do not exceed 5/day', 'Spread posts']
        },
        {
            name: 'Yiyun - Trial Intro',
            clientId: null,
            scene: 'trial_intro',
            operator: 'Yiyun',
            expectedKeywords: ['7-day trial', '20 AI generations per day']
        }
    ];

    let passCount = 0;
    let failCount = 0;

    for (const testCase of testCases) {
        console.log(`\n[Test: ${testCase.name}]`);
        console.log(`Scene: ${testCase.scene} | Operator: ${testCase.operator}`);

        try {
            const result = await buildFullSystemPrompt(
                testCase.clientId,
                testCase.scene,
                [],
                { operator: testCase.operator }
            );

            const prompt = result.prompt;
            console.log(`Prompt length: ${prompt.length} chars`);

            // Check if local rules section exists
            if (prompt.includes('【本地知识库规则 — Local Rules】')) {
                console.log('✓ Local rules section found');
            } else {
                console.log('✗ Local rules section NOT found');
                failCount++;
                continue;
            }

            // Check expected keywords
            let allKeywordsFound = true;
            for (const keyword of testCase.expectedKeywords) {
                if (prompt.toLowerCase().includes(keyword.toLowerCase())) {
                    console.log(`  ✓ Found keyword: "${keyword}"`);
                } else {
                    console.log(`  ✗ Missing keyword: "${keyword}"`);
                    allKeywordsFound = false;
                }
            }

            if (allKeywordsFound) {
                console.log('✅ PASS');
                passCount++;
            } else {
                console.log('❌ FAIL');
                failCount++;
            }

        } catch (err) {
            console.log(`❌ FAIL - Error: ${err.message}`);
            failCount++;
        }
    }

    console.log();
    console.log('='.repeat(80));
    console.log(`Summary: ${passCount} passed, ${failCount} failed out of ${testCases.length} test cases`);
    console.log('='.repeat(80));

    process.exit(failCount > 0 ? 1 : 0);
}

testLocalRulesIntegration();
