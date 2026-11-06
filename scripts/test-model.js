#!/usr/bin/env node
'use strict'

// Round-trip the OpenRouter model helpers without network or QML.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const repo = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(repo, 'Model.js'), 'utf8')
  .replace(/^\.pragma library\s*$/m, '')
const context = {
  console, Date, JSON, Math, String, Number, Array, Object, isFinite
}
vm.createContext(context)
vm.runInContext(source, context)

const now = Date.UTC(2026, 10, 6, 12, 0, 0) // 2026-11-06
const cycleEnd = Date.UTC(2026, 11, 1, 0, 0, 0) // 2026-12-01
const cycleStart = Date.UTC(2026, 10, 1, 0, 0, 0) // 2026-11-01
const prevEnd = cycleStart
const prevStart = Date.UTC(2026, 9, 1, 0, 0, 0) // 2026-10-01

function payload(key, credits) {
  return JSON.stringify({ ok: true, fetchedAt: now, key, credits: credits || null })
}

function reportFor(limit, spend, reset, end, credits) {
  const parsed = context.parseResult(payload({
    label: 'test key',
    is_free_tier: false,
    limit: limit,
    limit_reset: reset,
    limit_remaining: limit === null ? null : Math.max(0, limit - spend),
    effective_budget: limit === null ? null : {
      limit_usd: limit,
      spend_usd: spend,
      remaining_usd: Math.max(0, limit - spend),
      reset_interval: reset,
      resets_at: new Date(end).toISOString()
    },
    usage: spend,
    usage_daily: 0,
    usage_weekly: spend,
    usage_monthly: spend
  }, credits || { total_credits: 100, total_usage: 90 }), now)
  assert.ok(parsed && parsed.ok, 'parseResult')
  return parsed.report
}

const report = reportFor(20, 5, 'monthly', cycleEnd)
assert.equal(report.limit, 20)
assert.equal(report.spend, 5)
assert.equal(report.resetInterval, 'monthly')
assert.equal(report.cycle.start, cycleStart)
assert.equal(report.cycle.end, cycleEnd)
assert.equal(report.credits.remaining, 10)
assert.equal(context.formatCurrency(report.spend), '$5.00')

let history = context.advanceHistory(context.emptyHistory(), report, now)
assert.ok(history.current)
assert.equal(history.previous, null)

// Spend only grows within a cycle.
history = context.advanceHistory(history, { ...report, spend: 3 }, now + 1000)
assert.equal(history.current.spend, 5)

// Complete the current cycle and start the next.
const prevCycle = {
  ...history.current,
  key: 'monthly:' + prevEnd,
  start: prevStart,
  end: prevEnd,
  spend: 4,
  lastObservedAt: prevEnd - 3600000
}
const currentReport = reportFor(20, 6, 'monthly', cycleEnd)
currentReport.cycle = {
  key: 'monthly:' + cycleEnd,
  start: cycleStart,
  end: cycleEnd,
  interval: 'monthly',
  spend: 6,
  limit: 20
}
const transitioned = context.advanceHistory(
  { current: prevCycle, previous: null },
  currentReport,
  now
)
assert.ok(transitioned.previous, 'previous cycle retained')
assert.equal(transitioned.previous.spend, 4)
assert.equal(transitioned.current.spend, 6)

// A stale/incomplete prior cycle is not used as a baseline.
const incomplete = context.advanceHistory(
  { current: { ...prevCycle, lastObservedAt: prevEnd - 48 * 3600000 }, previous: null },
  currentReport,
  now
)
assert.equal(incomplete.previous, null, 'incomplete previous is dropped')

// Limited key: yellow for over previous, orange >=90%, red at limit.
function stateFor(limit, spend, previousSpend) {
  const history = previousSpend === null ? context.emptyHistory() : {
    current: { ...currentReport.cycle, spend: spend, limit: limit, lastObservedAt: now },
    previous: {
      key: 'monthly:' + prevEnd,
      start: prevStart,
      end: prevEnd,
      interval: 'monthly',
      spend: previousSpend,
      limit: limit,
      lastObservedAt: prevEnd - 3600000
    }
  }
  const r = reportFor(limit, spend, 'monthly', cycleEnd)
  return context.comparison(r, history)
}

assert.equal(stateFor(20, 5, 4).color, 'yellow')
assert.equal(stateFor(20, 5, 5).mode, 'meter')
assert.equal(stateFor(20, 18, 4).color, 'orange')
assert.equal(stateFor(20, 20, 4).color, 'critical')
assert.equal(stateFor(20, 5, null).mode, 'meter')

// No key limit: spend only until a previous cycle exists; then previous spend
// is the effective limit; over it, spend only again.
const noLimitNoPrev = stateFor(null, 3, null)
assert.equal(noLimitNoPrev.mode, 'dollars')
assert.equal(noLimitNoPrev.color, 'normal')
assert.equal(context.barText(reportFor(null, 3, 'monthly', cycleEnd), noLimitNoPrev), '$3.00')

const noLimitUnder = stateFor(null, 4, 5)
assert.equal(noLimitUnder.mode, 'meter')
assert.equal(noLimitUnder.percent, 80)
assert.equal(noLimitUnder.color, 'normal')

const noLimitAt = stateFor(null, 5, 5)
assert.equal(noLimitAt.mode, 'meter')
assert.equal(noLimitAt.percent, 100)
assert.equal(noLimitAt.color, 'critical')

const noLimitOver = stateFor(null, 6, 5)
assert.equal(noLimitOver.mode, 'dollars')
assert.equal(noLimitOver.color, 'yellow')
assert.equal(context.barText(reportFor(null, 6, 'monthly', cycleEnd), noLimitOver), '$6.00')

// Cache: one current and one previous cycle, no API key, small.
const cacheRaw = context.serializeCache(report, transitioned, now, now, 0, '')
assert.ok(cacheRaw.length < 4096, 'cache stays small: ' + cacheRaw.length)
assert.ok(cacheRaw.indexOf('Bearer') === -1, 'cache has no auth header')
const cached = context.parseCache(cacheRaw, now)
assert.ok(cached.report)
assert.equal(cached.report.spend, 5)
assert.ok(cached.history.previous)
assert.equal(cached.history.previous.spend, 4)

// The tooltip includes the comparison and credits.
const tip = context.tooltip(currentReport, context.comparison(currentReport, transitioned), transitioned, now)
assert.ok(tip.indexOf('Previous cycle') >= 0)
assert.ok(tip.indexOf('Account credits') >= 0)

console.log('ok — limited ' + context.percentText(stateFor(20, 18, 4).percent)
  + ', no-limit over ' + noLimitOver.mode + '/' + noLimitOver.color
  + ', cache ' + cacheRaw.length + ' bytes')
