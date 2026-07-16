#!/usr/bin/env node
// Runs before every `npm run build` in the deploy pipeline (see package.json
// "predeploy"). Reads the live cloudflared quick-tunnel URL from the remote
// box over SSH and writes it into public/backend-url.json, so `npm run
// deploy` always ships whatever the tunnel currently points to instead of
// depending on a stale/possibly-deleted copy on the gh-pages branch.
//
// Requires DEPLOY_SSH_HOST / DEPLOY_SSH_KEY (and optionally
// DEPLOY_METRICS_PORT) in .env. The remote cloudflared process must be
// started with --metrics localhost:<port> (see tunnel_manager.py).

import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SSH_HOST      = process.env.DEPLOY_SSH_HOST
const SSH_KEY        = process.env.DEPLOY_SSH_KEY
const METRICS_PORT  = process.env.DEPLOY_METRICS_PORT ?? '8081'
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../public/backend-url.json')

function fail(msg) {
  console.error(`[sync-backend-url] ${msg}`)
  process.exit(1)
}

if (!SSH_HOST || !SSH_KEY) {
  fail('DEPLOY_SSH_HOST and DEPLOY_SSH_KEY must be set in .env (see README).')
}

let raw
try {
  raw = execFileSync(
    'ssh',
    [
      '-i', SSH_KEY,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-o', 'StrictHostKeyChecking=accept-new',
      SSH_HOST,
      `curl -sf --max-time 5 http://localhost:${METRICS_PORT}/quicktunnel`,
    ],
    { encoding: 'utf8', timeout: 15_000 },
  )
} catch (err) {
  fail(
    `Could not reach the tunnel's metrics endpoint on ${SSH_HOST} (port ${METRICS_PORT}). ` +
    `Make sure the tunnel is running (cloudflare-shortner.service) and started with ` +
    `--metrics localhost:${METRICS_PORT}. Underlying error: ${err.message}`,
  )
}

let hostname
try {
  hostname = JSON.parse(raw).hostname
} catch {
  fail(`Unexpected response from quicktunnel endpoint: ${raw}`)
}

if (!hostname) fail(`quicktunnel response had no hostname: ${raw}`)

const url = `https://${hostname}`
writeFileSync(OUT_PATH, JSON.stringify({ url }, null, 2))
console.log(`[sync-backend-url] Wrote ${OUT_PATH} -> ${url}`)
