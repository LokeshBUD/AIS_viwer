# AIS Maritime Dashboard

A real-time global vessel tracking dashboard powered by live AIS (Automatic Identification System) data. Ships broadcast their position, speed, heading, and identity via AIS transponders; this application receives those broadcasts and visualises them on an interactive map with anomaly detection, filtering, and vessel intelligence.

---

## What It Does

- Displays **live positions of 10,000+ vessels** worldwide, updated in real time
- Shows ship-shaped SVG icons per vessel category at high zoom, canvas circles at low zoom
- Draws **maritime route lines** from a vessel's current position to its declared destination port
- Displays **position history trails** (last 300 snapshots) when a vessel is selected
- Runs an **anomaly detection engine** that flags suspicious behaviour: sudden speed drops, sharp heading changes, and draught mismatches
- Provides **vessel filtering** by category, navigational status, and speed
- Supports **full-text search** by vessel name or MMSI
- Shows a **sortable vessel table** with an inline anomaly column
- Colorcodes vessels by destination continent

---

## Architecture
```mermaid
graph TD
    %% Base Theme Overrides (Ensures high visibility on Dark & Light modes)
    %% -----------------------------------------------------------------
    classDef client fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1;
    classDef server fill:#efebe9,stroke:#4e342e,stroke-width:2px,color:#3e2723;
    classDef external fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#e65100;
    classDef logic fill:#ffffff,stroke:#757575,stroke-width:1px,color:#212121;
    
    %% 1. EXTERNAL DATA SOURCE (Top)
    %% -----------------------------------------------------------------
    ExternalStream["🌐 aisstream.io <br> (External Stream)"]:::external
    
    %% 2. BACKEND LAYER (Middle)
    %% -----------------------------------------------------------------
    subgraph Server ["Node.js Server (Express + ws)"]
        AIS["⚙️ AISRelay"]:::logic
        Health["🏥 GET /health"]:::logic
        
        %% Features listed cleanly inside a single readable card
        Features["📦 AIS Functions:<br>• Caches latest position + static data per MMSI<br>• Sends SNAPSHOT to new clients on connect<br>• Forwards live messages to all clients"]:::logic
        
        AIS --- Features
    end
    class Server server;

    %% 3. FRONTEND LAYER (Bottom)
    %% -----------------------------------------------------------------
    subgraph Client ["Browser Client (Vite + TS + Leaflet.js)"]
        WS_Client["🔌 WebSocketClient"]:::logic
        
        %% Data Processing Pipelines
        VT["🚢 VesselTracker"]:::logic
        EB["🚌 EventBus"]:::logic
        AD["⚠️ AnomalyDetector"]:::logic
        AM["🚨 AlertManager"]:::logic
        
        %% UI Components
        MV["🗺️ MapView <br> (Hybrid Canvas/Icon)"]:::logic
        UI["📊 UI Components <br> (Table / FilterPanel / HUD)"]:::logic

        %% Frontend Internal Flows
        WS_Client --> VT
        WS_Client --> AD
        VT --> EB
        VT --> MV
        AD --> AM
        MV --> UI
    end
    class Client client;

    %% INTER-LAYER NETWORKING (Clear data flow: Stream -> Server -> Client)
    %% -----------------------------------------------------------------
    ExternalStream == "wss://stream.aisstream.io" ==> AIS
    AIS == "ws://localhost:3001/ws" ==> WS_Client
### Server (`server/`)


The server is a thin relay — it does not process or interpret AIS messages. Its only job is to:

1. Maintain a persistent WebSocket connection to [aisstream.io](https://aisstream.io), authenticated with an API key
2. Keep an in-memory cache of the latest `PositionReport` and `ShipStaticData` per MMSI (up to 8,000 vessels each, with LRU eviction)
3. When a browser client connects, send a `SNAPSHOT` message containing all cached positions and static data so the map populates instantly without waiting for live updates
4. Relay every live AIS message to all connected browser clients in real time
5. Reconnect to aisstream.io automatically on disconnect with exponential backoff (1s → 16s)

**Key files:**

- `server/index.ts` — Express HTTP server, WebSocketServer, health endpoint at `GET /health`
- `server/AISRelay.ts` — upstream connection management, caching, snapshot delivery, broadcast

### Client (`src/`)

The client is a single-page application bundled by Vite. It receives raw AIS JSON from the relay WebSocket and handles all parsing, state management, rendering, and intelligence locally in the browser.

**Data pipeline:**

```
WebSocketClient (ws events)
  → raw JSON string
  → EventBus.emit(WS_MESSAGE)
  → VesselTracker.handle()
      → AISParser (extract position / static fields)
      → updates VesselState in memory
      → EventBus.emit(VESSEL_UPDATED, VesselState)
  → AnomalyDetector.check(vessel) every 15s per vessel
      → rules: SpeedDrop, HeadingChange, DraftMismatch
      → AlertManager.add(alert)
      → EventBus.emit(ANOMALY_DETECTED, alert)
  → MapView.upsert(vessel)   [batched every 200ms]
  → VesselTable.refresh()    [every 2s]
  → HUD.setVesselCount()
```

**Key directories:**

| Path          | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `src/ais/`    | AIS message parsing, VesselTracker state machine, WebSocket client  |
| `src/agent/`  | AnomalyDetector, AlertManager, anomaly rules                        |
| `src/ui/`     | MapView, HUD, VesselTable, FilterPanel, VesselInfoPanel, VesselIcon |
| `src/utils/`  | EventBus, RingBuffer, ports database, maritime routing, constants   |
| `src/styles/` | CSS (dark HUD theme, panel layouts, icon states)                    |
| `server/`     | Node.js relay server                                                |

---

## Setup

### Prerequisites

- Node.js 18+
- An API key from [aisstream.io](https://aisstream.io) (free tier available)

### Install

```bash
npm install
```

### Configure

Create a `.env` file in the project root:

```
AIS_API=your_aisstream_api_key_here
PORT=3001
```

### Run (development)

```bash
npm run dev
```

This starts both the relay server (`localhost:3001`) and the Vite dev client (`localhost:5173`) concurrently.

### Build & run (production)

```bash
npm run build
npm start
```

Vite output lands in `dist/client/`; the server serves it as static files.

### Health check

```bash
curl http://localhost:3001/health
```

Returns connected client count, tracked vessel count, and live message rate.

---

## Live Data Handling

### Message types

AIS messages from aisstream.io arrive as JSON. The application handles two types:

- **`PositionReport` / `StandardClassBPositionReport`** — latitude, longitude, SOG (speed over ground), COG (course over ground), true heading, rate of turn, navigational status. These arrive continuously and drive marker movement on the map.
- **`ShipStaticData`** — vessel name, call sign, ship type (ITU code → category), draught, declared destination. These arrive much less frequently (every few minutes per vessel) and are merged into the existing vessel state when received.

### Vessel lifecycle

1. First `PositionReport` for an MMSI creates a `VesselState` entry with default fields
2. Subsequent position reports update position, speed, heading, and push a `PositionSnapshot` into a ring buffer (max 300 entries)
3. `ShipStaticData` enriches the same record with name, type, destination
4. Vessels not updated for 10 minutes are purged from state and removed from the map
5. On reconnect, the server's SNAPSHOT re-populates the map immediately

### Batched rendering

`MapView` does not re-render on every incoming message. Position updates accumulate in a `pending` map and are flushed to the map at 200ms intervals, preventing layout thrashing when thousands of vessels update simultaneously.

### Hybrid canvas / divIcon rendering

At zoom level < 8, all vessels render as `L.CircleMarker` on a single shared HTML5 `<canvas>` element — zero DOM nodes per vessel. At zoom ≥ 8, in-viewport vessels switch to `L.Marker` with inline SVG ship icons (per vessel category), rotated by COG. Out-of-viewport markers are removed on pan. This keeps DOM node count under ~200 at any zoom level regardless of total vessel count.

---

## Anomaly Detection

The `AnomalyDetector` checks each vessel at most once every 15 seconds. It runs three independent rules. Alerts are deduplicated within 5-minute windows per vessel per alert type. The latest alert per vessel appears as a badge in the vessel table.

### Rule 1 — Speed Drop (`SPEED_DROP`)

**Trigger:** A vessel that was moving (peak SOG ≥ 2 kn in the last 3 minutes) drops to a speed that is more than 35% below its recent peak.

**Severity:**

- `critical` — vessel comes to a complete stop while not anchored or moored
- `warning` — significant speed reduction without a full stop

**Intent:** Detect unexpected engine failure, sudden grounding, or deliberate dark-vessel stops.

**Constants:** `SPEED_DROP_THRESHOLD = 0.35`, `ANOMALY_WINDOW_SECS = 180`

---

### Rule 2 — Sharp Heading Change (`SHARP_HEADING`)

**Trigger:** A vessel underway at ≥ 3 kn changes its course by more than 35° total within a 3-minute sliding window, and at least 40% of consecutive position pairs within that window also show meaningful heading change (>5°). The 40% consistency check filters out single GPS glitches that bounce COG between two frames.

**Severity:**

- `critical` — heading change occurs at speed > 15 kn (high-energy turn)
- `warning` — turn at lower speed

**Intent:** Detect evasion manoeuvres, unexpected course deviations, or vessels behaving inconsistently with their declared route.

**Constants:** `HEADING_CHANGE_THRESHOLD = 35`, `ANOMALY_WINDOW_SECS = 180`

---

### Rule 3 — Draught Mismatch (`DRAFT_MISMATCH`)

**Trigger:** A vessel's declared draught falls outside the expected range for its category. Requires at least 20 position history points before firing (prevents false positives from freshly-seen vessels with stale or unconfigured transponder data).

**Expected draught ranges (in metres):**

| Category  | Min   | Max    |
| --------- | ----- | ------ |
| Cargo     | 2.5 m | 16.0 m |
| Tanker    | 4.0 m | 21.0 m |
| Passenger | 2.5 m | 9.5 m  |
| Fishing   | 0.8 m | 4.5 m  |
| Tugboat   | 1.5 m | 5.5 m  |
| Military  | 2.0 m | 9.0 m  |

**Intent:** Flag vessels broadcasting an implausibly large or small draught for their type. A cargo ship reporting 0.5m draught is either empty (suspicious for a heavily loaded route) or has incorrect transponder configuration. Overloaded vessels may report draught beyond category norms.

---

## Use Cases

### Port authority situational awareness

Track all vessels approaching or departing a port region. Filter by navigational status to isolate vessels at anchor vs underway. Speed-drop alerts near fairways may indicate vessels waiting for a berth or in distress.

### Maritime security monitoring

Heading change alerts at high speed can indicate evasion behaviour. Draught mismatches on a tanker may flag undisclosed cargo. The MMSI search lets analysts pull up a specific vessel instantly.

### Fleet operations

Search for a vessel by name or MMSI, select it to see its current position, speed, destination, and recent track history. The route arc shows the great-circle maritime path to the declared destination.

### Research and education

Visual exploration of global shipping patterns — which routes are busiest, which vessel types dominate specific trade lanes, how SOG varies by category.

---

## Future Work

### Short term

- **Geofence alerts** — define polygon zones (port approaches, restricted areas, exclusive economic zones) and alert when a vessel enters or exits. Currently all position history is available; this just needs a point-in-polygon check per update.
- **AIS gap detection** — flag vessels that were transmitting and then go silent for more than N minutes while in open ocean (a common indicator of deliberate transponder shutdown, so-called "going dark").
- **Vessel clustering at low zoom** — replace overlapping canvas dots at global zoom with count-labelled cluster circles, reducing visual noise when thousands of vessels are in a small screen area.
- **Click-to-search in table** — clicking a vessel in the table should pan and zoom the map to that vessel's position even if it is not currently in the viewport (especially relevant in canvas mode where the marker may not yet exist).

### Medium term

- **Historical playback** — store position snapshots in a time-series database (InfluxDB, TimescaleDB) and add a timeline scrubber to replay vessel movements over past hours or days.
- **Port dwell time analysis** — detect when a vessel enters a port bounding box and track how long it stays. Long dwell times for tankers or cargo ships can indicate loading/unloading delays worth flagging.
- **Vessel-to-vessel proximity alerts** — compute pairwise distances between vessels underway in the same region and alert when two vessels come within a configurable distance at speed (collision risk).
- **Destination confidence scoring** — cross-reference a vessel's declared destination against its current heading and known maritime routes. Large divergence may indicate false destination declaration.
- **Multi-feed aggregation** — aisstream.io is one feed; integrating a second source (e.g. a terrestrial AIS receiver or a satellite AIS provider) would fill gaps in ocean coverage and increase update frequency.

### Long term

- **Machine learning anomaly detection** — replace threshold-based rules with a learned baseline per vessel or vessel category. A cargo ship that normally runs 12 kn will have a different "normal" than one that runs 8 kn; per-vessel baselines would dramatically reduce false positives.
- **Cargo intelligence overlay** — fuse AIS data with public cargo manifests, port call records, and vessel ownership databases (e.g. Lloyd's, MarineTraffic API) to build richer vessel profiles and flag sanctions exposure or ownership anomalies.
- **Backend persistence layer** — currently all vessel state is in-memory and lost on server restart. A Redis or Postgres backend would allow server restarts without losing track of vessels and would enable multi-instance horizontal scaling.
- **Mobile-responsive layout** — the current HUD is designed for wide desktop screens. A responsive layout for tablets and phones would make the dashboard usable for on-the-water or bridge-side monitoring.
