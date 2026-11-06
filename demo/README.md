# Demo fixture

`fetch-demo.js` is a synthetic stand-in for `scripts/fetch.js`: it makes no
network request and returns an invented OpenRouter key limit ($20/month),
$12.40 current-cycle spend, $8.00 previous-cycle spend, and $35 account
credits. It is what the README preview and bar screenshot were generated from.

To reproduce a screenshot:

```bash
# back up the real helper and cache
cp ~/.config/omarchy/plugins/crueber.openrouter-usage/scripts/fetch.js /tmp/fetch-real.js
cp ~/.cache/openrouter-usage/usage.json /tmp/cache-real.json

# swap in the demo helper, clear the cache, and refresh
cp demo/fetch-demo.js ~/.config/omarchy/plugins/crueber.openrouter-usage/scripts/fetch.js
rm -f ~/.cache/openrouter-usage/usage.json
omarchy-shell openrouter-usage refresh

# open the popup and capture the card; then restore
omarchy-shell shell toggle crueber.openrouter-usage
# ...
cp /tmp/fetch-real.js ~/.config/omarchy/plugins/crueber.openrouter-usage/scripts/fetch.js
cp /tmp/cache-real.json ~/.cache/openrouter-usage/usage.json
omarchy-shell shell rescanPlugins
```

The demo never reads `OPENROUTER_API_KEY` or the OpenCode auth file.
