# Changelog

## 1.1.0 — 2026-11-06

- Hide the bar meter/dollar text while the current cycle spend is zero; the
  OpenRouter mark stays visible and clickable, and the popup still shows the
  zero-spend cycle, limit, and reset details.

## 1.0.0 — 2026-11-06

- Initial OpenRouter usage widget: key-based spend/limit meter using
  `/api/v1/key`, with account credits from `/api/v1/credits`.
- Uses the OpenRouter key already stored by OpenCode, with
  `OPENROUTER_API_KEY`/auth-file override; the key is never cached.
- Default monthly interval, honouring the key's own reset interval and date.
- Keeps one current and one previous completed cycle locally; yellow when the
  current cycle is over the previous spend, orange at 90%, red at the limit.
- No-limit keys show dollars until a previous cycle exists, then use that
  previous spend as the effective limit; over it, dollars are shown again.
