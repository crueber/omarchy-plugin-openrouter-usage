# AGENTS.md

OpenRouter Usage — an Omarchy shell bar widget for the OpenRouter API key's
own spend/limit. Reads the key already used by OpenCode, keeps one previous
cycle locally, and never caches the key.

## Layout

- `manifest.json` — plugin id, bar-widget entry point, settings schema.
- `Panel.qml` — bar widget and popup; fetch/cache/leader lifecycle.
- `OpenRouterMark.qml` — official OpenRouter glyph as a QML vector.
- `Model.js` — API parsing, cycle history, bar state, cache, poll helpers.
- `scripts/fetch.js` — Node helper: resolves the key and fetches
  `/api/v1/key` plus `/api/v1/credits`.
- `scripts/install.sh`, `scripts/validate.sh`, `scripts/test-model.js`.

## Source and deploy

- Source of truth: this repository.
- Live copy: `~/.config/omarchy/plugins/crueber.openrouter-usage/`.
- Deploy with `./scripts/install.sh`; it copies the runtime files, validates,
  rescans, and enables the widget if needed.
- Do **not** put a `.git` directory inside the live plugin folder. Quickshell
  watches that tree and a checkout can trigger reload races.

## Key handling (critical)

1. `scripts/fetch.js` resolves the key in this order:
   `OPENROUTER_API_KEY`, then `--auth-file`/`OPENROUTER_AUTH_FILE`, then
   `~/.local/share/opencode/auth.json` under `openrouter.key`.
2. The key is used only in an HTTPS `Authorization` header. Never print it,
   put it in an error, pass it as a command-line argument, or write it to the
   cache or `shell.json`.
3. Do not add a `key` setting. An `authFile` path setting is fine; the key
   stays in the file. CI must not need a real key.

## API and bar model

- `GET https://openrouter.ai/api/v1/key` returns `effective_budget`
  (`limit_usd`, `spend_usd`, `remaining_usd`, `reset_interval`, `resets_at`),
  top-level `limit`/`limit_reset`, and `usage*` fields.
- Use `effective_budget.spend_usd` for the current cycle; fall back to
  `usage_monthly`/`usage_weekly`/`usage_daily` when absent.
- Use `effective_budget.limit_usd`, then top-level `limit`, as the key limit.
  Absent/zero means **no limit**.
- Default the interval to monthly when the API gives no reset interval.
- `/api/v1/credits` is optional and gives account credits; a failure there must
  not fail the key reading.

## Cycle history

- Keep exactly **one current and one previous** cycle. No history array.
- A cycle is `{key, start, end, interval, spend, limit, lastObservedAt}`.
- Spend only grows within a cycle; keep the maximum observed.
- When the reset changes forward, archive the old current as previous only if
  it was observed near its end (within 6 h) and the new cycle is adjacent
  (within `min(interval/4, 24 h)`). Otherwise drop the baseline rather than
  compare against a partial/missed cycle.
- Cache stays small (well under 4 KiB). It stores only the displayed numbers,
  masked label, credits, and the two cycle records.

## Bar/color rules

- Limited key: meter of `spend / limit`; hide the meter when spend is zero.
- No limit: hide the dollar text at zero spend; dollars until a previous complete cycle exists; then previous
  spend is the effective limit and a meter is shown. If current spend exceeds
  previous spend, show dollars only and yellow.
- Color precedence: red at the effective limit, orange >= 90%, yellow when
  current spend > previous cycle, otherwise foreground.
- `barText` is empty in meter mode; `heroDetail` is percent in meter mode and
  dollars in dollars mode.

## Testing

- `./scripts/validate.sh`
- `node scripts/test-model.js` — parsing, history transitions, all color
  branches, cache round-trip; no network.
- `omarchy plugin validate ~/.config/omarchy/plugins/crueber.openrouter-usage`
- `omarchy-shell shell rescanPlugins`; prefer rescan over restarting.
- Live check: `omarchy-shell openrouter-usage text` and
  `omarchy-shell openrouter-usage refresh`.
- Logs: `journalctl --user -t omarchy-shell --since "-2 min" | grep -i openrouter`.
- Cache check: `~/.cache/openrouter-usage/usage.json` must contain no key and
  at most one current + one previous cycle.
