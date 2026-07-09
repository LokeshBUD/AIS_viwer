export type VesselCategory = 'cargo' | 'tanker' | 'tugboat' | 'passenger' | 'fishing' | 'military' | 'unknown'

export type NavigationalStatus =
  | 'UnderWayUsingEngine'
  | 'AtAnchor'
  | 'NotUnderCommand'
  | 'RestrictedManoeuvrability'
  | 'ConstrainedByDraught'
  | 'Moored'
  | 'Aground'
  | 'EngagedInFishing'
  | 'UnderWaySailing'
  | 'HscOrWig'
  | 'AisSartIsActive'
  | 'NotDefined'

export interface PositionSnapshot {
  lat: number
  lon: number
  sog: number
  cog: number
  timestamp: number
}

export interface VesselState {
  mmsi: number
  name: string
  lat: number
  lon: number
  sog: number       // knots
  cog: number       // degrees 0-359
  trueHeading: number  // degrees 0-359, 511 = unavailable
  rot: number       // rate of turn
  navStatus: NavigationalStatus
  draught: number   // 0.1m units
  shipType: number  // ITU code
  vesselCategory: VesselCategory
  callSign: string
  destination: string
  lastUpdate: number   // epoch ms
  history: PositionSnapshot[]
}

// Raw aisstream.io message shapes
export interface AISRawMessage {
  MessageType: string
  MetaData?: {
    MMSI?: string | number
    ShipName?: string
    latitude?: number
    longitude?: number
    time_utc?: string
  }
  Message?: Record<string, unknown>
}
