import type { AISRawMessage, NavigationalStatus, VesselCategory } from './types'

export interface ParsedPosition {
  mmsi: number
  name: string
  lat: number
  lon: number
  sog: number
  cog: number
  trueHeading: number
  rot: number
  navStatus: NavigationalStatus
}

export interface ParsedStatic {
  mmsi: number
  name: string
  shipType: number
  callSign: string
  draught: number
  destination: string
  dimBow: number
  dimStern: number
}

export function parseRaw(raw: string): AISRawMessage | null {
  try {
    return JSON.parse(raw) as AISRawMessage
  } catch {
    return null
  }
}

export function extractPosition(msg: AISRawMessage): ParsedPosition | null {
  const report =
    (msg.Message?.['PositionReport'] as Record<string, unknown> | undefined) ??
    (msg.Message?.['StandardClassBPositionReport'] as Record<string, unknown> | undefined)

  if (!report) return null

  const mmsi = Number(msg.MetaData?.MMSI)
  if (!mmsi) return null

  const lat = Number(report['Latitude'] ?? msg.MetaData?.latitude ?? 0)
  const lon = Number(report['Longitude'] ?? msg.MetaData?.longitude ?? 0)

  if (!isValidCoord(lat, lon)) return null

  return {
    mmsi,
    name: String(msg.MetaData?.ShipName ?? '').trim() || `MMSI:${mmsi}`,
    lat,
    lon,
    sog: Number(report['Sog'] ?? 0),
    cog: Number(report['Cog'] ?? 0),
    trueHeading: Number(report['TrueHeading'] ?? 511),
    rot: Number(report['RateOfTurn'] ?? 0),
    navStatus: (report['NavigationalStatus'] as NavigationalStatus) ?? 'NotDefined',
  }
}

export function extractStatic(msg: AISRawMessage): ParsedStatic | null {
  const raw = msg.Message?.['ShipStaticData'] as Record<string, unknown> | undefined
  if (!raw) return null

  const mmsi = Number(msg.MetaData?.MMSI)
  if (!mmsi) return null

  const dim = raw['Dimension'] as Record<string, number> | undefined

  return {
    mmsi,
    name: String(raw['Name'] ?? msg.MetaData?.ShipName ?? '').trim(),
    shipType: Number(raw['Type'] ?? 0),
    callSign: String(raw['CallSign'] ?? '').trim(),
    draught: Number(raw['MaximumStaticDraught'] ?? 0),
    destination: String(raw['Destination'] ?? '').trim(),
    dimBow: dim?.['Bow'] ?? 0,
    dimStern: dim?.['Stern'] ?? 0,
  }
}

export function shipTypeToCategory(code: number): VesselCategory {
  if (code >= 70 && code <= 79) return 'cargo'
  if (code >= 80 && code <= 89) return 'tanker'
  if (code === 52 || code === 21) return 'tugboat'
  if (code >= 60 && code <= 69) return 'passenger'
  if (code >= 30 && code <= 39) return 'fishing'
  if (code === 35) return 'military'
  return 'unknown'
}

function isValidCoord(lat: number, lon: number): boolean {
  return (
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180 &&
    !(lat === 0 && lon === 0) // filter null island
  )
}
