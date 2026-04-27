---
title: RAG Knowledge Source Docs
date: 2026-04-27
project: wa-crm-v2
type: standard
source_path: docs/DOCUMENT_RETENTION_AUDIT_20260427.md
status: active
tags:
  - wa-crm-v2
  - memory
  - rag
  - knowledge-source
---

# RAG Knowledge Source Docs

## Summary

The active RAG and knowledge-source docs are still useful, but several dated notes are historical. Future agents should start from the standard, manifest, and active approved sources rather than old runtime alignment notes.

## Active References

- Knowledge source standard: `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md`
- OpenAI hosted RAG runbook: `docs/rag/OPENAI_RAG_RUNBOOK.md`
- Local rule retrieval design: `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md`
- Local rule retrieval implementation: `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md`
- April SOP mapping: `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md`
- Manifest: `docs/rag/knowledge-manifest.json`
- Templates: `docs/rag/templates/POLICY_TEMPLATE.md`, `docs/rag/templates/SOP_TEMPLATE.md`
- Shadow cases: `docs/rag/shadow-cases/local-rule-shadow-cases.json`

## Active Source Set

Approved or operational sources under `docs/rag/sources/`:

- `faq-moras-product-mechanics-and-support-apr-2026-v1.md`
- `playbook-yiyun-onboarding-and-payment-apr-2026-v1.md`
- `policy-trial-pack-v1.md`
- `sop-creator-outreach-apr-2026-v2.md`
- `sop-product-selection-and-posting-safety-v1.md`
- `sop-violation-appeal-and-risk-control-v1.md`

Historical source:

- `sop-creator-outreach-mar-2026-v1.md` should not override April SOP unless explicitly selected for comparison.

## Current Boundaries

- LightRAG is not part of the WA CRM v2 RAG path. The broken `LightRAG` gitlink was removed and local LightRAG checkouts should stay outside source control.
- Hard policy and SOP changes should go through `knowledge-manifest.json`.
- Do not inject draft/deprecated sources into production retrieval unless explicitly requested.
- Local rule retrieval remains important because `server/services/localRuleRetrievalService.js` is active and template/media behavior depends on its output.
- The old RAG session summary and 2026-04-16 runtime alignment note were consolidated into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`.
- Use current provider/runtime configuration and the active RAG docs above before changing retrieval behavior.

## Cleanup Reminder

Before deleting RAG docs, run a filename reference search and verify `knowledge-manifest.json` does not point to the removed file.
