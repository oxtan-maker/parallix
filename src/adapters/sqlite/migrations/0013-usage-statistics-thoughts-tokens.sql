-- TASK-2362: record thinking/reasoning tokens as their own measurement column.
--
-- The qwen usage artifacts (`usage/token-usage-YYYY-MM.jsonl`) report
-- `thoughtsTokens` separately from input/output/cached. Folding them into
-- output_tokens would make the reasoning spend invisible, so they land in
-- their own column alongside the other token categories. Families that do not
-- report thinking tokens write 0, which is the same honest-zero the other
-- token columns already use.

ALTER TABLE usage_statistics
  ADD COLUMN thoughts_tokens INTEGER;
