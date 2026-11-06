#!/usr/bin/env node
'use strict'

// Fetch the OpenRouter key's own limit and current cycle usage. The key is
// read from OPENROUTER_API_KEY or the OpenCode credential store; it is never
// printed, cached, or passed on a command line.

const fs = require('fs')
const https = require('https')
const path = require('path')

const MAX_BODY = 1024 * 1024
const TIMEOUT_MS = 15000

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i < 0) return ''
  return process.argv[i + 1] || ''
}

function authFile() {
  const explicit = argValue('--auth-file')
  if (explicit) return explicit
  const env = process.env.OPENROUTER_AUTH_FILE || ''
  if (env) return env
  const home = process.env.HOME || ''
  return home ? path.join(home, '.local/share/opencode/auth.json') : ''
}

function resolveKey() {
  const env = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (env !== '') return env

  const file = authFile()
  if (!file) return ''
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return ''
  }
  const entry = doc && doc.openrouter && typeof doc.openrouter === 'object' ? doc.openrouter : null
  if (!entry) return ''
  if (typeof entry.key === 'string') return entry.key.trim()
  if (typeof entry.apiKey === 'string') return entry.apiKey.trim()
  return ''
}

function getJson(url, key) {
  return new Promise(function(resolve, reject) {
    const req = https.get(url, {
      headers: {
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        'User-Agent': 'omarchy-openrouter-usage/1.0'
      }
    }, function(res) {
      let size = 0
      const chunks = []
      res.on('data', function(chunk) {
        size += chunk.length
        if (size > MAX_BODY) {
          req.destroy()
          reject(new Error('response too large'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', function() {
        let doc
        try {
          doc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch (e) {
          reject(new Error('invalid JSON from OpenRouter'))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(doc)
          return
        }
        const message = doc && doc.error && doc.error.message
        reject(new Error(message ? String(message).slice(0, 240) : 'HTTP ' + res.statusCode))
      })
    })
    req.setTimeout(TIMEOUT_MS, function() {
      req.destroy(new Error('request timed out'))
    })
    req.on('error', reject)
  })
}

function pickKey(data) {
  const source = data && data.data && typeof data.data === 'object' ? data.data : data
  if (!source || typeof source !== 'object') return null
  const eb = source.effective_budget && typeof source.effective_budget === 'object'
    ? source.effective_budget : null
  return {
    label: typeof source.label === 'string' ? source.label : '',
    is_free_tier: source.is_free_tier === true,
    limit: typeof source.limit === 'number' ? source.limit : null,
    limit_reset: typeof source.limit_reset === 'string' ? source.limit_reset : null,
    limit_remaining: typeof source.limit_remaining === 'number' ? source.limit_remaining : null,
    effective_budget: eb ? {
      limit_usd: typeof eb.limit_usd === 'number' ? eb.limit_usd : null,
      spend_usd: typeof eb.spend_usd === 'number' ? eb.spend_usd : null,
      remaining_usd: typeof eb.remaining_usd === 'number' ? eb.remaining_usd : null,
      reset_interval: typeof eb.reset_interval === 'string' ? eb.reset_interval : null,
      resets_at: typeof eb.resets_at === 'string' ? eb.resets_at : null
    } : null,
    usage: typeof source.usage === 'number' ? source.usage : null,
    usage_daily: typeof source.usage_daily === 'number' ? source.usage_daily : null,
    usage_weekly: typeof source.usage_weekly === 'number' ? source.usage_weekly : null,
    usage_monthly: typeof source.usage_monthly === 'number' ? source.usage_monthly : null
  }
}

function pickCredits(data) {
  const source = data && data.data && typeof data.data === 'object' ? data.data : data
  if (!source || typeof source !== 'object') return null
  if (typeof source.total_credits !== 'number' && typeof source.total_usage !== 'number') return null
  return {
    total_credits: typeof source.total_credits === 'number' ? source.total_credits : 0,
    total_usage: typeof source.total_usage === 'number' ? source.total_usage : 0
  }
}

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(message).slice(0, 300) }) + '\n')
  process.exit(0)
}

async function main() {
  const key = resolveKey()
  if (key === '') fail('no OpenRouter key found in OPENROUTER_API_KEY or ' + (authFile() || 'the OpenCode auth file'))

  let keyDoc
  try {
    keyDoc = await getJson('https://openrouter.ai/api/v1/key', key)
  } catch (e) {
    fail(e && e.message ? e.message : 'could not read the OpenRouter key')
  }

  const keyData = pickKey(keyDoc)
  if (!keyData) fail('OpenRouter returned no key data')

  let credits = null
  try {
    credits = pickCredits(await getJson('https://openrouter.ai/api/v1/credits', key))
  } catch (e) {
    // Account credits are optional; the key limit is the primary read.
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    fetchedAt: Date.now(),
    key: keyData,
    credits: credits
  }) + '\n')
}

main().catch(function(e) {
  fail(e && e.message ? e.message : 'could not read OpenRouter usage')
})
