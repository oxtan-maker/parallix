# Credit Reconciliation Spike (task-2362)

## Single-Run Calibration

**Date:** 2026-08-11
**Prompt:** "Write a one-line comment explaining what this function does: function fibonacci(n)..."
**Model:** qwen3.8-max
**Endpoint:** token-plan.ap-southeast-1.maas.aliyuncs.com (Bailian Token Plan Lite)

### Parallix-measured token breakdown

| Category | Tokens |
|---|---|
| inputTokens | 47,465 |
| outputTokens | 213 |
| cachedTokens | 0 |
| thoughtsTokens | 131 |
| totalTokens | 47,678 |
| API calls | 2 (main + managed-auto-memory-extractor) |
| Duration | 11.4s |

### Bailian console comparison

**Status:** Deferred — Bailian console usage analytics page not accessible from automated environment.

Per mission stop rule: *"Stop if credit reconciliation spike cannot access Bailian console — record as deferred, proceed with token-only telemetry."*

### Notes

- Client-side token counts are a **lower bound** on credit consumption. System prompt, tool schemas, accumulated history, and reasoning content also consume credits but are not all visible in client counters.
- Per-model deduction coefficients are not published by Alibaba Cloud.
- Console usage analytics (Token Plan > 我的订阅 / 用量分析) is the authoritative credit source.
- Parallix telemetry is the per-mission attribution layer; operator should cross-reference with console for credit planning.
- When console access is available, record before/after credit delta and compute observed ratio.

### Calibration ratio

Not yet computed. Requires manual Bailian console comparison. Label as single-run observation, not a published conversion rate.
