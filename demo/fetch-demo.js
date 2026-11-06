#!/usr/bin/env node
'use strict'
const d = new Date()
const resets = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()
const out = {
  ok: true,
  fetchedAt: Date.now(),
  key: {
    label: 'demo key',
    is_free_tier: false,
    limit: 20,
    limit_reset: 'monthly',
    limit_remaining: 7.6,
    effective_budget: {
      limit_usd: 20,
      spend_usd: 12.4,
      remaining_usd: 7.6,
      reset_interval: 'monthly',
      resets_at: resets
    },
    usage: 42.1,
    usage_daily: 0,
    usage_weekly: 2.4,
    usage_monthly: 12.4
  },
  credits: { total_credits: 50, total_usage: 15 }
}
process.stdout.write(JSON.stringify(out) + '\n')
