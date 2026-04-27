---
title: Historical RAG Knowledge Source Docs
date: 2026-04-27
project: wa-crm-v2
type: standard
source_path: docs/DOCUMENT_RETENTION_AUDIT_20260427.md
status: historical
tags:
  - wa-crm-v2
  - memory
  - rag
  - knowledge-source
---

# Historical RAG Knowledge Source Docs

## Summary

The RAG and knowledge-source docs are now historical. The heavy RAG path is no longer the desired direction for WA CRM v2; future work should prefer per-user Markdown profile memory / skill memory. The manifest and source files under `docs/rag/` are retained only while current code still reads them.

## Active References

- Manifest: `docs/rag/knowledge-manifest.json`
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
- Do not expand the RAG document set.
- Do not add new OpenAI/vector RAG runbooks unless the product direction changes again.
- Local rule retrieval remains transitional because `server/services/localRuleRetrievalService.js` still reads the manifest.
- Future profile personalization should be designed around per-user Markdown profile files and skill-style retrieval.
- The old RAG session summary and 2026-04-16 runtime alignment note were consolidated into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`.
- Use current provider/runtime configuration and the active RAG docs above before changing retrieval behavior.

## Cleanup Reminder

Before deleting the remaining manifest/source files, update or remove the code paths that read them.
