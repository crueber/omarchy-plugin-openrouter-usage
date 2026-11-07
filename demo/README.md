# Demo fixture

`fetch-demo.js` is a synthetic stand-in for `scripts/fetch.js`: it makes no
network request and returns an invented OpenRouter key limit ($20/month),
$12.40 current-cycle spend, $8.00 previous-cycle spend, and $35 account
credits. It is what the README preview and bar screenshot were generated from.

## Reproducing the preview

`demo-session.sh` swaps in `fetch-demo.js` for the live helper, clears the
cache, and restores both when you press Enter or exit. Treat the cache as
private even though it never contains the API key: it has spending, credits,
and cycle history. The script creates its work directory with `mktemp -d`
(mode `0700`), writes backups as mode `0600`, and removes the directory after a
successful restore.

Terminal 1:

```bash
demo/demo-session.sh
```

Terminal 2, once the demo helper is active:

```bash
omarchy-shell shell toggle crueber.openrouter-usage
# capture the popup and bar, then close it
omarchy-shell shell hide crueber.openrouter-usage
```

Press Enter in terminal 1. The script restores the real helper and cache,
rescans the plugin, and removes its private work directory. If a restore step
fails it keeps the mode-`0700` backup directory and prints its path instead of
deleting it.

The demo never reads `OPENROUTER_API_KEY` or the OpenCode auth file.
