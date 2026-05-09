---
title: SSE And Deployment Current
date: 2026-05-09
project: wa-crm-v2
type: runbook
source_path: DEPLOY.md
related:
  - docs/SSE_HARDENING.md
status: active
tags:
  - wa-crm-v2
  - deploy
  - sse
  - baileys
---

# SSE And Deployment Current

## Summary

Deployment is now Baileys-oriented. `DEPLOY.md` is the active deployment guide, and `docs/SSE_HARDENING.md` remains the active runbook for SSE transport and Phase 5 lifecycle hardening.

## Deployment Baseline

- Runtime: Node.js + MySQL.
- WhatsApp direction: Baileys with `.baileys_auth`.
- Runtime state belongs under ignored `data/runtime-state/`.
- Generated reports belong under ignored `reports/`.
- Do not restore SQLite, `crm.db`, WWeb-heavy deployment, or Chrome/Puppeteer requirements as the target path.

## SSE Baseline

- SSE route and heartbeat live in `server/index.cjs` and `server/events/sseBus.js`.
- Proxy layers must not gzip, buffer, or idle-timeout the stream.
- Expected response basics: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Content-Encoding: identity`.
- Phase 5 hardening adds `SSE_MAX_CLIENTS`, scoped client metadata, initial `sse-meta` events, structured connect/disconnect/write-failure logs, and local reconnect/cleanup soak coverage.

## Follow-Ups

- When WWeb compatibility is removed in code, simplify deployment docs again.
- If horizontal scaling is needed, design Redis/pubsub, distributed quota, or a dedicated SSE gateway.
