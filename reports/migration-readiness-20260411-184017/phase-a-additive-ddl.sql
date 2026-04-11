-- Prepared only. Do not execute until migration window is approved.
-- Phase A: additive, backward-compatible schema alignment.

ALTER TABLE sft_memory
  ADD COLUMN system_prompt_used TEXT COMMENT '推理时实际使用的完整 system prompt';
