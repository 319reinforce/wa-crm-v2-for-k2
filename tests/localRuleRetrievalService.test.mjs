import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    parseTemplateSections,
    retrieveTemplateSlots,
} = require('../server/services/localRuleRetrievalService.js');

test('parseTemplateSections extracts diverse SOP template headings with metadata', () => {
    const markdown = `
## Creator Outreach SOP

### Script A
Hi there! We found your TikTok page and think you could be a fit for our MCN collaboration.
If you're open, I can share the details and next steps here.

### Interested Reply
Thanks for your interest. I can walk you through the onboarding process and answer any setup questions.

## Product FAQ

### Q: How does Moras generate videos / product logic?
Moras uses trend and sales data to recommend products, then helps generate scripts and video drafts for review.

## Violation Appeal SOP

### Appeal Template
Dear TikTok Review Team, I would like to appeal this violation because the content is based on official product information.

### Risk-prevention reminder before posting
Please double-check color, shape, and pattern consistency before posting to reduce the chance of review issues.
`;

    const sections = parseTemplateSections(markdown, {
        id: 'sop-creator-outreach-mar-2026-v1',
        type: 'sop',
        priority: 1,
    });

    const byTitle = new Map(sections.map((section) => [section.title, section]));

    assert.equal(byTitle.get('Script A')?.topic_group, 'outreach_contact');
    assert.equal(byTitle.get('Script A')?.intent_key, 'first_outreach_soft_mcn');

    assert.equal(byTitle.get('Interested Reply')?.topic_group, 'followup_progress');
    assert.equal(byTitle.get('Interested Reply')?.intent_key, 'followup_interested_reply');

    assert.equal(byTitle.get('Q: How does Moras generate videos / product logic?')?.topic_group, 'product_mechanics');
    assert.equal(byTitle.get('Q: How does Moras generate videos / product logic?')?.intent_key, 'how_moras_works');

    assert.equal(byTitle.get('Appeal Template')?.topic_group, 'violation_risk_control');
    assert.equal(byTitle.get('Appeal Template')?.intent_key, 'appeal_template');

    assert.equal(byTitle.get('Risk-prevention reminder before posting')?.topic_group, 'violation_risk_control');
    assert.match(byTitle.get('Risk-prevention reminder before posting')?.text || '', /double-check color/i);
});

test('retrieveTemplateSlots resolves settlement topic context and returns template-first slots', () => {
    const result = retrieveTemplateSlots({
        operator: 'Yiyun',
        userMessage: 'how much is the monthly fee',
        recentMessages: [{ role: 'user', text: 'how much is the monthly fee' }],
    });

    assert.equal(result.context.topic_group, 'settlement_pricing');
    assert.equal(result.context.intent_key, 'monthly_fee_explain');
    assert.equal(result.context.scene_key, 'monthly_inquiry');
    assert.ok(result.slots.op1, 'op1 should exist for monthly fee query');
    assert.equal(result.slots.op1.topic_group, 'settlement_pricing');
    assert.equal(result.slots.op1.intent_key, 'monthly_fee_explain');
    assert.match(result.slots.op1.text, /\$20|monthly fee/i);
    assert.equal(result.template?.text, result.slots.op1.text);
});

test('retrieveTemplateSlots keeps violation alternatives within the same topic family', () => {
    const result = retrieveTemplateSlots({
        operator: 'Yiyun',
        userMessage: 'my appeal got rejected because of a violation',
        recentMessages: [{ role: 'user', text: 'my appeal got rejected because of a violation' }],
    });

    assert.equal(result.context.topic_group, 'violation_risk_control');
    assert.ok(result.slots.op1, 'violation query should have op1');
    assert.ok(result.slots.op2, 'violation query should have op2');
    assert.equal(result.slots.op1.topic_group, 'violation_risk_control');
    assert.equal(result.slots.op2.topic_group, 'violation_risk_control');

    for (const alternative of result.alternatives) {
        assert.equal(alternative.slot_role, 'alternative');
        assert.equal(alternative.topic_group, 'violation_risk_control');
    }
});

test('retrieveTemplateSlots uses the April outreach source for onboarding edge cases', () => {
    const emailOnly = retrieveTemplateSlots({
        operator: 'Yiyun',
        userMessage: 'I only want to communicate by email',
        recentMessages: [{ role: 'user', text: 'I only want to communicate by email' }],
    });

    assert.equal(emailOnly.context.topic_group, 'signup_onboarding');
    assert.equal(emailOnly.context.intent_key, 'username_followup');
    assert.equal(emailOnly.slots.op1?.source, 'sop-creator-outreach-apr-2026-v2');
    assert.equal(emailOnly.slots.op1?.title, 'Email-only Communication Reply');

    const notPosted = retrieveTemplateSlots({
        operator: 'Yiyun',
        userMessage: 'I generated my first video but have not posted it yet',
        recentMessages: [{ role: 'user', text: 'I generated my first video but have not posted it yet' }],
    });

    assert.equal(notPosted.context.topic_group, 'signup_onboarding');
    assert.equal(notPosted.context.intent_key, 'registered_not_posted');
    assert.equal(notPosted.slots.op1?.source, 'sop-creator-outreach-apr-2026-v2');
    assert.match(notPosted.slots.op1?.title || '', /Registered|WhatsApp New Creator Guide/);
});
