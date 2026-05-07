#!/usr/bin/env node
/**
 * Validate May SOP template routing for the rollout scenarios.
 */

const { retrieveTemplateSlots } = require('../server/services/localRuleRetrievalService');

const MAY_SOURCE = 'sop-creator-outreach-may-2026-v1';

const cases = [
    {
        id: 'may-first-outreach',
        input: {
            scene: 'first_contact',
            userMessage: '首次建联 new creator outreach',
            currentTopic: { topic_group: 'outreach_contact', intent_key: 'first_outreach_fixed', scene_key: 'first_contact' },
        },
        expectedIntent: 'first_outreach_fixed',
        expectedTerms: ['this May', '$100 Challenge Bonus'],
    },
    {
        id: 'may-new-user-policy',
        input: {
            scene: 'monthly_inquiry',
            userMessage: 'What is the May new creator policy and $100 challenge?',
            currentTopic: { topic_group: 'settlement_pricing', intent_key: 'may_policy_overview', scene_key: 'monthly_inquiry' },
        },
        expectedIntent: 'may_policy_overview',
        expectedTerms: ['14-Day Challenge', '$100 Cash Subsidy'],
    },
    {
        id: 'may-existing-user-policy',
        input: {
            scene: 'gmv_inquiry',
            userMessage: '老用户政策 existing creators GMV rewards',
            currentTopic: { topic_group: 'settlement_pricing', intent_key: 'may_policy_overview', scene_key: 'payment_issue' },
        },
        expectedIntent: 'may_policy_overview',
        expectedTerms: ['For Existing Creators', 'Cumulative GMV'],
    },
    {
        id: 'may-mcn-binding',
        input: {
            scene: 'mcn_binding',
            userMessage: 'How do I bind MCN if I had another agency?',
            currentTopic: { topic_group: 'mcn_partnership', intent_key: 'mcn_explain', scene_key: 'mcn_binding' },
        },
        expectedIntent: 'mcn_explain',
        expectedTerms: ['TikTok only allows one MCN binding'],
    },
    {
        id: 'may-settlement',
        input: {
            scene: 'payment_issue',
            userMessage: 'How are payments settled?',
            currentTopic: { topic_group: 'settlement_pricing', intent_key: 'weekly_settlement', scene_key: 'payment_issue' },
        },
        expectedIntent: 'weekly_settlement',
        expectedTerms: ['Bi-Weekly Payouts'],
    },
    {
        id: 'may-posting-safety',
        input: {
            scene: 'content_request',
            userMessage: 'How many videos should I post per day and how do I stay safe?',
            currentTopic: { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_key: 'content_request' },
        },
        expectedIntent: 'posting_cadence',
        expectedTerms: ['Post no more than 5 videos per day'],
    },
    {
        id: 'may-product-logic',
        input: {
            scene: 'content_request',
            userMessage: 'How does Moras choose products?',
            currentTopic: { topic_group: 'product_mechanics', intent_key: 'product_logic', scene_key: 'content_request' },
        },
        expectedIntent: 'product_logic',
        expectedTerms: ['real-time sales data'],
    },
    {
        id: 'may-violation-appeal',
        input: {
            scene: 'violation_appeal',
            userMessage: 'My video got a violation, can you help with appeal?',
            currentTopic: { topic_group: 'violation_risk_control', intent_key: 'appeal_template', scene_key: 'violation_appeal' },
        },
        expectedIntent: 'appeal_template',
        expectedTerms: ['Dear TikTok Review Team'],
    },
];

let failed = 0;

for (const testCase of cases) {
    const result = retrieveTemplateSlots({ operator: 'Beau', maxSources: 5, ...testCase.input });
    const op1 = result.slots.op1;
    const text = op1?.text || '';
    const problems = [];

    if (!op1) problems.push('missing op1');
    if (op1?.source !== MAY_SOURCE) problems.push(`expected source ${MAY_SOURCE}, got ${op1?.source}`);
    if (op1?.intent_key !== testCase.expectedIntent) problems.push(`expected intent ${testCase.expectedIntent}, got ${op1?.intent_key}`);
    for (const term of testCase.expectedTerms || []) {
        if (!text.includes(term)) problems.push(`missing term: ${term}`);
    }

    if (problems.length > 0) {
        failed += 1;
        console.error(`[FAIL] ${testCase.id}`);
        for (const problem of problems) console.error(`  - ${problem}`);
        if (op1) console.error(`  - got: ${op1.title} (${op1.section_id}, score ${op1.matchScore})`);
    } else {
        console.log(`[OK] ${testCase.id}: ${op1.title}`);
    }
}

if (failed > 0) {
    console.error(`May template retrieval failed: ${failed}/${cases.length}`);
    process.exit(1);
}

console.log(`May template retrieval passed: ${cases.length}/${cases.length}`);
