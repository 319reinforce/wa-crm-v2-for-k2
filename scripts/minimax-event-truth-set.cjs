#!/usr/bin/env node
require('dotenv').config();

const {
  detectEventsWithMiniMax,
} = require('../server/services/eventVerificationService');

const CASES = [
  {
    id: 'activation_trial_started',
    owner: 'Yiyun',
    text: 'I started the 7-day trial task pack today and used a few AI generations already.',
    expectedEvents: ['trial_7day'],
    expectedOverlays: [],
    expectedStage: 'activation',
  },
  {
    id: 'activation_monthly_active',
    owner: 'Yiyun',
    text: 'I want to keep doing the monthly challenge, the $20 monthly fee can come from my video subsidy.',
    expectedEvents: ['monthly_challenge'],
    expectedOverlays: [],
    expectedStage: 'activation',
  },
  {
    id: 'retention_agency_bound',
    owner: 'Beau',
    text: 'I signed the Drifto agency agreement already. What should I post this week?',
    expectedEvents: ['agency_bound'],
    expectedOverlays: [],
    expectedStage: 'retention',
  },
  {
    id: 'revenue_verified_language',
    owner: 'Beau',
    text: 'Congrats, you reached the $5k GMV milestone. Let us confirm your reward settlement date.',
    expectedEvents: ['gmv_milestone'],
    expectedOverlays: [],
    expectedStage: 'revenue',
  },
  {
    id: 'revenue_claim_pending',
    owner: 'Yiyun',
    text: 'My GMV is around $9400 but I cannot see it in the dashboard. Can you check how commission will be paid?',
    expectedEvents: ['gmv_milestone'],
    expectedOverlays: ['revenue_claim_pending_verification'],
    expectedStage: 'retention',
  },
  {
    id: 'risk_not_terminated',
    owner: 'Yiyun',
    text: 'My account is banned and I cannot post now. I still need to know how to get paid for old sales.',
    expectedEvents: [],
    expectedOverlays: ['risk_control_active', 'settlement_blocked'],
    expectedStage: 'retention',
  },
  {
    id: 'referral_overlay',
    owner: 'Beau',
    text: 'My friend wants to join too. Can you send me the referral code so I can invite her?',
    expectedEvents: ['referral'],
    expectedOverlays: ['referral_active'],
    expectedStage: null,
  },
  {
    id: 'do_not_contact_terminal',
    owner: 'Beau',
    text: 'Please do not contact me again about this program.',
    expectedEvents: ['do_not_contact'],
    expectedOverlays: [],
    expectedStage: 'terminated',
  },
  {
    id: 'opt_out_terminal',
    owner: 'Yiyun',
    text: 'I decided to opt out of the trial. I do not want to continue the program.',
    expectedEvents: ['opt_out'],
    expectedOverlays: [],
    expectedStage: 'terminated',
  },
  {
    id: 'weak_generic_followup',
    owner: 'Beau',
    text: 'Just checking in to see how things are going this week.',
    expectedEvents: [],
    expectedOverlays: [],
    expectedStage: null,
  },
];

function hasAll(actual = [], expected = []) {
  return expected.every((item) => actual.includes(item));
}

function intersects(actual = [], forbidden = []) {
  return forbidden.some((item) => actual.includes(item));
}

function fakeDbConn() {
  return {
    prepare() {
      return {
        async get() { return null; },
        async all() { return []; },
      };
    },
  };
}

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const only = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
  const cases = only.size > 0 ? CASES.filter((item) => only.has(item.id)) : CASES;
  const results = [];

  for (const item of cases) {
    const ret = await detectEventsWithMiniMax({
      dbConn: fakeDbConn(),
      creatorId: 0,
      owner: item.owner,
      text: item.text,
      sourceAnchor: null,
      contextWindow: { before: 0, after: 0 },
    });
    const detected = ret.normalized.detected || [];
    const eventKeys = [...new Set(detected.map((row) => row.event_key))];
    const overlays = [...new Set([
      ...(ret.normalized.overlays || []),
      ...detected.flatMap((row) => row.overlays || []),
    ])];
    const stageSuggestions = [...new Set([
      ret.normalized.lifecycle_stage_suggestion,
      ...detected.map((row) => row.lifecycle_stage_suggestion),
    ].filter(Boolean))];
    const pass = hasAll(eventKeys, item.expectedEvents)
      && hasAll(overlays, item.expectedOverlays)
      && !intersects(eventKeys, item.forbiddenEvents || [])
      && (item.expectedStage ? stageSuggestions.includes(item.expectedStage) : true);

    results.push({
      id: item.id,
      pass,
      eventKeys,
      overlays,
      stageSuggestions,
      model: ret.model,
    });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${item.id}`);
    console.log(`  events: ${eventKeys.join(', ') || '-'}`);
    console.log(`  overlays: ${overlays.join(', ') || '-'}`);
    console.log(`  stages: ${stageSuggestions.join(', ') || '-'}`);
  }

  const passed = results.filter((item) => item.pass).length;
  console.log(`\nMiniMax truth set: ${passed}/${results.length} passed`);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
