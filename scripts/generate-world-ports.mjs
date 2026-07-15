#!/usr/bin/env node
// One-off generator for src/data/world-ports.json. Not part of the build —
// run manually (`node scripts/generate-world-ports.mjs`) to regenerate when
// UN/LOCODE publishes a new edition.
//
// Source: cristan/improved-un-locodes (github.com/cristan/improved-un-locodes)
// — a cleaned, decimal-coordinate rebuild of the official UNECE UN/LOCODE
// registry (PDDL), with coordinate gaps filled in from OpenStreetMap/Nominatim
// (ODbL). See README.md for the attribution this data requires.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CSV_URL =
  'https://raw.githubusercontent.com/cristan/improved-un-locodes/main/data/code-list-improved.csv'
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/data/world-ports.json')

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

const res = await fetch(CSV_URL)
if (!res.ok) throw new Error(`Failed to fetch ${CSV_URL}: HTTP ${res.status}`)
const csv = await res.text()
const lines = csv.split('\n')

/** @type {Record<string, [name: string, countryCode: string, lat: number, lon: number]>} */
const ports = {}
let kept = 0

for (let i = 1; i < lines.length; i++) {
  const line = lines[i]
  if (!line.trim()) continue

  const fields = parseCsvLine(line)
  const [change, country, location, name, , , , fn, , , , , coordDecimal] = fields

  if (change === 'X') continue          // deleted entry
  if (!fn || fn[0] !== '1') continue    // not a seaport (Function code 1)
  if (!coordDecimal) continue

  const [latStr, lonStr] = coordDecimal.split(',')
  const lat = parseFloat(latStr)
  const lon = parseFloat(lonStr)
  if (Number.isNaN(lat) || Number.isNaN(lon)) continue

  ports[country + location] = [name, country, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]
  kept++
}

writeFileSync(OUT_PATH, JSON.stringify(ports))
console.log(`Wrote ${kept} ports to ${OUT_PATH}`)
