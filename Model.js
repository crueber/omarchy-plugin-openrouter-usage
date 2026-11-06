.pragma library

// Pure helpers for the OpenRouter usage widget: API parsing, cycle history,
// bar state (meter vs dollars), formatting, cache and poll coordination.

function number(value) {
  var n = typeof value === "number" ? value : Number(value)
  return isFinite(n) ? n : null
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value))
}

function clampInt(value, low, high, fallback) {
  var n = number(value)
  if (n === null) return fallback
  return Math.round(clamp(n, low, high))
}

function text(value, max) {
  if (typeof value !== "string") return ""
  return value.slice(0, max || 200)
}

// Neutralise markup-shaped strings before they reach an Omarchy-owned text
// component whose format this plugin cannot set. Our own Text elements use
// Text.PlainText.
function plain(value, max) {
  return text(value, max).replace(/</g, "\u2039").replace(/>/g, "\u203A")
}

function positive(value) {
  var n = number(value)
  return n !== null && n > 0 ? n : null
}

function parseJson(raw) {
  var source = String(raw || "").replace(/^\uFEFF+/, "").trim()
  if (source === "" || source.length > 400000) return null
  try {
    return JSON.parse(source)
  } catch (e) {
    var start = source.indexOf("{")
    var end = source.lastIndexOf("}")
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(source.slice(start, end + 1))
    } catch (e2) {
      return null
    }
  }
}

function dateMs(value) {
  var direct = number(value)
  if (direct !== null) return direct > 1e12 ? direct : direct * 1000
  var parsed = Date.parse(value || "")
  return isFinite(parsed) ? parsed : 0
}

function formatCurrency(value) {
  var n = number(value)
  if (n === null) return "—"
  var sign = n < 0 ? "-" : ""
  var s = Math.abs(n).toFixed(2)
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return sign + "$" + s
}

function percentText(value) {
  var n = number(value)
  if (n === null) return "—"
  var rounded = Math.round(clamp(n, 0, 100) * 10) / 10
  return (rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1)) + "%"
}

function intervalMs(interval) {
  if (interval === "daily") return 86400000
  if (interval === "weekly") return 7 * 86400000
  if (interval === "monthly") return 30 * 86400000
  if (interval === "yearly") return 365 * 86400000
  return 0
}

function intervalName(interval) {
  if (interval === "daily") return "Daily"
  if (interval === "weekly") return "Weekly"
  if (interval === "monthly") return "Monthly"
  if (interval === "yearly") return "Yearly"
  return "No reset"
}

function validInterval(value) {
  var v = String(value || "").toLowerCase()
  if (v === "day" || v === "daily") return "daily"
  if (v === "week" || v === "weekly") return "weekly"
  if (v === "month" || v === "monthly") return "monthly"
  if (v === "year" || v === "yearly" || v === "annual") return "yearly"
  if (v === "total" || v === "lifetime" || v === "none") return "total"
  if (v === "") return "monthly"
  return "monthly"
}

function nextBoundary(interval, nowMs) {
  var d = new Date(nowMs)
  if (interval === "daily") {
    d.setUTCHours(24, 0, 0, 0)
    return d.getTime()
  }
  if (interval === "weekly") {
    var add = ((8 - d.getUTCDay()) % 7) || 7
    d.setUTCDate(d.getUTCDate() + add)
    d.setUTCHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (interval === "yearly") {
    return Date.UTC(d.getUTCFullYear() + 1, 0, 1)
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

function subtractInterval(endMs, interval) {
  var d = new Date(endMs)
  if (interval === "daily") return endMs - 86400000
  if (interval === "weekly") return endMs - 7 * 86400000
  if (interval === "yearly") {
    d.setUTCFullYear(d.getUTCFullYear() - 1)
    return d.getTime()
  }
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.getTime()
}

function usageFor(key, interval) {
  if (interval === "daily") return number(key.usage_daily)
  if (interval === "weekly") return number(key.usage_weekly)
  if (interval === "monthly") return number(key.usage_monthly)
  return number(key.usage)
}

function parseCredits(value) {
  if (!value || typeof value !== "object") return null
  var source = value.data && typeof value.data === "object" ? value.data : value
  var total = number(source.total_credits)
  if (total === null) total = number(source.total)
  var used = number(source.total_usage)
  if (used === null) used = number(source.used)
  if (total === null && used === null) return null
  total = total === null ? 0 : Math.max(0, total)
  used = used === null ? 0 : Math.max(0, used)
  return {
    total: total,
    used: used,
    remaining: Math.max(0, total - used)
  }
}

function cycleFor(interval, resetsAt, spend, limit, nowMs) {
  var kind = validInterval(interval)
  if (kind === "total") {
    return { key: "total", start: 0, end: 0, interval: "total", spend: spend, limit: limit }
  }
  var end = dateMs(resetsAt)
  if (!(end > nowMs)) end = nextBoundary(kind, nowMs)
  var start = subtractInterval(end, kind)
  return {
    key: kind + ":" + end,
    start: start,
    end: end,
    interval: kind,
    spend: spend,
    limit: limit
  }
}

function makeReport(key, creditsRaw, nowMs) {
  var k = key && typeof key === "object" ? key : {}
  var eb = k.effective_budget && typeof k.effective_budget === "object" ? k.effective_budget : {}
  var limit = positive(eb.limit_usd)
  if (limit === null) limit = positive(k.limit)

  var rawReset = eb.reset_interval || k.limit_reset || ""
  var reset = rawReset === null || rawReset === undefined || rawReset === "" ? "monthly" : validInterval(rawReset)
  if (limit === null && (rawReset === null || rawReset === undefined || rawReset === "")) reset = "monthly"

  var resetsAt = dateMs(eb.resets_at)
  var spend = number(eb.spend_usd)
  if (spend === null) spend = usageFor(k, reset)
  if (spend === null) spend = 0
  spend = Math.max(0, spend)

  var total = Math.max(0, number(k.usage) || 0)
  var monthly = Math.max(0, number(k.usage_monthly) || 0)
  var daily = Math.max(0, number(k.usage_daily) || 0)
  var weekly = Math.max(0, number(k.usage_weekly) || 0)
  var credits = parseCredits(creditsRaw)
  var cycle = cycleFor(reset, resetsAt, spend, limit, nowMs)
  var remaining = number(eb.remaining_usd)
  if (remaining === null) remaining = number(k.limit_remaining)

  return {
    ok: true,
    label: plain(k.label, 80),
    isFreeTier: k.is_free_tier === true,
    limit: limit,
    limitRemaining: remaining,
    resetInterval: reset,
    resetsAt: cycle.end,
    spend: spend,
    usageTotal: total,
    usageMonthly: monthly,
    usageDaily: daily,
    usageWeekly: weekly,
    credits: credits,
    cycle: cycle
  }
}

function parseResult(raw, nowMs) {
  var obj = parseJson(raw)
  if (!obj || typeof obj !== "object") return null
  if (obj.ok === false) return { ok: false, error: text(obj.error, 300) }
  if (obj.ok !== true) return null
  var now = number(nowMs) || Date.now()
  return { ok: true, report: makeReport(obj.key, obj.credits, now) }
}

// Rebuild a report from the small cache document.
function normalizeReport(data) {
  if (!data || typeof data !== "object") return null
  var limit = positive(data.limit)
  var reset = validInterval(data.resetInterval)
  var cycle = normalizeCycle(data.cycle)
  if (!cycle) return null
  var credits = parseCredits(data.credits)
  return {
    ok: true,
    label: plain(data.label, 80),
    isFreeTier: data.isFreeTier === true,
    limit: limit,
    limitRemaining: number(data.limitRemaining),
    resetInterval: reset,
    resetsAt: number(data.resetsAt) || cycle.end,
    spend: Math.max(0, number(data.spend) || 0),
    usageTotal: Math.max(0, number(data.usageTotal) || 0),
    usageMonthly: Math.max(0, number(data.usageMonthly) || 0),
    usageDaily: Math.max(0, number(data.usageDaily) || 0),
    usageWeekly: Math.max(0, number(data.usageWeekly) || 0),
    credits: credits,
    cycle: cycle
  }
}

function normalizeCycle(value) {
  if (!value || typeof value !== "object") return null
  var key = text(value.key, 100)
  var interval = validInterval(value.interval)
  var start = number(value.start) || 0
  var end = number(value.end) || 0
  if (key === "" || end <= 0) return null
  return {
    key: key,
    start: Math.max(0, start),
    end: end,
    interval: interval,
    spend: Math.max(0, number(value.spend) || 0),
    limit: positive(value.limit),
    lastObservedAt: Math.max(0, number(value.lastObservedAt) || 0)
  }
}

function normalizeHistory(value) {
  if (!value || typeof value !== "object") return { current: null, previous: null }
  var current = normalizeCycle(value.current)
  var previous = normalizeCycle(value.previous)
  if (!current) previous = null
  if (current && previous && previous.end > current.start) previous = null
  return { current: current, previous: previous }
}

function emptyHistory() {
  return { current: null, previous: null }
}

// Keep exactly one current and one previous completed cycle. Spend only ever
// grows inside a cycle, so a lower reading is ignored.
function advanceHistory(history, report, nowMs) {
  var hist = normalizeHistory(history)
  if (!report || !report.cycle || report.cycle.key === "total") return emptyHistory()

  var now = number(nowMs) || Date.now()
  var next = {
    key: report.cycle.key,
    start: report.cycle.start,
    end: report.cycle.end,
    interval: report.cycle.interval,
    spend: report.spend,
    limit: report.limit,
    lastObservedAt: now
  }

  if (!hist.current) {
    return { current: next, previous: null }
  }

  if (hist.current.key === next.key) {
    next.spend = Math.max(hist.current.spend, next.spend)
    next.lastObservedAt = now
    return { current: next, previous: hist.previous }
  }

  if (next.end > hist.current.end) {
    var span = intervalMs(hist.current.interval)
    var gap = next.start - hist.current.end
    var adjacent = gap >= -3600000 && gap <= Math.min(span * 0.25, 86400000)
    var complete = hist.current.lastObservedAt >= hist.current.end - 6 * 3600000
    return {
      current: next,
      previous: adjacent && complete ? hist.current : null
    }
  }

  return hist
}

function comparison(report, history) {
  var prev = history && history.previous ? history.previous : null
  var hasPrevious = prev !== null && prev.end > 0
  var limited = !!(report && report.limit !== null && report.limit > 0)
  var spend = report ? Math.max(0, number(report.spend) || 0) : 0
  var over = hasPrevious && spend > prev.spend
  var effectiveLimit = limited ? report.limit : (hasPrevious ? prev.spend : null)
  var percent = effectiveLimit !== null && effectiveLimit > 0
    ? clamp(spend / effectiveLimit * 100, 0, 100)
    : 0
  var barVisible = limited || (hasPrevious && prev.spend > 0 && spend <= prev.spend)

  var color = "normal"
  if (limited) {
    if (percent >= 100) color = "critical"
    else if (percent >= 90) color = "orange"
    else if (over) color = "yellow"
  } else if (over) {
    color = "yellow"
  } else if (barVisible) {
    if (percent >= 100) color = "critical"
    else if (percent >= 90) color = "orange"
  }

  return {
    hasPrevious: hasPrevious,
    previousSpend: hasPrevious ? prev.spend : null,
    over: over,
    limited: limited,
    effectiveLimit: effectiveLimit,
    percent: percent,
    barVisible: barVisible,
    mode: barVisible ? "meter" : "dollars",
    color: color,
    spend: spend
  }
}

function barText(report, state) {
  if (!report) return ""
  if (state && state.mode === "dollars") return formatCurrency(report.spend)
  return ""
}

function heroDetail(report, state) {
  if (!report || !state) return ""
  return state.mode === "meter" ? percentText(state.percent) : formatCurrency(report.spend)
}

function resetText(resetsAt, nowMs) {
  var target = number(resetsAt) || 0
  if (target <= 0) return "No reset"
  var diff = target - nowMs
  if (diff <= 0) return "Reset is due"
  var minutes = Math.floor(diff / 60000)
  var days = Math.floor(minutes / 1440)
  var hours = Math.floor((minutes % 1440) / 60)
  var mins = minutes % 60
  if (days >= 1) return "Resets in " + days + "d " + hours + "h"
  if (hours >= 1) return "Resets in " + hours + "h " + mins + "m"
  return "Resets in " + Math.max(1, mins) + "m"
}

function updatedText(lastFetchMs, nowMs) {
  var last = number(lastFetchMs) || 0
  if (last <= 0) return ""
  var seconds = Math.max(0, Math.floor((nowMs - last) / 1000))
  if (seconds < 5) return "Updated just now"
  if (seconds < 60) return "Updated " + seconds + "s ago"
  var minutes = Math.floor(seconds / 60)
  if (minutes < 60) return "Updated " + minutes + "m ago"
  return "Updated " + Math.floor(minutes / 60) + "h ago"
}

function tooltip(report, state, history, nowMs) {
  if (!report) return "OpenRouter usage"
  var lines = []
  var limit = report.limit
  if (state && state.mode === "meter") {
    lines.push("This cycle: " + formatCurrency(report.spend) + " of " + formatCurrency(state.effectiveLimit))
    lines.push("  " + percentText(state.percent) + " used")
  } else {
    lines.push("This cycle: " + formatCurrency(report.spend))
    if (!limit && state && state.over) lines.push("  over the previous cycle")
    else if (!limit) lines.push("  no key limit; spend only")
  }
  if (report.resetsAt > 0) lines.push("  " + resetText(report.resetsAt, nowMs))
  if (state && state.hasPrevious) {
    lines.push("Previous cycle: " + formatCurrency(state.previousSpend))
    var delta = report.spend - state.previousSpend
    if (delta > 0) lines.push("  " + formatCurrency(delta) + " over")
    else if (delta < 0) lines.push("  " + formatCurrency(-delta) + " under")
  }
  if (report.credits) lines.push("Account credits: " + formatCurrency(report.credits.remaining))
  return lines.join("\n")
}

// ------------------------------------------------------------ local cache
//
// A shell restart creates a fresh QML engine. The cache carries the last
// report and exactly one previous cycle. It never contains the API key.

var CACHE_VERSION = 1
var AUTO_MIN_MS = 60000
var FORCE_MIN_MS = 30000
var FAILURE_CAP_MS = 600000

function slimCycle(cycle) {
  if (!cycle) return null
  return {
    key: text(cycle.key, 100),
    start: number(cycle.start) || 0,
    end: number(cycle.end) || 0,
    interval: validInterval(cycle.interval),
    spend: Math.max(0, number(cycle.spend) || 0),
    limit: positive(cycle.limit),
    lastObservedAt: number(cycle.lastObservedAt) || 0
  }
}

function slimReport(report) {
  if (!report) return null
  return {
    label: text(report.label, 80),
    isFreeTier: report.isFreeTier === true,
    limit: positive(report.limit),
    limitRemaining: number(report.limitRemaining),
    resetInterval: validInterval(report.resetInterval),
    resetsAt: number(report.resetsAt) || 0,
    spend: Math.max(0, number(report.spend) || 0),
    usageTotal: Math.max(0, number(report.usageTotal) || 0),
    usageMonthly: Math.max(0, number(report.usageMonthly) || 0),
    usageDaily: Math.max(0, number(report.usageDaily) || 0),
    usageWeekly: Math.max(0, number(report.usageWeekly) || 0),
    credits: report.credits ? {
      total: number(report.credits.total) || 0,
      used: number(report.credits.used) || 0,
      remaining: number(report.credits.remaining) || 0
    } : null,
    cycle: slimCycle(report.cycle)
  }
}

function serializeCache(report, history, fetchedAt, attemptedAt, failures, error) {
  return JSON.stringify({
    version: CACHE_VERSION,
    fetchedAt: Math.max(0, Math.round(number(fetchedAt) || 0)),
    attemptedAt: Math.max(0, Math.round(number(attemptedAt) || 0)),
    failures: Math.round(clamp(number(failures) || 0, 0, 20)),
    error: text(error, 240),
    data: slimReport(report),
    history: {
      current: slimCycle(history ? history.current : null),
      previous: slimCycle(history ? history.previous : null)
    }
  }) + "\n"
}

function parseCache(raw, nowMs) {
  var obj = parseJson(raw)
  if (!obj || obj.version !== CACHE_VERSION) return null
  var now = number(nowMs) || Date.now()
  var fetchedAt = number(obj.fetchedAt) || 0
  var attemptedAt = number(obj.attemptedAt) || 0
  if (fetchedAt > now + 300000) fetchedAt = 0
  if (attemptedAt > now + 300000) attemptedAt = 0
  var report = normalizeReport(obj.data)
  var history = normalizeHistory(obj.history)
  if (!report) history = emptyHistory()
  return {
    fetchedAt: Math.max(0, fetchedAt),
    attemptedAt: Math.max(0, attemptedAt),
    failures: Math.round(clamp(number(obj.failures) || 0, 0, 20)),
    error: text(obj.error, 240),
    report: report,
    history: history
  }
}

function autoDelayMs(fetchedAt, attemptedAt, failures, refreshMs, nowMs) {
  var now = number(nowMs) || Date.now()
  var interval = Math.max(AUTO_MIN_MS, number(refreshMs) || 300000)
  var last = number(fetchedAt) || 0
  var attempt = number(attemptedAt) || 0
  var fails = Math.max(0, Math.round(number(failures) || 0))
  var delay = 0
  if (last > 0) delay = Math.max(delay, last + interval - now)
  if (attempt > 0) {
    var cooldown = AUTO_MIN_MS
    if (fails > 0) cooldown = Math.min(FAILURE_CAP_MS, AUTO_MIN_MS * Math.pow(2, Math.min(fails - 1, 4)))
    delay = Math.max(delay, attempt + cooldown - now)
  }
  return Math.max(0, delay)
}

// --------------------------------------------------------- poll coordination

var pollState = {
  leader: null,
  beat: 0,
  seq: 0,
  report: null,
  history: null,
  fetchedAt: 0,
  attemptedAt: 0,
  failures: 0,
  error: ""
}

function pollClaim(widget, nowMs) {
  if (pollState.leader === widget) {
    pollState.beat = nowMs
    return true
  }
  if (pollState.leader === null || nowMs - pollState.beat > 20000) {
    pollState.leader = widget
    pollState.beat = nowMs
    return true
  }
  return false
}

function pollRelease(widget) {
  if (pollState.leader === widget) pollState.leader = null
}

function pollPublish(widget, result) {
  if (pollState.leader !== widget) return
  pollState.report = result.report || null
  pollState.history = result.history || null
  pollState.fetchedAt = number(result.fetchedAt) || 0
  pollState.attemptedAt = number(result.attemptedAt) || 0
  pollState.failures = Math.round(number(result.failures) || 0)
  pollState.error = text(result.error, 240)
  pollState.beat = Date.now()
  pollState.seq++
}

function pollConsume(widget) {
  if (pollState.leader === widget) return null
  return {
    seq: pollState.seq,
    report: pollState.report,
    history: pollState.history,
    fetchedAt: pollState.fetchedAt,
    attemptedAt: pollState.attemptedAt,
    failures: pollState.failures,
    error: pollState.error
  }
}

function pollLeaderInstance() {
  return pollState.leader
}

function pollSeed(fetchedAt, attemptedAt, failures) {
  var last = number(fetchedAt) || 0
  var attempt = number(attemptedAt) || 0
  var fails = Math.round(number(failures) || 0)
  if (last > pollState.fetchedAt) pollState.fetchedAt = last
  if (attempt > pollState.attemptedAt) pollState.attemptedAt = attempt
  if (fails > pollState.failures) pollState.failures = fails
}

// Single-quote a value for /bin/sh. Used only for the helper path, node path,
// and the optional auth file path.
function shellQuote(value) {
  var s = String(value || "")
  return "'" + s.replace(/'/g, "'\\''") + "'"
}
