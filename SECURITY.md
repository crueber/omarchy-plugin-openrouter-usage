# Security

This widget reads the OpenRouter API key already used by OpenCode and makes
read-only requests to OpenRouter on your behalf.

- Key sources, in order: `OPENROUTER_API_KEY`, a configured auth file, then
  `~/.local/share/opencode/auth.json` under `openrouter.key`.
- The key is used only as an HTTPS `Authorization` header. It is never printed,
  logged, passed as a command-line argument, written to `shell.json`, or stored
  in the plugin cache.
- Requests are limited to `GET https://openrouter.ai/api/v1/key` and
  `GET https://openrouter.ai/api/v1/credits`.
- The cache at `~/.cache/openrouter-usage/usage.json` (mode-`0700` directory)
  contains only displayed numbers, the masked key label, account-credit
  totals, and at most one current plus one previous cycle. No prompts, no
  conversations, and no credentials.

If you find a security issue, please use GitHub's private vulnerability
reporting on this repository rather than opening a public issue.
