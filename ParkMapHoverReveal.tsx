// ParkMap.tsx

import { addPropertyControls, ControlType } from "framer"
import { AnimatePresence, motion } from "framer-motion"
import React, { useEffect, useMemo, useRef, useState } from "react"

/* ============================================================
   CONFIG
   ============================================================ */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? ""

const CONFIG = {
    mapboxToken: MAPBOX_TOKEN,
    mapStyle: "mapbox://styles/adamatot/cmobvhun5000g01s0d04s1zn2",
    defaultCenter: [-71.085, 42.326] as [number, number],
    // NOTE: the live map's starting/home view is now derived from the FACADE framing
    // (staticCenter / staticZoom + cover-scale, via computeHomeView) so the facade→live swap
    // doesn't reframe. To change the start view, edit staticCenter / staticZoom — not this.
    // defaultZoom is kept only as a fallback seed and is otherwise unused.
    defaultZoom: 12,
    minZoom: 3,   // farthest the user can zoom out (no smaller than 3)
    airtableProxy: "https://lively-dawn-3d84.adam-69d.workers.dev",
    // ↓ Change this when the domain changes — all slug links update automatically
    siteBaseUrl: "https://large-shape-151756.framer.app",
    // ↓ Emerald Necklace tileset — update if re-uploaded
    parkTilesetId: "adamatot.utqyswzwhi90",
    // ↓ Mapbox symbol layer ID for park name labels
    parkLabelsLayerId: "65ad24a2edf7804f4b43",
}

/* ============================================================
   RESPONSIVE BREAKPOINTS
   Two breakpoints, split at a single 740px threshold:
     • "sm"  → container width  <  740px
     • "lg"  → container width  >= 740px
   Width is measured on the component's OWN container (see
   containerWidth / ResizeObserver below), not window.innerWidth —
   correct for a Framer embed that may sit in a column narrower
   than the viewport.
   ============================================================ */
const BREAKPOINT = 740 // px — boundary between "sm" and "lg"

// Filter panel width: full-width up to this cap, anchored left. On containers wider than this
// the map "peeks" to the right of the panel — that's where the live filter preview is visible.
// Shared between the panel's own maxWidth and the map's left-padding shift while it's open.
const FILTER_PANEL_MAX_W = 480

// sm POI detail panel = bottom sheet covering this fraction of the container height.
// Used both for the sheet's height and for the map's bottom padding (so the selected
// POI centers in the visible strip ABOVE the sheet). Keep the two in sync via this.
const SM_SHEET_FRACTION = 0.75

type Breakpoint = "sm" | "lg"

// Whimsical loading copy: "finding {…}" — critters native to the Boston Emerald
// Necklace (Back Bay Fens, the Riverway, Jamaica Pond, Arnold Arboretum, Franklin
// Park) doing a characteristic behavior. One is picked at random per load.
const LOADING_CRITTERS = [
    "a sun-basking painted turtle...",
    "a traffic-controlling goose...",
    "a statue-still great blue heron...",
    "an acorn-hoarding gray squirrel...",
    "a grumpy mute swan...",
    "a wing-drying cormorant...",
    "a cheek-stuffing chipmunk...",
    "a worm-wrangling robin...",
    "a clover-nibbling rabbit...",
    "a pond-skimming dragonfly...",
    "a den-digging red fox...",
    "a lily-hopping leopard frog...",
]

// Minimum time the "finding …" loading message stays up after the live map is
// triggered — the map often loads instantly (404 tiles fail fast), so without a
// floor the message would flash by before it's readable.
const MIN_LOADING_MS = 2500

// FEATURED-POI ROTATION (idle "attract" mode). After FEATURED_IDLE_MS of no user engagement
// the map auto-cycles the SAME highlight as a hover (dot grows + name tag) through the
// featured POIs — the carousel set (all full POIs, narrowed to the focused park) — one at a
// time, FEATURED_CYCLE_MS each, in list order. Any engagement stops it and resets the idle
// clock; it resumes after another quiet stretch. Suppressed while a POI detail / Filter /
// Paths panel is open. Reuses the existing hover state so it's visually identical.
const FEATURED_IDLE_MS = 20000
// Each featured POI holds the spotlight for FEATURED_CYCLE_MS; the camera glides to it (centered,
// zoom ~14) over FEATURED_FLY_MS, then holds for the remainder. Slow + eased to avoid motion sickness.
const FEATURED_CYCLE_MS = 8000
const FEATURED_FLY_MS = 4000
// Card-hover fly: hovering a card whose dot is off-screen glides the map to center that dot over
// this long. Quicker than the attract fly so it feels responsive to the hover, still smooth/eased.
const HOVER_FLY_MS = 1600
// Hover-intent: wait this long after the cursor settles on a card before flying, so a quick sweep
// across cards never flies to each one (and can't leave the map centered on a card you left).
const HOVER_FLY_INTENT_MS = 180
// Hard floor for the card-hover move's mid-flight zoom-out. flyTo zooms OUT then back IN; rapid
// hopping interrupts each fly mid-zoom-out, so without an absolute peak the view spirals outward.
// minZoom is the flight's peak (most zoomed-out point) — pinning it here CAPS the dip so it can't
// compound. Lower = a deeper but still-bounded pull-back; raise toward 14 for almost no dip.
const HOVER_FLY_MIN_ZOOM = 13   // now the DEEPEST dip (only on long travels) and the hard cap
// Distance-to-dip mapping (shared by every flyToCenterPOI): travel = screen-pixel distance from the
// viewport center to the target dot. travel <= NEAR_PX -> almost no dip (FLY_NEAR_PEAK); >= FAR_PX ->
// full dip (the caller's floor); linear between. Pixel-based so it adapts to any embed size.
const FLY_NEAR_PX = 500
const FLY_FAR_PX = 1400
const FLY_NEAR_PEAK = 14
// Smooth ease-in-out (sine) for the featured fly — gentle accel/decel, no jarring start or stop.
const featuredEase = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
// Delay before a dot hover is dropped on mouseleave. Absorbs the spurious leave→enter flutter
// that source.setData (re-sorting the hovered dot on top) fires under a stationary cursor, so the
// hover doesn't flicker. A genuine leave (no re-enter within the window) still clears normally.
const HOVER_LEAVE_BUFFER_MS = 120

/* ============================================================
   FACADE DOT "PARSE" ANIMATION
   The POI dots on the facade animate in (a "parse" reveal), and can optionally keep
   pulsing. These options dictate the TIMING — how the effect is distributed across the
   dots: all at once, or rippling across them in a chosen order. Tweak and reload to explore.
   ============================================================ */
const FACADE_DOT_PARSE = {
    enabled: true,

    // ORDER / DISTRIBUTION of the effect across the dots:
    //   "simultaneous" — every dot in sync
    //   "sequential"   — a unidirectional sweep ordered by screen position (see sequentialDirection)
    //   "random"       — scattered, deterministic per POI id (stable across renders)
    //   "radial-out"   — ripples from the map center outward
    //   "radial-in"    — ripples from the edges inward toward the center
    // For loop:true this sets each dot's PHASE within the cycle, so "sequential" reads as a
    // continuous travelling wave, "random" as an organic out-of-sync twinkle.
    mode: "sequential" as "simultaneous" | "sequential" | "random" | "radial-out" | "radial-in",

    // Direction of the "sequential" sweep — a UNIDIRECTIONAL flow ordered by screen position
    // (not data order, which would look random). The Emerald Necklace runs roughly N→S, so
    // "top-bottom" sweeps down the chain.
    sequentialDirection: "top-bottom" as "top-bottom" | "bottom-top" | "left-right" | "right-left",

    // ms each dot's animation lasts. For loop:true this is the full breathe cycle.
    duration: 2400,

    // CSS easing for each dot's animation.
    easing: "ease-in-out",

    // false → dots pop in ONCE and stay put (a staggered reveal that plays on load).
    // true  → dots breathe/pulse forever with NO initial parse-in: each dot starts already
    //         mid-cycle (negative delay) at its `mode` phase, so it's organic from frame one.
    loop: true,

    // --- the two below apply only to the one-shot reveal (loop:false) ---
    // ms between consecutive dots in `mode` order. 0 = all fire together.
    stagger: 45,
    // ms before the FIRST dot starts (after the facade appears).
    startDelay: 150,
}

// Stable per-id hash → used for FACADE_DOT_PARSE.mode === "random" so the scatter order is
// deterministic (doesn't reshuffle every render).
function hashStringToInt(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
    return h
}

// Given the projected facade dots, return each dot's ORDER RANK (0 = fires first) per the
// chosen parse mode. Multiply rank × stagger to get its start delay.
function computeParseRanks(
    dots: { id: string; x: number; y: number }[],
    cw: number, ch: number,
    mode: typeof FACADE_DOT_PARSE.mode,
): number[] {
    const n = dots.length
    const ranks = new Array(n).fill(0)
    if (mode === "simultaneous") return ranks
    let orderedIdx: number[]
    if (mode === "sequential") {
        // UNIDIRECTIONAL sweep ordered by screen position (NOT data order — that looks random).
        const dir = FACADE_DOT_PARSE.sequentialDirection
        const key = (d: { x: number; y: number }) =>
            dir === "top-bottom" ? d.y : dir === "bottom-top" ? -d.y : dir === "left-right" ? d.x : -d.x
        orderedIdx = dots.map((_, i) => i).sort((a, b) => key(dots[a]) - key(dots[b]))
    } else if (mode === "random") {
        orderedIdx = dots.map((_, i) => i).sort((a, b) => hashStringToInt(dots[a].id) - hashStringToInt(dots[b].id))
    } else {
        // radial-out / radial-in: rank by distance from the container center.
        const ccx = cw / 2, ccy = ch / 2
        const dist = dots.map(d => Math.hypot(d.x - ccx, d.y - ccy))
        orderedIdx = dots.map((_, i) => i).sort((a, b) => mode === "radial-in" ? dist[b] - dist[a] : dist[a] - dist[b])
    }
    orderedIdx.forEach((di, rank) => { ranks[di] = rank })
    return ranks
}

// Zonal map control: gestures (wheel/drag/pinch) are live only outside the dead zones.
// The top GESTURE_DEAD_TOP_VH and bottom GESTURE_DEAD_BOTTOM_VH of the map height let
// those gestures fall through to the page (so it scrolls). 0 + 0.3 → no top dead zone,
// bottom 30vh dead, top 70vh live. PLUS a GESTURE_DEAD_PAD_PX border all around the map
// (top/bottom/left/right) so edge gestures fall through too.
const GESTURE_DEAD_TOP_VH = 0
const GESTURE_DEAD_BOTTOM_VH = 0.2
const GESTURE_DEAD_PAD_PX = 20
// Faint debug tint over the dead zone(s) while testing. Off for production.
const SHOW_GESTURE_ZONE_DEBUG = false

// TEMP/DEBUG: live zoom-level readout pinned to the top-center of the map. Off in all cases.
// (liveZoom tracking is independent of this flag, so the Zoom Out button still works.)
const SHOW_ZOOM_DEBUG = false

// The "Zoom Out" button (under Filter) appears only once the live map is zoomed in PAST this
// level, and animates in/out. Raise/lower to change when it shows.
const ZOOM_OUT_MIN_ZOOM = 14

// The "View whole necklace" button ALSO appears when the user zooms out BELOW this level
// (further from the ~11.88 home view) — set just under home so the home view itself doesn't
// trigger it. The button likewise appears when the necklace is panned entirely out of frame
// (see the out-of-frame detector). No auto-snap — the user clicks the button to return.
const VIEW_NECKLACE_BELOW_ZOOM = 11

// Result-count readout in the filter nav bar. Disabled per current design —
// kept in code (not deleted) so it can be switched back on by flipping this.
const SHOW_RESULT_COUNT = false

// One-time data sanity log after the first Airtable batch (POI count, how many have Filter--
// fields, a sample). Off by default; flip true to debug the feed. (Use console.log, not
// console.error — these are informational, not errors.)
const SHOW_DATA_DEBUG = false

// FACADE fallback for the Paths dropdown. The real path layers are auto-detected from the
// Mapbox style's `Toggle-{Category}--{Name}` layers, but that only happens once the live
// map loads — so before activation the dropdown would be empty. This static list mirrors
// those layers so Paths appears in the facade. Shape matches toggleLayersByCategory
// ({ category: [names] }); each entry maps to the layer id `Toggle-{category}--{name}`.
//
// SELF-CORRECTING: once the map loads, the live auto-detection overrides this entirely
// (so a stale list can't mislead for long), and a dev warning fires if the two diverge —
// that's your signal to update this constant. Keep the category/names matching the style.
const PATHS_FALLBACK: Record<string, string[]> = {
    // Matches the live style exactly: category "Layers", and the order the layers appear in
    // the Mapbox style array (Walking Paths at index 36, Bike Paths at 37). Keeping the same
    // category key means a path toggled on the facade carries over to the live map.
    Paths: ["Walking Paths", "Bike Paths"],
}

/* ============================================================
   COLORS — from Figma design tokens
   ============================================================ */
const C = {
    salix: "#1f2f16",        // dark green — backgrounds, borders, text
    salixHover: "#101a0c",   // darker green — hover states
    lemna: "#d8eaab",        // light green — map background, sidebar accent
    cygnus: "#f9f3f5",       // cream — cards, filter panel background
    cygnusHover: "#e5dee0",  // cream hover
    disabled: "#c7c0c2",     // greyed-out state for inactive buttons
    lilac: "#D2C7FF",        // lilac accent — selected-park tint
    // Basemap land ramp — recolored onto the Mapbox base layers at runtime (see the land-recolor
    // in the idle handler). Each entry pairs the NORMAL green with the DIMMED tint used while a
    // park is focused (Mapbox v3 doesn't animate opacity, so we swap a lighter COLOR instead).
    // These are distinct olive-greens — NOT lemna/cygnus.
    land: {
        base: { normal: "#C8DC8A", dim: "#F4F8E8", opacity: 0.6 }, // land (background) + landcover (fill)
        park: { normal: "#B9CF7B", dim: "#F1F5E5", opacity: 0.6 }, // national-park (fill)
        use:  { normal: "#B5CA78", dim: "#F0F4E4", opacity: 0.6 }, // landuse (fill)
    },
}

// Single source of truth for the filter panel's surface color. Every surface inside the
// panel inherits this (inner elements use transparent backgrounds), so changing this one
// value re-skins the whole filter screen.
const FILTER_PANEL_BG = C.cygnus

/* ============================================================
   AIRTABLE FIELDS
   Core fields are listed here. Filter categories are automatic:
   any Airtable field named Filter--XXXX is detected at runtime
   and becomes a filter section — no code changes needed.
   ============================================================ */
const FIELDS = {
    name: "POI Name",
    latitude: "Latitude",
    longitude: "Longitude",
    photo: "Cover Photo",
    park: "Park Name",
    // Airtable field renamed from "Address" → "Address or Coordinates"; holds either a
    // street address ("125 Arborway, Boston, MA 02130") or a "lat, lng" string. Both are
    // valid Google Maps `destination=` values, so the directions link works for either.
    address: "Address or Coordinates",
    slug: "Slug",
    tags: "Tags",
    poiTag: "POI Tag",
    description: "Description Heading",
    neighborhood: "Neighborhood",
    hours: "Hours",
    accessibility: "Accessibility Notes",
    poiMode: "POI Mode",
}

/* ============================================================
   TYPES
   ============================================================ */
interface POIRecord {
    id: string
    name: string
    latitude: number
    longitude: number
    photo?: string        // full-res Cover Photo url
    photoSmall?: string   // tiny (~45px) thumbnail — blur-up placeholder
    photoLarge?: string   // mid-res (~640px) thumbnail — actual card image
    park?: string
    address?: string
    slug?: string
    tags?: string[]
    poiTag?: string
    filterFields: Record<string, string[]>  // keyed by label after "Filter--"
    description?: string
    neighborhood?: string
    hours?: string
    accessibility?: string
    poiMode?: string   // "Simple" → small dot, excluded from carousel
}

type NonParkFilters = Record<string, string[]>  // label → selected values

// Park selection: Emerald Necklace (all parks, no POI park-filter) OR an explicit
// subset. `allParks` true = the EN parent; `parks` is the chosen subset otherwise.
interface ParkSelection {
    allParks: boolean
    parks: string[]
}
const DEFAULT_PARK_SELECTION: ParkSelection = { allParks: true, parks: [] }

interface PendingFilters {
    allParks: boolean
    parks: string[]
    fields: NonParkFilters
}

interface ParkLayer {
    id: string
    label: string
}

// Canonical Emerald Necklace park list + display order. These rarely change, so the
// filter shows them immediately (before any Mapbox call); the live map later fills in
// real bounds and replaces this list. id === label (parks are keyed by name).
const PARK_ORDER = [
    "Charlesgate",
    "Back Bay Fens",
    "The Riverway",
    "Olmsted Park",
    "Jamaica Pond",
    "Arborway",
    "Arnold Arboretum",
    "Franklin Park",
]
const INITIAL_PARK_LAYERS: ParkLayer[] = PARK_ORDER.map(name => ({ id: name, label: name }))

/* ============================================================
   FILTER HELPERS
   ============================================================ */
const EMPTY_NON_PARK: NonParkFilters = {}

function poiMatchesFilters(poi: POIRecord, parkSel: ParkSelection, filters: NonParkFilters): boolean {
    // Emerald Necklace (allParks) = no park filter; a subset = POI must be in it.
    if (!parkSel.allParks) {
        if (!poi.park || !parkSel.parks.includes(poi.park)) return false
    }
    for (const [label, selected] of Object.entries(filters)) {
        if (selected.length === 0) continue
        const poiValues = poi.filterFields[label] ?? []
        if (!selected.some(v => poiValues.includes(v))) return false
    }
    return true
}

// "Simple"/amenity-tier POIs: small map dot, excluded from the carousel. Airtable's
// "POI Mode" option is "Amenity- Simple" (vs "Detailed- Point of Interest"), so match
// the SUBSTRING "Simple" rather than an exact value — resilient to the label prefix.
// (Mapbox styling uses the equivalent ["in", "Simple", ["get","poiMode"]] expression.)
function isSimplePOI(poi: POIRecord): boolean {
    return !!poi.poiMode && poi.poiMode.includes("Simple")
}

// Live poi-dot circle-radius (default, non-hover/non-active state) — mirrors the interpolate
// stops in the map's poi-dot paint so the FACADE dots can be sized to exactly match the engaged
// map at a given zoom. Linear interpolation between stops, clamped at the ends. Keep these stops
// in sync with the "circle-radius" zoom stops in the poi-dot addLayer call.
function liveDotRadius(zoom: number, simple: boolean): number {
    const stops: [number, number][] = simple
        ? [[8, 1.5], [12, 3.5], [14, 7]]
        : [[8, 1.5], [12, 4], [14, 8]]
    if (zoom <= stops[0][0]) return stops[0][1]
    const last = stops[stops.length - 1]
    if (zoom >= last[0]) return last[1]
    for (let i = 0; i < stops.length - 1; i++) {
        const [z0, r0] = stops[i], [z1, r1] = stops[i + 1]
        if (zoom <= z1) return r0 + (r1 - r0) * (zoom - z0) / (z1 - z0)
    }
    return last[1]
}
// Live poi-dot circle-stroke-width: Simple amenity dots keep a 1px ring; main (Page) dots
// have no border. Kept in sync with the poi-dot "circle-stroke-width" paint above.
const liveDotStroke = (simple: boolean): number => (simple ? 1 : 0)
// Hovered-dot fill radius (the `hovered` value in the poi-dot hv() expression: 3/8/16 at
// z8/z12/z14, unified for Simple + Full). Keep in sync with the poi-dot "circle-radius"
// hover stops. Used to anchor the hover tag flush to the dot's edge at any zoom.
function liveDotHoverRadius(zoom: number): number {
    const stops: [number, number][] = [[8, 3], [12, 8], [14, 16]]
    if (zoom <= stops[0][0]) return stops[0][1]
    const last = stops[stops.length - 1]
    if (zoom >= last[0]) return last[1]
    for (let i = 0; i < stops.length - 1; i++) {
        const [z0, r0] = stops[i], [z1, r1] = stops[i + 1]
        if (zoom <= z1) return r0 + (r1 - r0) * (zoom - z0) / (z1 - z0)
    }
    return last[1]
}

/* ============================================================
   AIRTABLE FETCH
   ============================================================ */
function parseStrArr(val: any): string[] {
    if (!val) return []
    if (Array.isArray(val)) return val.map(String).filter(Boolean)
    if (typeof val === "string") return val.split(",").map(s => s.trim()).filter(Boolean)
    return []
}

function parsePOI(record: any): POIRecord | null {
    const f = record.fields
    const lat = f[FIELDS.latitude]
    const lng = f[FIELDS.longitude]
    if (!lat || !lng) return null

    // Detect any field named Filter--XXXX automatically
    const filterFields: Record<string, string[]> = {}
    const previewParkLayers: string[] = []
    Object.keys(f).forEach(key => {
        if (key.startsWith("Filter--")) {
            filterFields[key.slice("Filter--".length)] = parseStrArr(f[key])
        } else if (key.startsWith("Preview-Parks--")) {
            previewParkLayers.push(key.slice("Preview-Parks--".length))
        }
    })

    return {
        id: record.id,
        name: f[FIELDS.name] ?? "Unnamed",
        latitude: lat,
        longitude: lng,
        photo: f[FIELDS.photo]?.[0]?.url,
        photoSmall: f[FIELDS.photo]?.[0]?.thumbnails?.small?.url,
        photoLarge: f[FIELDS.photo]?.[0]?.thumbnails?.large?.url,
        park: f[FIELDS.park] ?? undefined,
        address: f[FIELDS.address] ?? "",
        slug: typeof f[FIELDS.slug] === "string" ? f[FIELDS.slug] : String(f[FIELDS.slug] ?? ""),
        tags: parseStrArr(f[FIELDS.tags]),
        poiTag: typeof f[FIELDS.poiTag] === "string" ? f[FIELDS.poiTag] : undefined,
        filterFields,
        previewParkLayers,
        description: typeof f[FIELDS.description] === "string" ? f[FIELDS.description] : undefined,
        neighborhood: typeof f[FIELDS.neighborhood] === "string" ? f[FIELDS.neighborhood] : undefined,
        hours: typeof f[FIELDS.hours] === "string" ? f[FIELDS.hours] : undefined,
        accessibility: typeof f[FIELDS.accessibility] === "string" ? f[FIELDS.accessibility] : undefined,
        poiMode: typeof f[FIELDS.poiMode] === "string" ? f[FIELDS.poiMode] : undefined,
    }
}

async function fetchAllPOIs(): Promise<POIRecord[]> {
    // No fields[] filtering — fetch all fields so Filter--XXXX fields are included automatically
    const results: POIRecord[] = []
    let offset: string | undefined = undefined
    let firstBatch = true
    do {
        const url = `${CONFIG.airtableProxy}${offset ? `?offset=${offset}` : ""}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`)
        const data = await res.json()

        data.records.forEach((r: any) => { const p = parsePOI(r); if (p) results.push(p) })

        if (firstBatch) {
            firstBatch = false
            if (SHOW_DATA_DEBUG) {
                const withCoords = results.length
                const withFilters = results.filter(p => Object.keys(p.filterFields).length > 0).length
                const sampleFilters = results.find(p => Object.keys(p.filterFields).length > 0)?.filterFields
                console.log(`ParkMap: parsed ${withCoords} POIs with coordinates`)
                console.log(`ParkMap: ${withFilters} of those have Filter-- fields`)
                console.log("ParkMap: sample filterFields from first matching POI →", sampleFilters ?? "none")
            }
        }
        offset = data.offset
    } while (offset)
    return results
}

/* ============================================================
   MAPBOX LOADER — CSP + blob worker for Framer's published env
   ============================================================ */
let mapboxLoadPromise: Promise<void> | null = null
const MAPBOX_VERSION = "3.23.1"

function loadMapbox(): Promise<void> {
    if (mapboxLoadPromise) return mapboxLoadPromise
    mapboxLoadPromise = (async () => {
        if (!document.getElementById("mapbox-css")) {
            const link = document.createElement("link")
            link.id = "mapbox-css"
            link.rel = "stylesheet"
            link.href = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VERSION}/mapbox-gl.css`
            document.head.appendChild(link)
        }
        if (!(window as any).mapboxgl) {
            await new Promise<void>((resolve, reject) => {
                const existing = document.getElementById("mapbox-js") as HTMLScriptElement | null
                if (existing) {
                    if ((window as any).mapboxgl) { resolve(); return }
                    existing.addEventListener("load", () => resolve())
                    existing.addEventListener("error", () => reject(new Error("Mapbox script failed to load.")))
                    return
                }
                const script = document.createElement("script")
                script.id = "mapbox-js"
                script.src = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VERSION}/mapbox-gl-csp.js`
                script.onload = () => resolve()
                script.onerror = () => reject(new Error("Mapbox script failed to load."))
                document.head.appendChild(script)
            })
        }
        if (!(window as any).mapboxgl.workerUrl) {
            const res = await fetch(`https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VERSION}/mapbox-gl-csp-worker.js`)
            if (!res.ok) throw new Error(`Worker fetch failed (${res.status})`)
            const blob = new Blob([await res.text()], { type: "application/javascript" })
            ;(window as any).mapboxgl.workerUrl = URL.createObjectURL(blob)
        }
    })()
    mapboxLoadPromise.catch(() => { mapboxLoadPromise = null })
    return mapboxLoadPromise
}

/* ============================================================
   LAYER VISIBILITY HELPERS
   ============================================================ */
const OPACITY_PROP: Record<string, string> = {
    line: "line-opacity",
    fill: "fill-opacity",
    circle: "circle-opacity",
    symbol: "icon-opacity",
    raster: "raster-opacity",
    "fill-extrusion": "fill-extrusion-opacity",
    background: "background-opacity",
}
const layerOriginalOpacities: Record<string, number> = {}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function ParkMapHoverReveal() {
    // Current static-image framing params, mirrored into a ref (set in the render body) so the
    // map handlers — wired up once at map creation — read the values that match the <img> the
    // browser is actually rendering. Seeded with the lg defaults.
    const facadeParamsRef = useRef<{ staticW: number; staticH: number; staticZoom: number; staticCenter: [number, number] }>(
        { staticW: 1280, staticH: 1280, staticZoom: 12.5, staticCenter: [-71.10, 42.32] }
    )
    // Live-map "home" view = exactly what the facade static image shows. The image is cover-fit
    // into the container, so its effective zoom = staticZoom + the cover up-scale. Read the LIVE
    // container size (not React state) so it stays correct even if a ResizeObserver update is
    // still pending at map-init/idle time. Used for map init + every "reset to home".
    function computeHomeView(): { center: [number, number]; zoom: number } {
        const p = facadeParamsRef.current
        const el = mapContainer.current
        // Guard against a 0-sized container at init: clientWidth/Height can be 0 before layout
        // settles, which would make the cover scale 0 → log2(0) = -Infinity → an invalid map
        // zoom that never loads. Fall back to the static image dims (cover scale 1) in that case.
        const cw = el && el.clientWidth > 0 ? el.clientWidth : p.staticW
        const ch = el && el.clientHeight > 0 ? el.clientHeight : p.staticH
        const cs = Math.max(cw / p.staticW, ch / p.staticH) || 1
        const zoom = p.staticZoom + Math.log2(cs)
        return { center: p.staticCenter, zoom: Number.isFinite(zoom) ? zoom : p.staticZoom }
    }
    const mapContainer = useRef<HTMLDivElement>(null)
    const mapRef = useRef<any>(null)
    const carouselRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false })
    const poisRef = useRef<POIRecord[]>([])
    const selectedIdRef = useRef("")
    const prevSelectedIdRef = useRef("")
    const pinClickHandledRef = useRef(false)
    const hoveredPinIdRef = useRef<string | null>(null)
    // Pending buffered clear for the dot hover (see HOVER_LEAVE_BUFFER_MS).
    const dotHoverClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Hover-intent debounce timer for the card-hover fly (see handleCardHover).
    const cardFlyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // HOVER TAG anchoring: the currently-hovered dot's map coords + type, the rAF id driving
    // the tag's position, and a ref to the tag element. The tag is positioned IMPERATIVELY each
    // frame (no per-frame React re-render) so it stays flush against the dot's edge through the
    // hover-grow animation, zooming, and panning — none of which fire mousemove.
    const hoveredTagRef = useRef<{ id: string; lng: number; lat: number; simple: boolean; label: string } | null>(null)
    const tagRafRef = useRef(0)
    const tagElRef = useRef<HTMLDivElement>(null)
    // Facade equivalents — the facade hover tag tracks its dot's growing edge with a rAF that
    // mirrors the engaged positionTag (see the FACADE TAG TRACKING effect).
    const facadeTagRef = useRef<HTMLDivElement>(null)
    const facadeTagRafRef = useRef(0)
    // Per-POI in-flight hover-size animations (poiId → requestAnimationFrame id), so a new
    // hover/un-hover can cancel and reverse a running one. See animateHoverT().
    const hoverAnimRef = useRef<Record<string, number>>({})
    // FEATURED ROTATION (see startFeatured/bumpFeaturedActivity). All ref-based so the
    // once-attached activity listeners never read stale state.
    const featuredIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const featuredCycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const featuredAutoIdRef = useRef<string | null>(null)   // POI the rotation currently owns
    const featuredIndexRef = useRef(0)
    const featuredActiveRef = useRef(false)
    const carouselPOIsRef = useRef<POIRecord[]>([])          // live mirror of the featured list
    const featuredEligibleRef = useRef(false)                // mapped from the suppression state
    const mapLoadedRef = useRef(false)                       // so ref-based highlight can gate on it
    const isProgrammaticMoveRef = useRef(false)
    const zoomStartRef = useRef(0)
    const introPlayedRef = useRef(false)
    const layerBoundsRef = useRef<Record<string, [[number, number], [number, number]]>>({})
    // Whole-necklace bounding box [w,s,e,n] from the park tileset meta — used to detect when the
    // necklace has been panned entirely out of the viewport. Set once the tileset bounds load.
    const necklaceBoundsRef = useRef<[number, number, number, number] | null>(null)
    const parkLayersRef = useRef<ParkLayer[]>(INITIAL_PARK_LAYERS)
    const appliedParkSelRef = useRef<ParkSelection>(DEFAULT_PARK_SELECTION)
    // Saved original paint of the emerald-necklace-map-color fill, captured at idle so the
    // focus-dim (see the appliedParkSel effect) can restore it when no park is focused.
    const encOriginalColorRef = useRef<any>(null)
    const encOriginalOpacityRef = useRef<any>(null)
    const parkSourceRef = useRef<{ name: string; layer: string } | null>(null)
    const parkSymbolLayerRef = useRef<string | null>(null)   // style layer ID for park name labels
    const hoveredParkTitleRef = useRef<string | null>(null)  // currently hovered park name
    const easeToVisibleRef = useRef<((lng: number, lat: number, zoom: number, duration?: number) => void) | null>(null)

    const [pois, setPOIs] = useState<POIRecord[]>([])
    const [mapLoaded, setMapLoaded] = useState(false)
    const [status, setStatus] = useState("loading")
    // pick one critter for the "finding …" loading message; swapped for a fresh one
    // every few seconds if the load drags on (see the message-rotation effect below)
    const [loadingCritter, setLoadingCritter] = useState(() => LOADING_CRITTERS[Math.floor(Math.random() * LOADING_CRITTERS.length)])
    // Loading message reveal: the pill expands, then "Finding" / "{article adj}" /
    // "{animal}" slide up one at a time at EQUAL intervals. revealStep counts how
    // many of those 3 segments are shown (0→3). CSS-transition driven (not framer-
    // motion) so the button's `layout` projection can't reset the slide.
    const [revealStep, setRevealStep] = useState(0)
    const [errorMsg, setErrorMsg] = useState("")
    // Pre-loaded with the canonical park list so the filter shows parks instantly,
    // before the live map loads. Replaced with real (bounds-bearing) layers on map load.
    const [parkLayers, setParkLayers] = useState<ParkLayer[]>(INITIAL_PARK_LAYERS)
    const [selectedId, setSelectedId] = useState("")
    // Applied park selection — multi-select with an Emerald Necklace (all-parks) parent.
    // Default = Emerald Necklace (all parks, no POI park-filter).
    const [appliedParkSel, setAppliedParkSel] = useState<ParkSelection>(DEFAULT_PARK_SELECTION)
    const [filtersOpen, setFiltersOpen] = useState(false)
    // Paths dropdown open/close. The path options ARE the existing Toggle- layers,
    // driven through the shared layerToggles state below.
    const [pathsOpen, setPathsOpen] = useState(false)
    const [appliedFilters, setAppliedFilters] = useState<NonParkFilters>(EMPTY_NON_PARK)
    const [pendingFilters, setPendingFilters] = useState<PendingFilters>({ allParks: true, parks: [], fields: EMPTY_NON_PARK })
    const [carouselReady, setCarouselReady] = useState(false)
    // Carousel scroll-edge state — drives the conditional left/right arrows. An arrow
    // shows only when there's more carousel to reveal on that side.
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)
    const [containerWidth, setContainerWidth] = useState(1200)
    const [containerHeight, setContainerHeight] = useState(800)
    // FACADE: until the user clicks the map or a POI card, show a static image and DON'T
    // create the (billable) Mapbox map. Flips true on first meaningful click.
    const [mapActive, setMapActive] = useState(false)
    // HOVER-REVEAL VARIANT: on the facade, all UI (Filter / Paths / carousel) is
    // hidden, leaving only the "Explore Map" CTA. Hovering the map area reveals it.
    // Once the live map is active, UI behaves normally (always visible).
    const [uiRevealed, setUiRevealed] = useState(false)
    // Hold the UI up briefly after the cursor leaves (and cancel that pending hide
    // if it comes back), so it doesn't vanish the instant you move off the map.
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const HIDE_DELAY_MS = 700
    // true once the minimum loading-message display time has elapsed after activation
    const [minLoadElapsed, setMinLoadElapsed] = useState(false)
    const [hoveredPin, setHoveredPin] = useState<{ label: string; x: number; y: number; simple: boolean } | null>(null)
    // id of the carousel card currently hovered — that card grows to CARD_HOVER_W and pops OVER
    // its neighbours (the layout slot stays put, so nothing else shifts).
    const [hoveredCardId, setHoveredCardId] = useState("")
    // Live map zoom — drives the conditional "View whole necklace" button (shown when zoomed
    // in past ZOOM_OUT_MIN_ZOOM or out below VIEW_NECKLACE_BELOW_ZOOM) and the debug readout.
    // null until the live map has loaded.
    const [liveZoom, setLiveZoom] = useState<number | null>(null)
    // True when the Emerald Necklace is panned entirely outside the viewport — also drives the
    // "View whole necklace" button.
    const [necklaceOutOfFrame, setNecklaceOutOfFrame] = useState(false)
    // Hover state for the facade "Explore Map" CTA — shared so the inline map-icon chip
    // can squircle in sync with the button (its hover morph is driven from here).
    const [exploreHover, setExploreHover] = useState(false)
    // Explicit CTA transition phases, sequenced on activation (see effect below):
    //   facade     → icon chip + "Explore Map"
    //   collapsing → icon + label collapse together; the pill shrinks to a 72px circle
    //   loading    → the pill re-expands and the "Finding …" message appears
    const [ctaPhase, setCtaPhase] = useState<"facade" | "collapsing" | "loading">("facade")
    // True only during a PHASE morph (collapse / expand) — the pill's width+scale animate then.
    // Between phases (i.e. when the loading message rotates to a new critter) it's false, so the
    // pill SNAPS to the new width instantly. Otherwise the 0.38s width tween lags behind the words
    // sliding up (they reveal at ~220ms, the tween finishes at 380ms) and the last word clips.
    const [ctaMorphing, setCtaMorphing] = useState(false)
    // The pill animates its REAL css width between these states; auto↔px can't transition,
    // so we measure the facade + loading content widths and feed explicit pixels.
    const ctaFacadeRef = useRef<HTMLDivElement>(null)
    const ctaLoadingRef = useRef<HTMLDivElement>(null)
    const [ctaFacadeW, setCtaFacadeW] = useState(312)
    const [ctaLoadingW, setCtaLoadingW] = useState(480)

    // Toggle layers detected from Mapbox style on load — keyed by category (e.g. "Layers" → ["Bike Paths", "Walking Paths"])
    const [toggleLayersByCategory, setToggleLayersByCategory] = useState<Record<string, string[]>>({})
    // Visibility state — keyed by "Category--Name", false = hidden (default)
    const [layerToggles, setLayerToggles] = useState<Record<string, boolean>>({})

    /* === DERIVED: preview park layer names from Preview-Parks--XXXX Airtable fields === */
    const previewParkLayerNames = useMemo(() => {
        const names = new Set<string>()
        pois.forEach(poi => poi.previewParkLayers.forEach(n => names.add(n)))
        return [...names].sort()
    }, [pois])

    /* === DERIVED: unique filter options from loaded POI data (dynamic) === */
    const filterOptions = useMemo(() => {
        const sets: Record<string, Set<string>> = {}
        pois.forEach(poi => {
            Object.entries(poi.filterFields).forEach(([label, values]) => {
                if (!sets[label]) sets[label] = new Set<string>()
                values.forEach(v => sets[label].add(v))
            })
        })
        return Object.fromEntries(
            Object.entries(sets).map(([label, set]) => [label, [...set].sort()])
        ) as Record<string, string[]>
    }, [pois])

    // All park names currently in the list — used to detect "all selected" (= EN).
    const allParkNames = useMemo(() => parkLayers.map(l => l.label), [parkLayers])
    const isAllParksSelected = (parks: string[]) =>
        allParkNames.length > 0 && allParkNames.every(n => parks.includes(n))

    /* === DERIVED: POIs visible on map + carousel === */
    // All POIs matching the APPLIED filters (includes Simple POIs).
    const filteredPOIs = useMemo(() =>
        pois.filter(poi => poiMatchesFilters(poi, appliedParkSel, appliedFilters)),
        [pois, appliedParkSel, appliedFilters]
    )
    // All POIs matching the PENDING (in-progress) filters. Includes Simple POIs, like
    // filteredPOIs — drives the LIVE PREVIEW while the filter panel is open.
    const pendingPOIs = useMemo(() =>
        pois.filter(poi => poiMatchesFilters(poi, { allParks: pendingFilters.allParks, parks: pendingFilters.parks }, pendingFilters.fields)),
        [pois, pendingFilters]
    )
    // What the map + carousel actually render: a live preview of the PENDING filters while the
    // panel is open (results update as you toggle), else the APPLIED set. Reverts to applied
    // automatically when the panel closes (filtersOpen → false). Both branches are stable memo
    // refs, so deriving this each render is cheap.
    const displayPOIs = filtersOpen ? pendingPOIs : filteredPOIs
    // The single park currently pending (or null for EN / 0 / 2+). Shared by the live fly-to
    // effect (flies to it) and the panel map-padding effect (which steps aside when it's set,
    // so the two don't run competing camera moves).
    const solePendingPark = (!pendingFilters.allParks && pendingFilters.parks.length === 1)
        ? pendingFilters.parks[0]
        : null
    // Carousel POIs — same as displayPOIs but excludes Simple POIs.
    const carouselPOIs = useMemo(() =>
        displayPOIs.filter(poi => !isSimplePOI(poi)),
        [displayPOIs]
    )

    /* === DERIVED: selected POI record === */
    const selectedPOI = useMemo(() =>
        selectedId ? pois.find(p => p.id === selectedId) ?? null : null,
        [pois, selectedId]
    )

    /* === DERIVED: preview count for filter panel (pending filters) ===
       ALL matching POIs — Full AND Simple — so the "N results" number reflects every dot shown on the
       map, not just the carousel (Full-only) cards. */
    const pendingResultCount = pendingPOIs.length

    /* === SECTION: FETCH DATA === */
    useEffect(() => {
        fetchAllPOIs()
            .then(data => {
                poisRef.current = data
                setPOIs(data)
                setStatus("ready")
            })
            .catch(err => { setErrorMsg(err.message); setStatus("error") })
    }, [])

    /* === SECTION: MAP INIT (deferred until the facade is activated) === */
    useEffect(() => {
        if (!mapActive) return   // FACADE: no Mapbox map until the user activates it
        let destroyed = false
        loadMapbox().then(() => {
            if (destroyed || !mapContainer.current || mapRef.current) return
            const mapboxgl = (window as any).mapboxgl
            mapboxgl.accessToken = CONFIG.mapboxToken

            const initHome = computeHomeView()
            mapRef.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: CONFIG.mapStyle,
                // Home = the facade's effective view, so the facade→live swap doesn't reframe.
                center: initHome.center,
                zoom: initHome.zoom,
                minZoom: CONFIG.minZoom,
                // --- Gestures start disabled (safe default) ---
                // The ZONAL CONTROL effect (below) enables them while the pointer is in the
                // live band and disables them in the bottom dead zone, so page scroll passes
                // through there. If the effect never runs, the map stays fully locked — a
                // safe fallback.
                scrollZoom: false,       // desktop wheel zoom — lets the page scroll through
                touchZoomRotate: false,  // mobile pinch-to-zoom + rotate
                touchPitch: false,       // mobile two-finger pitch
                doubleClickZoom: false,  // double-tap / double-click zoom
                boxZoom: false,          // shift-drag zoom box
                dragPan: false,          // panning by dragging (mobile one-finger swipe scrolls page)
                dragRotate: false,       // right-drag / ctrl-drag rotate
            })

            // NavigationControl (+/- zoom + compass, top-right) removed — zoom is via
            // map gestures in the live band.
            mapRef.current.getCanvas().style.cursor = "default"

            mapRef.current.on("style.error", (e: any) => {
                console.error("ParkMap: style.error", e?.error?.message || String(e))
            })
            mapRef.current.on("dragstart", () => { mapRef.current.getCanvas().style.cursor = "grabbing" })
            mapRef.current.on("dragend", () => { mapRef.current.getCanvas().style.cursor = "default" })
            mapRef.current.on("zoomstart", () => { zoomStartRef.current = mapRef.current.getZoom() })
            mapRef.current.on("zoomend", () => {
                if (isProgrammaticMoveRef.current) { isProgrammaticMoveRef.current = false; return }
                if (mapRef.current.getZoom() < zoomStartRef.current) { setAppliedParkSel(DEFAULT_PARK_SELECTION) }
            })
            mapRef.current.on("error", (e: any) => {
                console.error("ParkMap: map error", e?.error?.message || String(e))
            })

            mapRef.current.on("load", () => {
                if (destroyed || !mapRef.current) return
                const map = mapRef.current
                map.resize()

                // Centers a lng/lat coordinate in the VISIBLE portion of the map
                // (i.e. to the left of the 480px detail overlay) at the given zoom.
                // Uses project/unproject to compute the exact geographic center needed.

                // Centers a POI in the visible portion of the map, accounting for the
                // POIDetailPanel. Uses Mapbox padding so it works even when zoom changes too.
                //   lg → panel is 60vw on the right  → pad right  (POI sits left of it)
                //   sm → panel is a bottom sheet      → pad bottom (POI sits above it)
                const easeToVisible = easeToVisibleRef.current = (lng: number, lat: number, zoom: number, duration = 400) => {
                    const el = map.getContainer()
                    // lg: reserve the detail panel's ACTUAL footprint — its width is min(60vw, 560)
                    // (maxWidth-capped) PLUS its 4vw right margin. The old flat 0.6·width over-
                    // reserved on wide screens (where 60vw ≫ 560), which pushed the POI too far left.
                    const panelRight = Math.min(el.clientWidth * 0.35, 560) + el.clientWidth * 0.04
                    const padding = el.clientWidth < BREAKPOINT
                        ? { top: 0, bottom: el.clientHeight * SM_SHEET_FRACTION, left: 0, right: 0 }
                        : { top: 0, bottom: 0, left: 0, right: panelRight }
                    map.easeTo({ center: [lng, lat], zoom, padding, duration })
                }

                map.addSource("poi-source", {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] },
                    promoteId: "id",
                })

                const firstSymbol = map.getStyle().layers.find((l: any) => l.type === "symbol")?.id

                // POI dot sizing:
                // – At zoom ≥ 13 dots are at full size (sizes below). Below zoom 13 they scale down linearly.
                // – Simple POIs: 7px default → 3px at z8 | 10px active → 4px at z8
                // – Regular POIs: 8px default → 1.5px at z8 | 16px hover (2× default) → 3px at z8 | 18px active → 4px at z8
                // To adjust the full sizes, edit the second stop (zoom 13) in each interpolate.
                // POI dot sizing — zoom interpolate MUST be the outermost expression (Mapbox GL restriction).
                // Zoom range: 8 (small) → 13 (full). To adjust sizes edit the numbers in the case branches.
                const isSimple = ["in", "Simple", ["get", "poiMode"]]
                const active   = ["boolean", ["feature-state", "active"], false]
                const hover    = ["boolean", ["feature-state", "hover"],  false]
                // hoverT (0→1) is a NUMERIC feature-state animated by animateHoverT() via rAF.
                // Mapbox ignores `*-transition` on zoom-dependent (interpolate-by-zoom) radius, so
                // the hover size can't transition on its own — we interpolate it by hoverT instead.
                const hoverT   = ["number", ["feature-state", "hoverT"], 0]
                // pulseT (0→1) is a NUMERIC feature-state driven by the continuous-pulse rAF (see
                // the LIVE PULSE effect). It continues the facade's looping parse wave on the engaged
                // map. PULSE_AMP matches the facade pulse (scale up to ~1.34×).
                const pulseT   = ["number", ["feature-state", "pulseT"], 0]
                const PULSE_AMP = 0.34
                // hv(rest, hovered): rest radius, animated to `hovered` by hoverT, PLUS a breathing
                // pulse (pulseT·PULSE_AMP·rest) that fades out as hover grows so a hovered dot doesn't pulse.
                const hv = (rest: number, hovered: number): any =>
                    ["+", rest, ["*", hoverT, hovered - rest], ["*", pulseT, rest * PULSE_AMP, ["-", 1, hoverT]]]

                map.addLayer({
                    id: "poi-dot", type: "circle", source: "poi-source",
                    paint: {
                        // Radius animates rest→hover via hoverT (rAF-driven). Regular dots double
                        // (8→16 at full zoom); Simple dots get a small bump; active is fixed.
                        // Hover SIZE unified across Simple + Full: both grow to the same hovered
                        // radius (3 / 8 / 16 at z8 / z12 / z14). Each type keeps its own REST size
                        // and its own color/border — only the hover target is shared.
                        "circle-radius": ["interpolate", ["linear"], ["zoom"],
                            8,  ["case", ["all", isSimple, active], 5,   isSimple, hv(1.5, 3), active, 5,   hv(1.5, 3)],
                            12, ["case", ["all", isSimple, active], 12,  isSimple, hv(3.5, 8), active, 12,  hv(4, 8)],
                            14, ["case", ["all", isSimple, active], 24,  isSimple, hv(7, 16),  active, 24,  hv(8, 16)],
                        ],
                        // FILL: Simple = lemna; Full(regular) = salix in EVERY state — hover just grows
                        // the dot (2×), it doesn't recolor. (Active keeps salix + the cream inner bullseye.)
                        "circle-color": ["case",
                            isSimple, C.lemna,
                            C.salix,
                        ],
                        // BORDER: Simple = salix ring; Full = lemna ring (default + hover; active drops it via width 0).
                        "circle-stroke-color": ["case",
                            isSimple, C.salix,
                            C.lemna,
                        ],
                        "circle-stroke-width": ["case",
                            isSimple, 1,   // Simple amenity dots keep their 1px ring
                            0,             // main (Page) dots: no border
                        ],
                        // Radius is animated frame-by-frame via hoverT/animateHoverT, so disable
                        // Mapbox's own radius transition (it would smear each rAF step — and it's
                        // ignored for zoom-interpolated radius anyway). Color still transitions here.
                        "circle-radius-transition": { duration: 0 },
                        "circle-color-transition": { duration: 200 },
                    },
                }, firstSymbol)

                map.on("click", "poi-dot", (e: any) => {
                    if (!e.features?.length) return
                    pinClickHandledRef.current = true
                    const poi = poisRef.current.find(p => p.id === e.features[0].properties.id)
                    if (!poi) return
                    setSelectedId(poi.id)
                    easeToVisible(poi.longitude, poi.latitude, Math.max(map.getZoom(), 14), 400)
                })

                map.on("click", () => {
                    if (pinClickHandledRef.current) { pinClickHandledRef.current = false; return }
                    setSelectedId("")
                })

                map.on("mouseenter", "poi-dot", (e: any) => {
                    if (!e.features?.length) return
                    const id = e.features[0].properties.id
                    // Buffer: (re)entering any dot cancels a pending leave.
                    if (dotHoverClearRef.current) { clearTimeout(dotHoverClearRef.current); dotHoverClearRef.current = null }
                    // Enter-guard: re-entering the dot we're already on is a no-op. This breaks the
                    // flicker loop — setData (deps incl. hoveredPin) re-fires leave+enter on a still
                    // cursor; without this each re-enter would re-run showHoverTag → setData → repeat.
                    if (id === hoveredPinIdRef.current) return
                    const name = e.features[0].properties.name ?? ""
                    const simple = String(e.features[0].properties.poiMode || "").includes("Simple")
                    hoveredPinIdRef.current = id
                    map.setFeatureState({ source: "poi-source", id }, { hover: true })
                    animateHoverT(id, 1)
                    map.getCanvas().style.cursor = "pointer"
                    const c = e.features[0].geometry.coordinates
                    showHoverTag(id, name, c[0], c[1], simple)
                    setHoveredCardId(id); revealCard(id)   // link map -> carousel: card hover + scroll into view
                })
                map.on("mousemove", "poi-dot", (e: any) => {
                    if (!e.features?.length) return
                    // Still inside the layer → cancel any pending (buffered) leave.
                    if (dotHoverClearRef.current) { clearTimeout(dotHoverClearRef.current); dotHoverClearRef.current = null }
                    const id = e.features[0].properties.id
                    const c = e.features[0].geometry.coordinates
                    // Moved onto a DIFFERENT dot without leaving the layer (common with adjacent /
                    // overlapping dots) — mouseenter/mouseleave don't fire, so do the full hover
                    // HANDOFF here. Otherwise the previous dot's tag just slides over to the new dot
                    // and neither the label nor the hover state updates.
                    if (id !== hoveredPinIdRef.current) {
                        if (hoveredPinIdRef.current) {
                            map.setFeatureState({ source: "poi-source", id: hoveredPinIdRef.current }, { hover: false })
                            animateHoverT(hoveredPinIdRef.current, 0)
                        }
                        const name = e.features[0].properties.name ?? ""
                        const simple = String(e.features[0].properties.poiMode || "").includes("Simple")
                        hoveredPinIdRef.current = id
                        map.setFeatureState({ source: "poi-source", id }, { hover: true })
                        animateHoverT(id, 1)
                        map.getCanvas().style.cursor = "pointer"
                        showHoverTag(id, name, c[0], c[1], simple)
                        setHoveredCardId(id); revealCard(id)   // link map -> carousel: card hover + scroll into view
                        return
                    }
                    // Same dot — just keep its anchor coords current (e.g. if its spread position
                    // shifts); the rAF (tagLoop/positionTag) re-projects + re-positions, no setState.
                    if (hoveredTagRef.current) { hoveredTagRef.current.lng = c[0]; hoveredTagRef.current.lat = c[1] }
                })
                map.on("mouseleave", "poi-dot", () => {
                    // Defer the clear: a spurious leave (from setData re-rendering the dots) that is
                    // immediately followed by a re-enter is cancelled above, so the hover never drops →
                    // no flicker. A real leave (no re-enter within the buffer) clears as normal.
                    if (dotHoverClearRef.current) clearTimeout(dotHoverClearRef.current)
                    dotHoverClearRef.current = setTimeout(() => {
                        dotHoverClearRef.current = null
                        if (hoveredPinIdRef.current) {
                            map.setFeatureState({ source: "poi-source", id: hoveredPinIdRef.current }, { hover: false })
                            animateHoverT(hoveredPinIdRef.current, 0)
                            hoveredPinIdRef.current = null
                        }
                        map.getCanvas().style.cursor = "default"
                        hideHoverTag()
                        setHoveredCardId("")   // clear the linked carousel-card hover
                    }, HOVER_LEAVE_BUFFER_MS)
                })

                // Detect Toggle-{Category}--{Name} layers from Mapbox style
                // Groups by category so they merge with matching Filter--{Category} Airtable sections
                const toggleCats: Record<string, string[]> = {}
                map.getStyle().layers
                    .map((l: any) => l.id as string)
                    .filter(id => /^Toggle-[^-].*--/.test(id))
                    .forEach(id => {
                        const withoutPrefix = id.slice("Toggle-".length)
                        const sep = withoutPrefix.indexOf("--")
                        if (sep < 0) return
                        const category = withoutPrefix.slice(0, sep)
                        const name = withoutPrefix.slice(sep + 2)
                        if (!toggleCats[category]) toggleCats[category] = []
                        toggleCats[category].push(name)
                        try { map.setLayoutProperty(id, "visibility", "none") } catch (_) {}
                    })
                if (Object.keys(toggleCats).length > 0) {
                    // Live detection is the source of truth — it overrides PATHS_FALLBACK.
                    setToggleLayersByCategory(toggleCats)
                    // Dev check: warn if the facade fallback has drifted from the real layers,
                    // so future updates know to refresh PATHS_FALLBACK.
                    const realKeys = Object.entries(toggleCats).flatMap(([c, ns]) => ns.map(n => `${c}--${n}`)).sort()
                    const fbKeys = Object.entries(PATHS_FALLBACK).flatMap(([c, ns]) => ns.map(n => `${c}--${n}`)).sort()
                    if (realKeys.join("|") !== fbKeys.join("|")) {
                        console.warn("ParkMap: PATHS_FALLBACK is out of sync with the style's Toggle- layers — update it.\n  fallback:", fbKeys, "\n  actual:  ", realKeys)
                    }
                }

                // Discover park layers from the Emerald Necklace tileset.
                // Find which style sources point to this tileset by URL (not by source-layer name guess).
                const styleObj = map.getStyle()
                const pkSourceNames: string[] = Object.entries(styleObj.sources as Record<string, any>)
                    .filter(([, src]) => {
                        const url: string = src.url ?? ""
                        return url.includes(CONFIG.parkTilesetId)
                    })
                    .map(([name]) => name)

                // Find all layers whose source is one of those source names
                const pkLayers = styleObj.layers.filter((l: any) => pkSourceNames.includes(l.source))
                const pkSourceLayer: string = pkLayers[0]?.["source-layer"] ?? ""
                const pkSourceName: string | null = pkSourceNames[0] ?? null

                // Only wire to valid style layer IDs — skip CONFIG.parkLabelsLayerId if it's not
                // an actual layer ID (it's the source-layer name, not the Mapbox style layer ID)
                const validLayerIds = new Set(styleObj.layers.map((l: any) => l.id as string))
                const autoSymbolIds = pkLayers.filter((l: any) => l.type === "symbol").map((l: any) => l.id as string)
                const allParkLabelIds = [...new Set([
                    ...(validLayerIds.has(CONFIG.parkLabelsLayerId) ? [CONFIG.parkLabelsLayerId] : []),
                    ...autoSymbolIds,
                ])]

                // Store the symbol layer ID so useEffect can update the halo when the park selection changes
                if (autoSymbolIds[0]) parkSymbolLayerRef.current = autoSymbolIds[0]

                // No visual hover effect on park labels — cursor change only (handled in mouseenter/mouseleave).

                // ─── PARK FILL LAYERS ────────────────────────────────────────────────────
                // Three fill layers are added over the park polygons, stacked in this order
                // (bottom → top):
                //
                //   park-fill-hit      — fully transparent; only exists for mouse event hit-testing
                //   park-fill-hover    — lilac at 10% opacity, shown when the cursor is over a park
                //   park-fill-selected — lilac at 15% opacity, shown when a park is focused
                //
                // All three are inserted BEFORE the layer named in PARK_FILL_BEFORE_LAYER below,
                // which controls their z-order in the Mapbox style stack. Change that one constant
                // to move all three fills above or below a different base-map layer.
                //
                // To adjust opacity: edit fill-opacity in the addLayer calls for
                // park-fill-hover (currently 0.10) and park-fill-selected (currently 1 — opaque).
                // ─────────────────────────────────────────────────────────────────────────
                // Insert the park fills BEFORE emerald-necklace-texture so they sit BELOW water,
                // roads, and the green texture — those all render ON TOP, so water + land stay clearly
                // readable through the selected park (the "clear lilac" look). Anchoring before
                // enc-hydrography instead stacks the fill ABOVE water/roads and washes them into one
                // purple blend. (emerald-necklace-texture is verified present in the style.)
                const PARK_FILL_BEFORE_LAYER = "emerald-necklace-texture"

                if (pkSourceName && pkSourceLayer) {
                    try {
                        const beforeFill = map.getLayer(PARK_FILL_BEFORE_LAYER) ? PARK_FILL_BEFORE_LAYER : (map.getLayer("poi-dot") ? "poi-dot" : undefined)
                        map.addLayer({
                            id: "park-fill-hover",
                            type: "fill",
                            source: pkSourceName,
                            "source-layer": pkSourceLayer,
                            // salix (faint dark-green) hover tint — matches the coworker (vs lilac).
                            paint: { "fill-color": C.salix, "fill-opacity": 0.10 },
                            filter: ["==", ["get", "Title"], ""],
                        }, beforeFill)
                        map.addLayer({
                            id: "park-fill-selected",
                            type: "fill",
                            source: pkSourceName,
                            "source-layer": pkSourceLayer,
                            // Opaque lilac (matches the coworker). It now sits BELOW water/roads/texture
                            // (see PARK_FILL_BEFORE_LAYER), so opaque reads as a clear lilac base with
                            // water + land showing through on top — not a wash over everything.
                            paint: { "fill-color": C.lilac, "fill-opacity": 1 },
                            filter: ["==", ["get", "Title"], ""],
                        }, beforeFill)
                    } catch (e) {
                        console.error("park fill layer error", e)
                    }
                }

                const normParkTitle = (s: string) => s.trim().toLowerCase().replace(/^the\s+/, "")
                const findParkLayer = (rawTitle: string) => {
                    const norm = normParkTitle(rawTitle)
                    return parkLayersRef.current.find(l => normParkTitle(l.label) === norm) ?? null
                }

                allParkLabelIds.forEach(layerId => {
                    map.on("click", layerId, (e: any) => {
                        if (!e.features?.length) return
                        pinClickHandledRef.current = true
                        const title: string = e.features[0].properties?.Title ?? e.features[0].properties?.label ?? ""
                        if (!title) return
                        const layer = findParkLayer(title)
                        if (!layer) {
                            // Log unmatched click so we can see the raw Title from the tileset
                        console.warn(`ParkMap: no park match for label click "${title}"`, parkLayersRef.current.map(l => l.label))
                            return
                        }
                        const cur = appliedParkSelRef.current
                        const isOnlyThis = !cur.allParks && cur.parks.length === 1 && cur.parks[0] === layer.label
                        if (isOnlyThis) {
                            // tapping the sole-selected park again → back to all parks (EN)
                            setAppliedParkSel(DEFAULT_PARK_SELECTION)
                            isProgrammaticMoveRef.current = true
                            { const h = computeHomeView(); map.flyTo({ center: h.center, zoom: h.zoom, duration: 800 }) }
                        } else {
                            // map tap → select ONLY this park and fly to it
                            setAppliedParkSel({ allParks: false, parks: [layer.label] })
                            zoomToPark(layer.id)
                        }
                    })
                    map.on("mouseenter", layerId, (e: any) => {
                        map.getCanvas().style.cursor = "pointer"
                        if (!e.features?.length) return
                        const title: string = e.features[0].properties?.Title ?? e.features[0].properties?.label ?? ""
                        if (!title) return
                        hoveredParkTitleRef.current = title
                        if (map.getLayer("park-fill-hover")) {
                            map.setFilter("park-fill-hover", ["==", ["get", "Title"], title])
                        }
                    })
                    map.on("mouseleave", layerId, () => {
                        map.getCanvas().style.cursor = "default"
                        hoveredParkTitleRef.current = null
                        if (map.getLayer("park-fill-hover")) {
                            map.setFilter("park-fill-hover", ["==", ["get", "Title"], ""])
                        }
                    })
                })

                // Add a transparent hit-test layer covering all park polygons.
                // This catches hover over Charlesgate/The Riverway whose label symbols
                // may not render in the current viewport. fill-opacity 0 = invisible but still interactive.
                if (pkSourceName && pkSourceLayer) {
                    try {
                        const beforeFillHit = map.getLayer(PARK_FILL_BEFORE_LAYER) ? PARK_FILL_BEFORE_LAYER : (map.getLayer("poi-dot") ? "poi-dot" : undefined)
                        map.addLayer({
                            id: "park-fill-hit",
                            type: "fill",
                            source: pkSourceName,
                            "source-layer": pkSourceLayer,
                            paint: { "fill-color": C.salix, "fill-opacity": 0 },
                        }, beforeFillHit)
                        // No hover or click on park-fill-hit — hover fill only triggers from the park name label
                    } catch (e) {
                        console.error("park hit layer error", e)
                    }
                }

                // Discover all parks + their bounds via querySourceFeatures.
                // fitBounds loads all tiles for the tileset, then idle fires once they're rendered.
                // No tilequery needed — park names come from the Title property on polygon features.
                if (pkSourceName && pkSourceLayer) {
                    fetch(`https://api.mapbox.com/v4/${CONFIG.parkTilesetId}.json?access_token=${CONFIG.mapboxToken}`)
                        .then(r => r.json())
                        .then(meta => {
                            if (destroyed || !mapRef.current) return
                            const [w, s, e, n] = meta.bounds as [number, number, number, number]
                            necklaceBoundsRef.current = [w, s, e, n]   // for the out-of-frame auto-home check
                            map.fitBounds([[w, s], [e, n]], { padding: 0, duration: 0, animate: false })
                            map.once("idle", () => {
                                if (destroyed || !mapRef.current) return
                                try { // ensure setMapLoaded always fires even if something below throws
                                const features = map.querySourceFeatures(pkSourceName!, { sourceLayer: pkSourceLayer })
                                const parksMap: Record<string, { w: number; s: number; e: number; n: number }> = {}

                                features.forEach((f: any) => {
                                    if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") return
                                    const title: string = f.properties?.Title ?? f.properties?.title ?? ""
                                    if (!title) return
                                    if (!parksMap[title]) parksMap[title] = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity }
                                    const b = parksMap[title]
                                    const rings = f.geometry.type === "Polygon"
                                        ? f.geometry.coordinates
                                        : (f.geometry.coordinates as number[][][][]).flat()
                                    ;(rings as number[][][]).flat().forEach(([lng, lat]: number[]) => {
                                        if (lng < b.w) b.w = lng; if (lat < b.s) b.s = lat
                                        if (lng > b.e) b.e = lng; if (lat > b.n) b.n = lat
                                    })
                                })

                                const layers: ParkLayer[] = Object.keys(parksMap)
                                    .filter(name => parksMap[name].w !== Infinity)
                                    .sort()
                                    .map(name => ({ id: name, label: name }))

                                layers.forEach(l => {
                                    const b = parksMap[l.id]
                                    layerBoundsRef.current[l.id] = [[b.w, b.s], [b.e, b.n]]
                                })


                                // Some small parks may not appear in querySourceFeatures tiles —
                                // merge in hardcoded fallbacks so they always show in the list.
                                const FALLBACK_PARKS: Array<{ label: string; bounds: [[number,number],[number,number]] }> = [
                                    { label: "Charlesgate", bounds: [[-71.097, 42.346], [-71.090, 42.351]] },
                                ]
                                FALLBACK_PARKS.forEach(({ label, bounds }) => {
                                    if (!layers.find(l => l.label === label)) {
                                        layers.push({ id: label, label })
                                        layerBoundsRef.current[label] = bounds
                                    }
                                })
                                // Sort to the canonical PARK_ORDER (module scope)
                                layers.sort((a, b) => {
                                    const ai = PARK_ORDER.findIndex(n => normParkTitle(n) === normParkTitle(a.label))
                                    const bi = PARK_ORDER.findIndex(n => normParkTitle(n) === normParkTitle(b.label))
                                    const ar = ai === -1 ? 999 : ai
                                    const br = bi === -1 ? 999 : bi
                                    return ar !== br ? ar - br : a.label.localeCompare(b.label)
                                })

                                const EXCLUDED_PARKS = ["justine mee liff park"]
                                const filteredLayers = layers.filter(
                                    l => !EXCLUDED_PARKS.includes(l.label.trim().toLowerCase())
                                )
                                if (filteredLayers.length > 0) setParkLayers(filteredLayers)
                                { const h = computeHomeView(); map.jumpTo({ center: h.center, zoom: h.zoom }) }

                                // Move POI dot layers to the very top of the layer stack.
                                // Mapbox GL renders symbol/label layers in a separate post-processing pass,
                                // so they always appear above circle layers regardless of stack position.
                                // This means poi-dot ends up above all fill/line layers but below all labels.
                                if (map.getLayer("poi-dot"))       map.moveLayer("poi-dot")

                                // ── Basemap green recolor (ported from ParkMap "Updates to the mapbox
                                // visuals") ───────────────────────────────────────────────────────────
                                // Recolor the base Mapbox land layers to the olive-green ramp (C.land).
                                // Done here at idle — while the facade still covers the canvas — with a
                                // 1.2s transition, so the map is already green when the facade fades out
                                // (no white→green flash). `land` is a background layer (background-*); the
                                // rest are fills (fill-*). Each guarded by getLayer + try/catch so a style
                                // rename silently no-ops rather than throwing. Layer ids verified present.
                                const landRecolor: Array<[string, string, string, string, number]> = [
                                    ["land",          "background-color", "background-opacity", C.land.base.normal, C.land.base.opacity],
                                    ["landcover",     "fill-color",       "fill-opacity",       C.land.base.normal, C.land.base.opacity],
                                    ["national-park", "fill-color",       "fill-opacity",       C.land.park.normal, C.land.park.opacity],
                                    ["landuse",       "fill-color",       "fill-opacity",       C.land.use.normal,  C.land.use.opacity],
                                ]
                                landRecolor.forEach(([id, colorProp, opacityProp, color, opacity]) => {
                                    if (!map.getLayer(id)) return
                                    try {
                                        // SNAP the initial green (transition 0) — the facade still covers the
                                        // canvas here, so there's nothing to animate against, and snapping
                                        // removes any white→green flash if the facade fade (gated on a separate
                                        // MIN_LOADING_MS floor, not this ramp) happens to land mid-ramp.
                                        map.setPaintProperty(id, `${colorProp}-transition`, { duration: 0 })
                                        map.setPaintProperty(id, colorProp, color)
                                        map.setPaintProperty(id, opacityProp, opacity)   // v3 doesn't animate opacity, so no transition needed
                                        // …then arm a smooth color transition for the focus-dim swaps that follow.
                                        map.setPaintProperty(id, `${colorProp}-transition`, { duration: 1200, delay: 0 })
                                    } catch (_) {}
                                })

                                // Snapshot the emerald-necklace-map-color fill so the focus-dim can
                                // restore it when no park is focused (see the appliedParkSel effect).
                                if (map.getLayer("emerald-necklace-map-color")) {
                                    try {
                                        encOriginalColorRef.current = map.getPaintProperty("emerald-necklace-map-color", "fill-color")
                                        encOriginalOpacityRef.current = map.getPaintProperty("emerald-necklace-map-color", "fill-opacity")
                                    } catch (_) {}
                                }

                                } catch(e) { console.error("ParkMap idle error", e) }
                                setMapLoaded(true)
                            })
                        })
                        .catch(() => setMapLoaded(true))
                } else {
                    setMapLoaded(true)
                }
            })
        }).catch(err => {
            if (!destroyed) { setErrorMsg(err.message); setStatus("error") }
        })

        return () => {
            destroyed = true
            // cancel any in-flight hover-size animations before tearing down the map
            Object.values(hoverAnimRef.current).forEach(id => cancelAnimationFrame(id))
            hoverAnimRef.current = {}
            if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
        }
    }, [mapActive])

    /* === SECTION: DEFERRED FLY-TO ===
       If a POI was selected (or a park filtered) before the live map existed, fly there
       once it loads. POI takes priority; otherwise zoom to the focused park. */
    useEffect(() => {
        if (!mapLoaded) return
        if (selectedPOI) {
            isProgrammaticMoveRef.current = true
            easeToVisibleRef.current?.(selectedPOI.longitude, selectedPOI.latitude, Math.max(mapRef.current?.getZoom() ?? 14, 14), 600)
        } else if (!appliedParkSel.allParks && appliedParkSel.parks.length === 1) {
            const layer = parkLayers.find(l => l.label === appliedParkSel.parks[0])
            if (layer) zoomToPark(layer.id)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapLoaded])

    /* === SECTION: EXTERNAL ACTIVATION ===
       Lets any other element on the page (e.g. an "Explore More" button) load the live
       map by dispatching:  window.dispatchEvent(new CustomEvent("parkmap:activate"))
       See the ExploreMoreOverride.tsx note for the Framer code override. */
    useEffect(() => {
        const activate = () => setMapActive(true)
        window.addEventListener("parkmap:activate", activate)
        return () => window.removeEventListener("parkmap:activate", activate)
    }, [])

    /* === SECTION: ZONAL MAP CONTROL ===
       Gestures are live only while the pointer is outside the dead zones (default: the
       bottom 30vh). In a dead zone, wheel/drag/pinch fall through to the page (so it
       scrolls). POI *clicks* still work everywhere — only gesture handlers are gated. */
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        const el = map.getContainer()
        const GESTURES = ["scrollZoom", "boxZoom", "dragPan", "dragRotate", "doubleClickZoom", "touchZoomRotate", "touchPitch"]
        let inBand: boolean | null = null
        const apply = (clientX: number, clientY: number) => {
            // Map-relative coords so the band tracks the map frame, not the window.
            const rect = el.getBoundingClientRect()
            const x = clientX - rect.left, y = clientY - rect.top
            const w = rect.width, h = rect.height
            const PAD = GESTURE_DEAD_PAD_PX
            // Live band: inside the GESTURE_DEAD_PAD_PX border AND outside the top/bottom vh dead zones.
            const topBound = Math.max(h * GESTURE_DEAD_TOP_VH, PAD)
            const bottomBound = Math.min(h * (1 - GESTURE_DEAD_BOTTOM_VH), h - PAD)
            const next = x >= PAD && x <= w - PAD && y >= topBound && y <= bottomBound
            if (next === inBand) return
            inBand = next
            GESTURES.forEach(g => {
                const handler = (map as any)[g]
                if (handler) next ? handler.enable() : handler.disable()
            })
        }
        const onMove = (e: PointerEvent) => apply(e.clientX, e.clientY)
        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerdown", onMove)
        // Start dead — don't grab gestures until the pointer is confirmed in the live band.
        GESTURES.forEach(g => (map as any)[g]?.disable())
        return () => {
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerdown", onMove)
        }
    }, [mapLoaded])

    /* === SECTION: SYNC POI SOURCE === */
    useEffect(() => {
        if (!mapLoaded || pois.length === 0) return
        const map = mapRef.current
        if (!map) return
        // The map dots track displayPOIs: the pending-filter preview while the panel is open,
        // else the applied set. (This effect re-runs whenever displayPOIs changes — see deps.)
        const items = displayPOIs

        // If the currently-hovered dot was just filtered out of the preview, drop the stale hover
        // state + tooltip — its mouseleave will never fire because the feature no longer exists.
        const hid = hoveredPinIdRef.current
        if (hid && !items.some(p => p.id === hid)) { hoveredPinIdRef.current = null; hideHoverTag() }

        // Dots whose centers fall within OVERLAP_PX of each other AT THE CURRENT ZOOM are
        // treated as overlapping and fanned onto a ring (a pair lands SPREAD_PX apart) so
        // each stays visible + clickable. Recomputed on zoom, so the spread engages only
        // while dots actually overlap and always reads ~SPREAD_PX (no fly-apart on zoom-in).
        const OVERLAP_PX = 4
        const SPREAD_PX = 6
        // ZOOM GATE: below this zoom the whole necklace collapses to a few pixels, so the
        // de-overlap fan would ring the ENTIRE dataset into one big circle. Only fan when zoomed
        // in past here; below it, dots stay at their true positions (reading as the necklace
        // shape, no circle). Raise/lower to tune where the fan kicks in.
        const SPREAD_MIN_ZOOM = 10
        const buildAndSet = () => {
            const source = map.getSource("poi-source")
            if (!source) return
            const ws = 512 * Math.pow(2, map.getZoom())   // Web-Mercator world size at this zoom
            const project = (lng: number, lat: number): [number, number] => {
                const s = Math.sin(lat * Math.PI / 180)
                return [(lng + 180) / 360 * ws, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws]
            }
            const unproject = (x: number, y: number): [number, number] => [
                x / ws * 360 - 180,
                180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / ws)),
            ]
            // project every POI to pixels, then union-find cluster those within OVERLAP_PX
            const P = new Map<string, [number, number]>()
            items.forEach(p => P.set(p.id, project(p.longitude, p.latitude)))
            const parent: Record<string, string> = {}
            items.forEach(p => { parent[p.id] = p.id })
            const find = (a: string): string => parent[a] === a ? a : (parent[a] = find(parent[a]))
            for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
                const a = P.get(items[i].id)!, b = P.get(items[j].id)!
                if (Math.hypot(a[0] - b[0], a[1] - b[1]) < OVERLAP_PX) parent[find(items[i].id)] = find(items[j].id)
            }
            const clusters: Record<string, string[]> = {}
            items.forEach(p => { const r = find(p.id); (clusters[r] = clusters[r] || []).push(p.id) })
            Object.values(clusters).forEach(ids => ids.sort())   // stable ring assignment
            const spreadOn = map.getZoom() >= SPREAD_MIN_ZOOM
            const spread = (poi: POIRecord): [number, number] => {
                if (!spreadOn) return [poi.longitude, poi.latitude]   // zoomed out → no fan, no circle
                const g = clusters[find(poi.id)]
                if (!g || g.length < 2) return [poi.longitude, poi.latitude]
                let cx = 0, cy = 0
                g.forEach(id => { const pt = P.get(id)!; cx += pt[0]; cy += pt[1] })
                cx /= g.length; cy /= g.length
                const R = SPREAD_PX / (2 * Math.sin(Math.PI / g.length))  // neighbours sit SPREAD_PX apart
                const angle = (g.indexOf(poi.id) / g.length) * 2 * Math.PI
                return unproject(cx + R * Math.cos(angle), cy + R * Math.sin(angle))
            }

            // Sort so hovered poi renders above others, active poi renders on top of all
            const activeId = selectedIdRef.current
            const hoveredId = hoveredPinIdRef.current
            const sorted = [...items].sort((a, b) => {
                const rankA = a.id === activeId ? 2 : a.id === hoveredId ? 1 : 0
                const rankB = b.id === activeId ? 2 : b.id === hoveredId ? 1 : 0
                return rankA - rankB
            })
            source.setData({
                type: "FeatureCollection",
                features: sorted.map(poi => ({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: spread(poi) },
                    properties: { id: poi.id, name: poi.name, poiMode: poi.poiMode ?? "" },
                })),
            })
            if (activeId) map.setFeatureState({ source: "poi-source", id: activeId }, { active: true })
        }

        buildAndSet()
        // Re-spread as zoom changes (rAF-throttled — one rebuild per frame).
        let raf = 0
        const onZoom = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; buildAndSet() }) }
        map.on("zoom", onZoom)
        return () => { map.off("zoom", onZoom); if (raf) cancelAnimationFrame(raf) }
    }, [mapLoaded, displayPOIs, selectedId, hoveredPin])

    /* === SECTION: FILTER PANEL MAP PADDING ===
       While the filter panel is open AND there's no single pending park, reserve the panel's
       width on the LEFT so the whole necklace shifts into the visible strip to its right (where
       the live filter preview is seen). When a single park IS pending, the LIVE FLY-TO effect
       below owns the framing (incl. the same left padding) — this steps aside via `solePendingPark`
       so the two never run competing camera moves. Only pads when there's a peek (container wider
       than the panel). Guarded to act on OPEN only — closing resets padding via the handlers. */
    useEffect(() => {
        if (!filtersOpen || !mapLoaded || !mapRef.current || solePendingPark) return
        const peek = containerWidth > FILTER_PANEL_MAX_W
        mapRef.current.easeTo({
            padding: { top: 0, bottom: 0, left: peek ? FILTER_PANEL_MAX_W : 0, right: 0 },
            duration: 300,
        })
    }, [filtersOpen, mapLoaded, containerWidth, solePendingPark])

    /* === SECTION: ACTIVE PIN STATE === */
    useEffect(() => {
        selectedIdRef.current = selectedId
        if (!mapLoaded || !mapRef.current) return
        try {
            if (prevSelectedIdRef.current) {
                mapRef.current.removeFeatureState({ source: "poi-source", id: prevSelectedIdRef.current }, "active")
            }
            if (selectedId) {
                mapRef.current.setFeatureState({ source: "poi-source", id: selectedId }, { active: true })
            }
            prevSelectedIdRef.current = selectedId
        } catch {}
    }, [selectedId, mapLoaded])

    /* === SECTION: LIVE PULSE ===
       Continues the facade's looping "parse" wave on the ENGAGED map: a single rAF tweens a
       numeric `pulseT` feature-state per dot, which the circle-radius reads (see hv()). Each dot's
       phase is by LATITUDE (north→south, matching the facade), so the pulse keeps flowing
       Charlesgate→Franklin Park. Only runs when the parse is enabled + in loop mode. */
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return
        if (!FACADE_DOT_PARSE.enabled || !FACADE_DOT_PARSE.loop) return
        const map = mapRef.current
        const list = poisRef.current
        if (list.length === 0) return
        const n = list.length
        // rank by latitude, north (highest lat) first → phase reversed (1 - rank/n) so the wave
        // travels north→south, exactly like the facade (see facadeDots loop-phase comment).
        const sorted = [...list].sort((a, b) => b.latitude - a.latitude)
        const phaseById: Record<string, number> = {}
        sorted.forEach((p, rank) => { phaseById[p.id] = 1 - rank / Math.max(1, n) })
        const D = FACADE_DOT_PARSE.duration
        const W = 0.30 // pulse occupies the first 30% of the cycle (rest of the cycle is flat) — matches the facade keyframe
        const waveform = (cp: number) => (cp < W ? Math.sin(Math.PI * cp / W) : 0) // smooth bump, peak at 15%
        let raf = 0
        const tick = (now: number) => {
            const base = now / D
            // The hovered dot (from map OR carousel hover) is held at pulseT 0 — hover overrides the
            // parse pulse so it doesn't breathe while enlarged.
            const hid = hoveredPinIdRef.current
            for (const p of list) {
                const pulse = p.id === hid ? 0 : waveform((base + phaseById[p.id]) % 1)
                try { map.setFeatureState({ source: "poi-source", id: p.id }, { pulseT: pulse }) } catch (_) {}
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [mapLoaded, pois])

    /* === SECTION: KEEP REFS IN SYNC === */
    useEffect(() => { parkLayersRef.current = parkLayers }, [parkLayers])
    useEffect(() => {
        appliedParkSelRef.current = appliedParkSel
        // Highlight all selected parks (none when Emerald Necklace / all parks).
        const map = mapRef.current as any
        if (map?.getLayer("park-fill-selected")) {
            map.setFilter("park-fill-selected",
                (!appliedParkSel.allParks && appliedParkSel.parks.length > 0)
                    ? ["in", ["get", "Title"], ["literal", appliedParkSel.parks]]
                    : ["==", ["get", "Title"], ""]
            )
        }

        // ── Focus spotlight (ported from ParkMap "Updates to the mapbox visuals") ────────────────
        // When a park is focused: wash the basemap land to its DIM tints and flatten the whole
        // Emerald Necklace (emerald-necklace-map-color) to lemna @ 0.5, so only the focused park —
        // drawn lilac by park-fill-selected on top — stands out. Restore the green ramp / original
        // EN paint when nothing is focused. Land transition (1.2s) carries over from the idle
        // recolor; the EN swap is instant (matching the source). Guarded by getLayer + try/catch.
        const focused = !appliedParkSel.allParks && appliedParkSel.parks.length > 0
        const landDim: Array<[string, string, string, string]> = [
            ["land",          "background-color", C.land.base.normal, C.land.base.dim],
            ["landcover",     "fill-color",       C.land.base.normal, C.land.base.dim],
            ["national-park", "fill-color",       C.land.park.normal, C.land.park.dim],
            ["landuse",       "fill-color",       C.land.use.normal,  C.land.use.dim],
        ]
        landDim.forEach(([id, prop, normal, dim]) => {
            if (map?.getLayer(id)) { try { map.setPaintProperty(id, prop, focused ? dim : normal) } catch (_) {} }
        })
        if (map?.getLayer("emerald-necklace-map-color")) {
            try {
                if (focused) {
                    map.setPaintProperty("emerald-necklace-map-color", "fill-color", C.lemna)
                    map.setPaintProperty("emerald-necklace-map-color", "fill-opacity", 0.5)
                } else if (encOriginalColorRef.current != null) {
                    // restore only once the original has actually been snapshotted (at idle) — avoids
                    // writing a null fill-color before the map has loaded.
                    map.setPaintProperty("emerald-necklace-map-color", "fill-color", encOriginalColorRef.current)
                    map.setPaintProperty("emerald-necklace-map-color", "fill-opacity", encOriginalOpacityRef.current ?? 1)
                }
            } catch (_) {}
        }
    }, [appliedParkSel])

    /* === SECTION: INTRO ANIMATION — removed, map starts at CONFIG.defaultCenter/Zoom === */

    /* === SECTION: CAROUSEL REVEAL ===
       Gated on POIs (Airtable), NOT the map — so the cards show in the facade state
       before the live map is ever loaded. */
    useEffect(() => {
        if (pois.length === 0 || carouselReady) return
        const timer = setTimeout(() => setCarouselReady(true), 300)
        return () => clearTimeout(timer)
    }, [pois, carouselReady])

    /* === SECTION: CAROUSEL ARROW STATE ===
       Recompute which scroll arrows to show whenever the card set, container width, or
       reveal state changes. Cards animate width 0→full over 0.3s, so re-measure once
       after that transition settles (and immediately, for the resize case). */
    useEffect(() => {
        updateCarouselArrows()
        const timer = setTimeout(updateCarouselArrows, 350)
        return () => clearTimeout(timer)
        // facadeUIHidden = !mapActive && !uiRevealed (declared later); use its inputs here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carouselPOIs, carouselReady, containerWidth, selectedId, mapActive, uiRevealed])

    /* === SECTION: MIN LOADING TIME ===
       Once the live map is triggered, hold the "finding …" message for at least
       MIN_LOADING_MS so it's readable even when the map loads near-instantly. */
    useEffect(() => {
        if (!mapActive) return
        const timer = setTimeout(() => setMinLoadElapsed(true), MIN_LOADING_MS)
        return () => clearTimeout(timer)
    }, [mapActive])

    /* === SECTION: CTA TRANSITION SEQUENCE ===
       Drives the Explore-Map button through its steps. On activation it collapses the
       facade content (icon + label) — the pill shrinks to a circle — then, once that
       finishes (CTA_COLLAPSE_MS, matching the grid transition), it expands into the
       loading message. The button is then dismissed by the outer AnimatePresence when
       mapLoaded && minLoadElapsed. */
    useEffect(() => {
        if (!mapActive) { setCtaPhase("facade"); return }
        const CTA_COLLAPSE_MS = 380
        setCtaPhase("collapsing")
        const t = setTimeout(() => setCtaPhase("loading"), CTA_COLLAPSE_MS)
        return () => clearTimeout(t)
    }, [mapActive])

    /* Enable the width/scale tween only while a phase morph is in flight (collapse → circle →
       expand), then turn it off so message rotations snap (see ctaMorphing). 440ms covers the
       0.38s tween plus a little slack. */
    useEffect(() => {
        setCtaMorphing(true)
        const t = setTimeout(() => setCtaMorphing(false), 440)
        return () => clearTimeout(t)
    }, [ctaPhase])

    /* Measure the facade + loading content widths so the pill can tween its real css width
       between them (and the 72px collapsed circle). Both contents are always rendered
       (absolutely, so they don't affect layout) and stay measurable; the ResizeObserver
       re-measures on web-font load and on each critter swap. */
    useEffect(() => {
        const measure = () => {
            // Each pill is sized to ITS OWN message — responsive, per-message. +20 slack so the
            // text never reaches the rounded caps. (min-width:max-content is the no-clip safety net.)
            if (ctaFacadeRef.current) setCtaFacadeW(Math.ceil(ctaFacadeRef.current.offsetWidth) + 20)
            if (ctaLoadingRef.current) setCtaLoadingW(Math.ceil(ctaLoadingRef.current.offsetWidth) + 20)
        }
        measure()
        // The web font (IBM Plex Sans) swap reflows the text WIDER than the fallback metrics; if we
        // only measured before it loaded, the pill would stay sized for the fallback and clip. Re-
        // measure once fonts are ready (and again after — some engines settle a frame later).
        const fonts = (typeof document !== "undefined" && (document as any).fonts) || null
        if (fonts?.ready?.then) fonts.ready.then(() => { measure(); requestAnimationFrame(measure) }).catch(() => {})
        const ro = new ResizeObserver(measure)
        if (ctaFacadeRef.current) ro.observe(ctaFacadeRef.current)
        if (ctaLoadingRef.current) ro.observe(ctaLoadingRef.current)
        return () => ro.disconnect()
    }, [])

    /* ROBUST re-measure — the ResizeObserver above can lag on a critter swap (some embeds
       fire it late or not at all), which would leave the pill sized for the PREVIOUS, shorter
       message while a longer one is shown → the text clips inside the pill. So we also measure
       synchronously, before paint, every time the displayed text changes (critter rotation or
       error). This guarantees the pill width always matches its current content — no inside clip. */
    React.useLayoutEffect(() => {
        // Measure the CURRENT message synchronously before paint, every time it changes — so each
        // pill fits its own message with no clip and no mid-expand kick. +20 slack.
        if (ctaFacadeRef.current) setCtaFacadeW(Math.ceil(ctaFacadeRef.current.offsetWidth) + 20)
        if (ctaLoadingRef.current) setCtaLoadingW(Math.ceil(ctaLoadingRef.current.offsetWidth) + 20)
    }, [loadingCritter, status, errorMsg, mapActive, ctaPhase])

    /* Loading message reveal: once the pill has expanded (≈ the 0.5s layout
       animation), slide up the three segments — "Finding", "{article adj}",
       "{animal}" — one at a time with EQUAL gaps. Keyed off mapActive only so the
       map's status churn (tiles loading/erroring) can't reset the cascade. */
    useEffect(() => {
        if (!mapActive) { setRevealStep(0); return }
        const EXPAND_MS = 500   // wait for the pill to finish expanding
        const GAP_MS = 220      // equal delay between each segment
        const timers = [1, 2, 3].map(step =>
            setTimeout(() => setRevealStep(step), EXPAND_MS + (step - 1) * GAP_MS)
        )
        return () => timers.forEach(clearTimeout)
    }, [mapActive])

    /* Message rotation: if the load drags on past 3.5s, swap in a fresh critter and
       replay the SAME reveal — the current words slide down/out, then the new ones
       cascade up at the same equal gaps. Repeats every 3.5s until the map is ready. */
    useEffect(() => {
        if (!mapActive || (mapLoaded && minLoadElapsed)) return
        const SWAP_MS = 3500    // rotate after this long still loading
        const DOWN_MS = 460     // ~slide-out duration before the swap
        const GAP_MS = 220      // equal delay between each segment (matches the reveal)
        let downTimer: ReturnType<typeof setTimeout>
        let upTimers: ReturnType<typeof setTimeout>[] = []
        const id = setInterval(() => {
            // Keep "Finding" (segment 0) in place; slide out only the sentence after
            // it — the "{article adj}" + "{animal}" segments (revealStep 1 hides them).
            setRevealStep(1)
            downTimer = setTimeout(() => {
                // pick a different critter, then cascade only the sentence back up
                setLoadingCritter(prev => {
                    let next = prev
                    while (next === prev) next = LOADING_CRITTERS[Math.floor(Math.random() * LOADING_CRITTERS.length)]
                    return next
                })
                upTimers = [2, 3].map((step, i) => setTimeout(() => setRevealStep(step), i * GAP_MS))
            }, DOWN_MS)
        }, SWAP_MS)
        return () => { clearInterval(id); clearTimeout(downTimer); upTimers.forEach(clearTimeout) }
    }, [mapActive, mapLoaded, minLoadElapsed])

    /* === SECTION: CONTAINER RESIZE === */
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver(entries => {
            setContainerWidth(entries[0].contentRect.width)
            setContainerHeight(entries[0].contentRect.height)
            // Keep Mapbox matched to the container on EVERY change (grow + shrink). Mapbox's
            // own trackResize only watches the window, so a Framer frame resize is missed
            // without this. No-op in the facade state (no map yet). resize() is lightweight.
            mapRef.current?.resize()
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Initialise all layer toggles to OFF (hidden) when categories are first detected
    useEffect(() => {
        const allKeys = Object.entries(toggleLayersByCategory)
            .flatMap(([cat, names]) => names.map(n => `${cat}--${n}`))
        if (allKeys.length === 0) return
        setLayerToggles(prev => {
            const next = { ...prev }
            allKeys.forEach(key => { if (!(key in next)) next[key] = false })
            return next
        })
    }, [toggleLayersByCategory])

    // Apply layer visibility to the map whenever toggles change
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded) return
        Object.entries(layerToggles).forEach(([key, visible]) => {
            try {
                map.setLayoutProperty(`Toggle-${key}`, "visibility", visible ? "visible" : "none")
            } catch (_) {}
        })
    }, [layerToggles, mapLoaded])

    // Walking Paths: render as DOTTED salix dots with a Cygnus border on the OUTSIDE of each
    // dot. Mapbox's own line-border draws INSIDE the line-width (it eats into the dot), so
    // instead we lay a slightly-wider Cygnus "casing" line UNDERNEATH the salix dots — it
    // peeks out ~1px all around, reading as an outer ring. The casing is hidden below z15
    // (so the border only appears as you zoom into the paths) and its dash period is tuned
    // to line up with the main dots at z ≥ 16. Paint override on the main line + one casing
    // layer; the main layer id is auto-detected from the style ("Toggle-{Category}--{Name}").
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded) return
        const L = "Toggle-Paths--Walking Paths"
        if (!map.getLayer(L)) return
        const CASING = "walking-paths-casing"
        try {
            // Main dotted line — round-cap SHORT CAPSULES, NO inside border (casing is the
            // border). The whole thing scales with zoom: ~1.6px dot at z16 → 2px at z18, so it
            // reads thinner/lighter at the wider view and fuller up close. dasharray [dash, gap]
            // in line-width units: dash 1 → straight body (+round caps); gap 1.5 → space between.
            // NOTE: line-dasharray can't vary with zoom (Mapbox ignores it), so the dot/ring are
            // scaled by varying the WIDTHS while keeping dasharrays fixed (see casing note).
            map.setPaintProperty(L, "line-dasharray", [1, 1.5])
            map.setPaintProperty(L, "line-width", ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.2, 16, 1.6, 18, 2])
            map.setPaintProperty(L, "line-border-width", 0)

            // Cygnus casing underneath = the outer ring. Kept at 2.5× the main width at every
            // zoom (z16: 4px vs 1.6px → 1.2px ring; z18: 5px vs 2px → 1.5px ring), hidden below
            // z15. Because casing-width = 2.5 × main-width and casing-dash-sum (1.0) = main-dash-
            // sum (2.5) ÷ 2.5, the casing's dot PERIOD always equals the main's → rings stay
            // aligned at every zoom, with fixed dasharrays (the only thing Mapbox allows here).
            const CASING_WIDTH = ["interpolate", ["exponential", 1.5], ["zoom"], 15, 0, 16, 4, 18, 5]
            const CASING_DASH = [0.4, 0.6]
            if (!map.getLayer(CASING)) {
                const sl = map.getStyle().layers.find((l: any) => l.id === L) as any
                if (sl?.source) {
                    map.addLayer({
                        id: CASING,
                        type: "line",
                        source: sl.source,
                        ...(sl["source-layer"] ? { "source-layer": sl["source-layer"] } : {}),
                        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
                        paint: {
                            "line-color": C.lemna,   // Lemna (duckweed) light green ring
                            "line-opacity": 1,
                            "line-dasharray": CASING_DASH as any,
                            "line-width": CASING_WIDTH as any,
                        },
                    }, L)   // insert BELOW the main line so the salix dots sit on top
                }
            }
            // Re-sync the casing's color + dash + width even if the layer already existed (e.g. HMR).
            if (map.getLayer(CASING)) {
                map.setPaintProperty(CASING, "line-color", C.lemna)
                map.setPaintProperty(CASING, "line-dasharray", CASING_DASH as any)
                map.setPaintProperty(CASING, "line-width", CASING_WIDTH as any)
            }
        } catch (_) {}
    }, [mapLoaded])

    // Keep the Cygnus casing's visibility in lockstep with the Walking Paths toggle (the
    // casing isn't a "Toggle-" layer, so the generic visibility effect above doesn't touch it).
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded || !map.getLayer("walking-paths-casing")) return
        const on = layerToggles["Paths--Walking Paths"] === true
        try { map.setLayoutProperty("walking-paths-casing", "visibility", on ? "visible" : "none") } catch (_) {}
    }, [layerToggles, mapLoaded])

    // Bike Paths: Salix, 4px at z16, with a 0.5px Cygnus border on the OUTSIDE.
    // Mapbox's own line-border draws INSIDE the line, so the outside border is a Cygnus
    // "casing" line 1px wider (0.5px each side) laid UNDERNEATH the yellow line. Solid line,
    // so no dash-alignment is needed (unlike the walking-path casing).
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded) return
        const L = "Toggle-Paths--Bike Paths"
        if (!map.getLayer(L)) return
        const CASING = "bike-paths-casing"
        const BIKE_WIDTH = ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.4, 16, 4]
        const CASING_WIDTH = ["interpolate", ["exponential", 1.5], ["zoom"], 0, 1.4, 16, 5]   // main + 1px → 0.5px ring
        try {
            map.setPaintProperty(L, "line-color", C.salix)
            map.setPaintProperty(L, "line-width", BIKE_WIDTH as any)
            map.setPaintProperty(L, "line-opacity", 1)
            map.setPaintProperty(L, "line-border-width", 0)   // no inside border — casing is the (outside) border
            if (!map.getLayer(CASING)) {
                const sl = map.getStyle().layers.find((l: any) => l.id === L) as any
                if (sl?.source) {
                    map.addLayer({
                        id: CASING,
                        type: "line",
                        source: sl.source,
                        ...(sl["source-layer"] ? { "source-layer": sl["source-layer"] } : {}),
                        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
                        paint: { "line-color": C.cygnus, "line-opacity": 1, "line-width": CASING_WIDTH as any },
                    }, L)   // insert BELOW the yellow line so it peeks out as a 0.5px ring
                }
            }
            if (map.getLayer(CASING)) {
                map.setPaintProperty(CASING, "line-color", C.cygnus)
                map.setPaintProperty(CASING, "line-width", CASING_WIDTH as any)
            }
        } catch (_) {}
    }, [mapLoaded])

    // Keep the bike-path casing's visibility in lockstep with the Bike Paths toggle.
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded || !map.getLayer("bike-paths-casing")) return
        const on = layerToggles["Paths--Bike Paths"] === true
        try { map.setLayoutProperty("bike-paths-casing", "visibility", on ? "visible" : "none") } catch (_) {}
    }, [layerToggles, mapLoaded])

    // Keep liveZoom in sync with the live map zoom (drives the Zoom Out button + debug readout).
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded) return
        const update = () => setLiveZoom(map.getZoom())
        update()
        map.on("zoom", update)
        return () => { map.off("zoom", update) }
    }, [mapLoaded])

    // OUT-OF-FRAME DETECTOR: track whether the Emerald Necklace is panned entirely outside the
    // viewport. Drives the "View whole necklace" button (together with the zoom thresholds). It no
    // longer auto-snaps home — the user clicks the button to return. Updates live on "move"; the
    // change-guarded setState only re-renders when the boolean actually flips.
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded) return
        const update = () => {
            const nb = necklaceBoundsRef.current
            if (!nb) return
            const v = map.getBounds()
            const [w, s, e, n] = nb
            // No overlap between the viewport and the necklace bbox -> fully out of frame.
            const out = v.getWest() > e || v.getEast() < w || v.getSouth() > n || v.getNorth() < s
            setNecklaceOutOfFrame(prev => prev === out ? prev : out)
        }
        update()
        map.on("move", update)
        return () => { map.off("move", update) }
    }, [mapLoaded])

    // Show Preview-Parks--XXXX layers for 4 seconds after map + data are ready, then hide
    useEffect(() => {
        const map = mapRef.current
        if (!map || !mapLoaded || previewParkLayerNames.length === 0) return
        const show = () => {
            previewParkLayerNames.forEach(id => {
                try { map.setLayoutProperty(id, "visibility", "visible") } catch (_) {}
            })
        }
        const hide = () => {
            previewParkLayerNames.forEach(id => {
                try { map.setLayoutProperty(id, "visibility", "none") } catch (_) {}
            })
        }
        show()
        const timer = setTimeout(hide, 4000)
        return () => { clearTimeout(timer); hide() }
    }, [mapLoaded, previewParkLayerNames])

    /* === ZOOM TO PARK === */
    async function zoomToPark(layerId: string, padding?: { top: number; bottom: number; left: number; right: number }) {
        if (!mapRef.current) return
        const map = mapRef.current
        let bounds = layerBoundsRef.current[layerId]
        if (!bounds) {
            const styleLayer = map.getStyle()?.layers?.find((l: any) => l.id === layerId)
            const source = styleLayer ? map.getSource(styleLayer.source) as any : null
            const sourceUrl: string = source?.url || ""
            if (sourceUrl.startsWith("mapbox://")) {
                const tilesetIds = sourceUrl.replace("mapbox://", "").split(",").map((s: string) => s.trim())
                const sourceLayer: string = styleLayer?.["source-layer"] || ""
                const results = await Promise.all(
                    tilesetIds.map((id: string) =>
                        fetch(`https://api.mapbox.com/v4/${id}.json?access_token=${CONFIG.mapboxToken}`)
                            .then(r => r.ok ? r.json() : null).catch(() => null)
                    )
                )
                for (const tj of results) {
                    if (!tj?.bounds) continue
                    const hasLayer = !sourceLayer || tj.vector_layers?.some((vl: any) => vl.id === sourceLayer)
                    if (!hasLayer) continue
                    const [w, s, e, n] = tj.bounds
                    if (e - w > 170 || n - s > 80) continue
                    bounds = [[w, s], [e, n]]
                    layerBoundsRef.current[layerId] = bounds
                    break
                }
            }
        }
        if (!bounds || !mapRef.current) return
        isProgrammaticMoveRef.current = true
        // CAROUSEL_PAD: bottom padding when fitting a park — keeps the park bounds above the carousel.
        // The carousel sits at bottom:40 and cards are ~302px tall, so ~360px total.
        // Increase this number if the park polygon still clips behind the carousel.
        const CAROUSEL_PAD = 360
        const pad = padding ?? { top: 40, bottom: CAROUSEL_PAD, left: 40, right: 40 }
        mapRef.current.fitBounds(bounds, { padding: pad, duration: 800 })
    }

    // LIVE FLY-TO: while the filter panel is open, fly to a park the instant it becomes the
    // SOLE pending selection (solePendingPark, derived above). Keyed on that park name, so it
    // fires only when the park changes (toggling other filters won't re-fly) and not for 0/2+
    // parks. Padding clears the left panel when there's a peek (container wider than the panel),
    // matching the FILTER PANEL MAP PADDING effect's threshold so the two stay consistent; below
    // that the panel covers the map, so just center the park. Carousel is hidden while filtering,
    // so no bottom carousel padding is needed.
    useEffect(() => {
        if (!filtersOpen || !mapLoaded || !solePendingPark) return
        const layer = parkLayersRef.current.find(l => l.label === solePendingPark)
        if (!layer) return
        const peek = containerWidth > FILTER_PANEL_MAX_W
        const pad = peek
            ? { top: 40, bottom: 40, left: FILTER_PANEL_MAX_W + 40, right: 40 }   // clear the left panel
            : { top: 40, bottom: 40, left: 40, right: 40 }                        // panel covers the map
        zoomToPark(layer.id, pad)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtersOpen, mapLoaded, solePendingPark])

    // Release the filter panel's left map-padding (back to no reserved space).
    function resetMapPadding() {
        mapRef.current?.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 })
    }

    function openFilters() {
        setMapActive(true)   // FACADE: opening the filter loads the live map (apply no longer does)
        setPendingFilters({ allParks: appliedParkSel.allParks, parks: [...appliedParkSel.parks], fields: { ...appliedFilters } })
        setSelectedId("")
        // Map left-padding (so the necklace shifts into the strip right of the panel) is applied
        // by the FILTER PANEL MAP PADDING effect — it also covers first-open-from-facade, where
        // the map isn't created yet at this point.
        setFiltersOpen(true)
    }

    // ZOOM OUT → back to the map's initial launch view: the exact center/zoom the live map
    // opens at (computeHomeView — the full Emerald Necklace overview). Also clears any selected
    // POI and park focus so it matches that initial state, and activates the map if still on
    // the facade. flyTo padding reset undoes any POI-detail offset.
    function goHome() {
        setMapActive(true)
        setSelectedId("")
        setAppliedParkSel(DEFAULT_PARK_SELECTION)
        setPathsOpen(false)
        const h = computeHomeView()
        isProgrammaticMoveRef.current = true
        mapRef.current?.flyTo({ center: h.center, zoom: h.zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 800 })
    }

    function handleApply() {
        // Normalize the pending park selection.
        let sel: ParkSelection = pendingFilters.allParks
            ? { allParks: true, parks: [] }
            : { allParks: false, parks: [...pendingFilters.parks] }
        if (!sel.allParks && sel.parks.length === 0) return            // zero parks — blocked (panel guards)
        if (!sel.allParks && isAllParksSelected(sel.parks)) sel = { allParks: true, parks: [] } // all → EN

        setAppliedFilters(pendingFilters.fields)

        const parkChanged = sel.allParks !== appliedParkSel.allParks
            || sel.parks.length !== appliedParkSel.parks.length
            || sel.parks.some(p => !appliedParkSel.parks.includes(p))
        setAppliedParkSel(sel)

        // Each branch also releases the panel's left padding (zoomToPark replaces it with its
        // own fit padding; the others reset to 0) so the map doesn't stay shifted after close.
        if (parkChanged) {
            // exactly 1 park → fly to it; all parks (EN) or ≥2 → default zoom
            if (!sel.allParks && sel.parks.length === 1) {
                const layer = parkLayers.find(l => l.label === sel.parks[0])
                if (layer) zoomToPark(layer.id)
                else resetMapPadding()
            } else {
                isProgrammaticMoveRef.current = true
                const h = computeHomeView()
                mapRef.current?.flyTo({ center: h.center, zoom: h.zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 800 })
            }
        } else {
            resetMapPadding()
        }
        setFiltersOpen(false)
    }

    // Full reset to the default state: Emerald Necklace (all parks), no field filters, no path toggles.
    function handleClear() {
        setPendingFilters({ allParks: true, parks: [], fields: {} })
        setLayerToggles(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])))
    }

    // Animate a dot's hover SIZE by tweening its `hoverT` feature-state (0↔1) with rAF. The
    // circle-radius expression reads hoverT (see hv() in the poi-dot paint), so each frame grows
    // / shrinks the dot. Reverses smoothly from the current value if interrupted (re-hover).
    const HOVER_ANIM_MS = 200
    function animateHoverT(poiId: string, to: 0 | 1) {
        const map = mapRef.current
        if (!map || !poiId) return
        const anims = hoverAnimRef.current
        if (anims[poiId]) cancelAnimationFrame(anims[poiId])
        let from = 0
        try { const s = map.getFeatureState({ source: "poi-source", id: poiId }); if (typeof s?.hoverT === "number") from = s.hoverT } catch (_) {}
        const t0 = performance.now()
        const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2) // easeInOutQuad
        const step = (now: number) => {
            const p = Math.min(1, (now - t0) / HOVER_ANIM_MS)
            const v = from + (to - from) * ease(p)
            try { map.setFeatureState({ source: "poi-source", id: poiId }, { hoverT: v }) } catch (_) {}
            if (p < 1) anims[poiId] = requestAnimationFrame(step)
            else delete anims[poiId]
        }
        anims[poiId] = requestAnimationFrame(step)
    }

    // Position the hover tag flush against the hovered dot's edge. Re-measures the dot's CURRENT
    // outer radius (zoom + the live hoverT grow) and re-projects its screen position, so there's
    // never a gap or overlap — at rest, mid-grow, while zooming, or while panning. Imperative DOM
    // writes (no setState) keep it cheap at 60fps.
    function positionTag() {
        const map = mapRef.current, c = hoveredTagRef.current, el = tagElRef.current
        if (!map || !c || !el) return
        const pt = map.project([c.lng, c.lat])
        const zoom = map.getZoom()
        let hoverT = 1
        try { const s = map.getFeatureState({ source: "poi-source", id: c.id }); if (typeof s?.hoverT === "number") hoverT = s.hoverT } catch (_) {}
        // outer radius = animated fill radius (rest→hover by hoverT) + the dot's stroke
        const rest = liveDotRadius(zoom, c.simple)
        const radius = rest + hoverT * (liveDotHoverRadius(zoom) - rest) + liveDotStroke(c.simple)
        const cw = containerRef.current?.clientWidth ?? 1200
        const estTagWidth = c.label.length * 8 + 24   // overestimate so we flip before clipping
        const placeLeft = pt.x + radius + estTagWidth > cw - 8
        el.style.left = (pt.x + (placeLeft ? -radius : radius)) + "px"
        el.style.top = pt.y + "px"
        el.style.transform = placeLeft ? "translate(-100%, -50%)" : "translateY(-50%)"
    }
    function tagLoop() {
        positionTag()
        tagRafRef.current = hoveredTagRef.current ? requestAnimationFrame(tagLoop) : 0
    }
    function showHoverTag(id: string, label: string, lng: number, lat: number, simple: boolean) {
        hoveredTagRef.current = { id, lng, lat, simple, label }
        const pt = mapRef.current ? mapRef.current.project([lng, lat]) : { x: 0, y: 0 }
        setHoveredPin({ label, x: pt.x, y: pt.y, simple })   // initial; positionTag() takes over each frame
        if (!tagRafRef.current) tagRafRef.current = requestAnimationFrame(tagLoop)
    }
    function hideHoverTag() {
        hoveredTagRef.current = null
        if (tagRafRef.current) { cancelAnimationFrame(tagRafRef.current); tagRafRef.current = 0 }
        setHoveredPin(null)
    }
    // Position the tag on show / label change BEFORE the browser paints (no first-frame flash);
    // the rAF then keeps it flush every frame after. Also stop the rAF when the component unmounts.
    React.useLayoutEffect(() => { if (hoveredPin) positionTag() }, [hoveredPin])
    useEffect(() => () => { if (tagRafRef.current) cancelAnimationFrame(tagRafRef.current) }, [])

    // Shared highlight primitive — the EXACT dot-grow + name-tag hover state. Reused by the
    // carousel-card hover AND the featured rotation, so the two are visually identical and
    // route through the same single-hover state machine (hoveredPinIdRef). Ref-gated so the
    // rotation's once-attached timers never read stale `mapLoaded`.
    function highlightDot(poiId: string) {
        const map = mapRef.current
        if (!map || !mapLoadedRef.current) return
        if (hoveredPinIdRef.current && hoveredPinIdRef.current !== poiId) {
            map.setFeatureState({ source: "poi-source", id: hoveredPinIdRef.current }, { hover: false })
            animateHoverT(hoveredPinIdRef.current, 0)
        }
        hoveredPinIdRef.current = poiId
        map.setFeatureState({ source: "poi-source", id: poiId }, { hover: true })
        animateHoverT(poiId, 1)
        // Tag too, so it matches a direct map-dot hover. Anchored to the POI's map position.
        const poi = poisRef.current.find(p => p.id === poiId)
        if (poi) showHoverTag(poiId, poi.name, poi.longitude, poi.latitude, isSimplePOI(poi))
    }
    function unhighlightDot(poiId: string) {
        const map = mapRef.current
        if (!map) return
        map.setFeatureState({ source: "poi-source", id: poiId }, { hover: false })
        animateHoverT(poiId, 0)
        if (hoveredPinIdRef.current === poiId) { hoveredPinIdRef.current = null; hideHoverTag() }
    }

    // Smoothly center a POI dot on screen (zoom 14, slight zoom-out dip, lifted above the carousel
    // on short viewports). Shared by the idle attract rotation and the card-hover fly below; the
    // caller picks the pace via duration.
    function flyToCenterPOI(poi: POIRecord, duration: number, minZoomFloor: number = 13.9) {
        const map = mapRef.current
        if (!map) return
        isProgrammaticMoveRef.current = true   // the mid-flight zoom-out must not trip the zoomend park-reset
        const el = map.getContainer()
        const bottomPad = Math.max(0, 2 * (24 + CARD_HOVER_H + 28) - el.clientHeight)
        // Distance-proportional zoom-out: scale the flight's peak (most zoomed-out point) by how far
        // the target sits from screen center. Short hops barely dip (almost a straight pan); long hops
        // pull back toward minZoomFloor. Clamp the peak to the current zoom so a short hop from an
        // already-zoomed-out camera just glides in (no pointless dip-then-climb).
        const to = map.project([poi.longitude, poi.latitude])
        const travelPx = Math.hypot(to.x - el.clientWidth / 2, to.y - el.clientHeight / 2)
        const t = Math.max(0, Math.min(1, (travelPx - FLY_NEAR_PX) / (FLY_FAR_PX - FLY_NEAR_PX)))
        const peak = Math.min(FLY_NEAR_PEAK + (minZoomFloor - FLY_NEAR_PEAK) * t, map.getZoom())
        map.flyTo({
            center: [poi.longitude, poi.latitude],
            zoom: 14,
            minZoom: peak,   // peak (max zoom-out) of the flight — hard cap, can't compound
            curve: 1.4,
            duration,
            padding: { top: 0, bottom: bottomPad, left: 0, right: 0 },
            easing: featuredEase,
        })
    }

    function handleCardHover(poiId: string) {
        highlightDot(poiId)   // instant feedback: dot grow + name tag
        // HOVER-INTENT: only fly after the cursor SETTLES on a card (~180ms). A quick sweep A->B->C
        // cancels the intermediate flies, so the camera moves only to the card you land on — it can
        // never finish centered on a card you've already moved off of.
        if (cardFlyTimerRef.current) clearTimeout(cardFlyTimerRef.current)
        cardFlyTimerRef.current = setTimeout(() => {
            cardFlyTimerRef.current = null
            if (hoveredPinIdRef.current !== poiId) return   // hover moved/ended before the delay elapsed
            const map = mapRef.current
            if (!map || !mapLoadedRef.current) return
            const poi = poisRef.current.find(p => p.id === poiId)
            if (!poi) return
            const pt = map.project([poi.longitude, poi.latitude])
            const el = map.getContainer()
            const m = 40                                                 // side edge margin
            const topM = 76                                             // clear the top Filter/Paths controls (top:24 + ~48 tall)
            const carouselTop = el.clientHeight - (24 + CARD_HOVER_H)    // bottom strip the carousel covers
            const inView = pt.x >= m && pt.x <= el.clientWidth - m && pt.y >= topM && pt.y <= carouselTop - 8
            // Fly if the dot isn't comfortably in view, OR the camera is still animating (a prior
            // fly makes "in view" unreliable) — guarantees we end on the card actually hovered.
            if (!inView || map.isMoving()) flyToCenterPOI(poi, HOVER_FLY_MS, HOVER_FLY_MIN_ZOOM)
        }, HOVER_FLY_INTENT_MS)
    }
    function handleCardHoverEnd(poiId: string) {
        if (cardFlyTimerRef.current) { clearTimeout(cardFlyTimerRef.current); cardFlyTimerRef.current = null }
        unhighlightDot(poiId)
    }

    /* === FEATURED ROTATION ENGINE ===
       All ref-based so the once-attached activity listeners stay correct across renders. */
    function featuredTick() {
        const list = carouselPOIsRef.current
        if (!list.length) return
        const poi = list[featuredIndexRef.current % list.length]
        featuredIndexRef.current = (featuredIndexRef.current + 1) % list.length
        // Mirror a real map-dot hover EXACTLY: dot grow + name tag, PLUS the linked carousel
        // card (grow via hoveredCardId, and scroll it into focus). setHoveredCardId replaces
        // the prior featured card, so the previous one un-grows automatically.
        highlightDot(poi.id)                 // dot grow + tag (crossfades off the previous dot)
        setHoveredCardId(poi.id)             // carousel card grows (hoveredExternally)
        revealCard(poi.id)                   // scroll the focused card into view
        featuredAutoIdRef.current = poi.id
        // Glide to center this POI (shared centering+zoom helper); 4s for a calm attract pace.
        flyToCenterPOI(poi, FEATURED_FLY_MS)
    }

    function startFeatured() {
        if (featuredActiveRef.current || !featuredEligibleRef.current) return
        featuredActiveRef.current = true
        featuredIndexRef.current = 0
        featuredTick()                        // highlight the first one immediately
        featuredCycleTimerRef.current = setInterval(featuredTick, FEATURED_CYCLE_MS)
    }
    function stopFeatured() {
        featuredActiveRef.current = false
        if (featuredCycleTimerRef.current) { clearInterval(featuredCycleTimerRef.current); featuredCycleTimerRef.current = null }
        // Clear the highlight ONLY if the rotation still owns it (the user hasn't taken over).
        const auto = featuredAutoIdRef.current
        if (auto && hoveredPinIdRef.current === auto) unhighlightDot(auto)
        // Same for the linked card hover (guarded so a manual card hover isn't wiped).
        if (auto) setHoveredCardId(prev => (prev === auto ? "" : prev))
        featuredAutoIdRef.current = null
    }
    // Any engagement: stop the rotation now and re-arm the idle timer (only if eligible).
    function bumpFeaturedActivity() {
        stopFeatured()
        if (featuredIdleTimerRef.current) clearTimeout(featuredIdleTimerRef.current)
        if (featuredEligibleRef.current) featuredIdleTimerRef.current = setTimeout(startFeatured, FEATURED_IDLE_MS)
    }

    // Mirror the featured list + eligibility into refs and treat any of these changing as
    // activity (entering a suppressed state stops the rotation; leaving it re-arms the idle
    // timer). Suppressed while a detail panel or the Filter/Paths panels are open.
    useEffect(() => {
        carouselPOIsRef.current = carouselPOIs
        mapLoadedRef.current = mapLoaded
        featuredEligibleRef.current =
            mapLoaded && mapActive && !selectedId && !filtersOpen && !pathsOpen && carouselPOIs.length > 0
        bumpFeaturedActivity()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carouselPOIs, mapLoaded, mapActive, selectedId, filtersOpen, pathsOpen])

    // Engagement detection: any pointer/scroll/touch on the component resets the idle clock
    // (and stops a running rotation). Attached once; the handler is ref-based so it stays
    // correct. Map gestures fire pointer events through here too.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const onAct = () => {
            // A bare pointermove doesn't interrupt flyTo on its own — if the attract-fly is
            // mid-flight, stop it now so the user immediately takes control.
            if (featuredActiveRef.current) mapRef.current?.stop()
            bumpFeaturedActivity()
        }
        const opts = { passive: true } as AddEventListenerOptions
        el.addEventListener("pointermove", onAct, opts)
        el.addEventListener("pointerdown", onAct, opts)
        el.addEventListener("wheel", onAct, opts)
        el.addEventListener("touchstart", onAct, opts)
        return () => {
            el.removeEventListener("pointermove", onAct)
            el.removeEventListener("pointerdown", onAct)
            el.removeEventListener("wheel", onAct)
            el.removeEventListener("touchstart", onAct)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Cancel all rotation timers on unmount.
    useEffect(() => () => {
        if (featuredIdleTimerRef.current) clearTimeout(featuredIdleTimerRef.current)
        if (featuredCycleTimerRef.current) clearInterval(featuredCycleTimerRef.current)
    }, [])

    function scrollCarouselTo(poiId: string) {
        if (!carouselRef.current) return
        const card = carouselRef.current.querySelector(`[data-poi-id="${poiId}"]`) as HTMLElement
        if (!card) return
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
    }

    // Bring a POI's carousel card into view when its map dot is hovered. Only scrolls if the card
    // isn't already fully visible; then centers it within the track, CLAMPED to the scroll bounds
    // (so the first/last few cards stay flush rather than over-scrolling). Horizontal-only — no
    // scrollIntoView, so the page itself never scrolls.
    function revealCard(poiId: string) {
        const track = carouselRef.current
        if (!track) return
        const card = track.querySelector(`[data-poi-id="${poiId}"]`) as HTMLElement
        if (!card) return   // e.g. a Simple POI dot — no card to reveal
        const tRect = track.getBoundingClientRect()
        const cRect = card.getBoundingClientRect()
        // already fully within the visible strip? leave the scroll alone.
        if (cRect.left >= tRect.left + 1 && cRect.right <= tRect.right - 1) return
        const cardCenter = (cRect.left + cRect.right) / 2 - tRect.left + track.scrollLeft
        const target = Math.max(0, Math.min(cardCenter - track.clientWidth / 2, track.scrollWidth - track.clientWidth))
        track.scrollTo({ left: target, behavior: "smooth" })
    }

    // Recompute which carousel arrows should show. 1px tolerance absorbs sub-pixel
    // rounding so the right arrow hides cleanly at the end of the scroll.
    function updateCarouselArrows() {
        const el = carouselRef.current
        if (!el) return
        setCanScrollLeft(el.scrollLeft > 1)
        setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
    }

    // Scroll the carousel exactly ONE card in the given direction. With scroll-snap
    // mandatory, a fixed-pixel scrollBy fights the snap (it can spring back); instead we
    // scrollIntoView the card adjacent to whichever is currently centered, so it lands
    // cleanly on the next snap point. Same mechanism as scrollCarouselTo.
    function scrollCarousel(dir: "left" | "right") {
        const el = carouselRef.current
        if (!el) return
        const cards = ([...el.querySelectorAll("[data-poi-id]")] as HTMLElement[])
            .filter(c => c.getBoundingClientRect().width > 0)
        if (cards.length === 0) return
        // index of the card whose center is currently nearest the carousel's center
        const center = el.getBoundingClientRect().left + el.clientWidth / 2
        let nearest = 0, best = Infinity
        cards.forEach((c, i) => {
            const r = c.getBoundingClientRect()
            const d = Math.abs(r.left + r.width / 2 - center)
            if (d < best) { best = d; nearest = i }
        })
        const target = Math.max(0, Math.min(cards.length - 1, nearest + (dir === "right" ? 1 : -1)))
        cards[target].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
    }

    /* === RESPONSIVE BREAKPOINT ===
       Derived from the component's own width (containerWidth). Use
       `breakpoint` for switch-style logic, or isSm/isLg for inline
       conditionals, e.g. style={{ padding: isSm ? 16 : 60 }}. */
    const breakpoint: Breakpoint = containerWidth < BREAKPOINT ? "sm" : "lg"
    const isSm = breakpoint === "sm"
    const isLg = breakpoint === "lg"


    // Count of applied filters (park-from-filter + each applied field value) —
    // shown as a prefix on the Filter button on sm, where the chips are hidden.
    const appliedFilterCount =
        (appliedParkSel.allParks ? 0 : appliedParkSel.parks.length) +
        Object.values(appliedFilters).reduce((n, vals) => n + vals.length, 0)

    // Active filter chips render in the top bar only on lg. When they're present they
    // crowd the "View whole necklace" button, so it collapses to icon-only. appliedFilter
    // count > 0 ⇔ at least one chip exists. (lg-only because chips are hidden on sm.)
    const chipsVisible = !isSm && appliedFilterCount > 0
    // The Zoom-Out button is icon-only whenever sm (always — touch has no hover) OR when
    // lg chips crowd it. On lg with chips the collapsed button keeps a fixed 48px layout
    // slot and OVERFLOWS to the right over the chips on reveal (see the absolute wrapper in
    // the render); on sm the label is revealed by a tap for ~1s instead of on hover.
    const zoomIconOnly = isSm || chipsVisible

    // Always use the compact sm-scale POI cards in the carousel — on every
    // breakpoint, and both before AND after the Mapbox map is engaged. (The lg
    // pill cards are no longer used; the small cards stay put through activation.)
    const useSmCards = true
    // Compact 160px-wide cards at rest (more visible per screen).
    const cardWidth = useSmCards ? 160 : Math.min(263, containerWidth - 72)
    // Resting card height, and the size a card grows to while hovered. On hover it pops to
    // CARD_HOVER_W × CARD_HOVER_H, popping OVER its neighbours (the layout slot's WIDTH stays
    // put so nothing shifts sideways; it grows taller by extending UPWARD, bottom-anchored, so
    // the info panel stays put and the photo gets taller).
    const CARD_REST_H = 180
    const CARD_HOVER_W = 200
    const CARD_HOVER_H = 240

    // HOVER-REVEAL: while on the facade and not hovering, hide the Filter/Paths/
    // carousel UI. A small helper builds the style that fades + (after the fade)
    // disables pointer-events via visibility, so hidden controls can't catch clicks.
    const facadeUIHidden = !mapActive && !uiRevealed
    const revealStyle = (hidden: boolean) => ({
        opacity: hidden ? 0 : 1,
        visibility: (hidden ? "hidden" : "visible") as const,
        // fade both ways; delay the visibility flip until after the fade-out
        transition: hidden
            ? "opacity 0.3s ease, visibility 0s linear 0.3s"
            : "opacity 0.3s ease",
    })


    /* FACADE: static map image (Mapbox Static Images API — a separate, much cheaper,
       cacheable SKU). Same style/center/zoom as the live map so the swap is seamless.
       FIXED size per breakpoint (portrait on sm, landscape on lg) so it's fetched at most
       ONCE per breakpoint, NOT on every resize. The <img>'s objectFit:cover handles all
       in-between sizes for free, so no extra API calls happen as the frame resizes. */
    // Paths options: live-detected layers once the map loads, else the static facade
    // fallback (so the dropdown isn't empty before activation).
    const effectiveToggleLayers = Object.keys(toggleLayersByCategory).length > 0
        ? toggleLayersByCategory
        : PATHS_FALLBACK

    const staticStyleId = CONFIG.mapStyle.replace("mapbox://styles/", "")
    // Facade framing — ONE fixed render for EVERY screen size (no sm/lg split), so the facade
    // screenshot never changes with the viewport. Square (1280×1280) + a single zoom keeps it
    // orientation-neutral; the <img>'s objectFit:cover then crops it to whatever container shape
    // it lands in — exactly the same center/zoom the live map opens at (see computeHomeView), so
    // the facade→live swap still doesn't reframe. Centered on the Emerald Necklace.
    const [staticW, staticH] = [1280, 1280]
    const staticCenter: [number, number] = [-71.10, 42.32]
    const staticZoom = 12.5
    // Bump STATIC_MAP_REV after re-publishing the Mapbox style in Studio to force the
    // facade to pull a fresh render (busts the Static Images API / browser cache).
    const STATIC_MAP_REV = 3
    const staticMapUrl =
        `https://api.mapbox.com/styles/v1/${staticStyleId}/static/` +
        `${staticCenter[0]},${staticCenter[1]},${staticZoom}/` +
        `${staticW}x${staticH}@2x?access_token=${CONFIG.mapboxToken}&rev=${STATIC_MAP_REV}`

    /* HOME FRAMING (facade ↔ live map alignment): mirror the current static-image framing params
       so computeHomeView() (which the live map uses for init + every reset-to-home) reproduces
       EXACTLY what the facade shows. computeHomeView reads the live container size for the
       cover-scale, so the swap from facade to live map shows no reframe and the live POI dots
       land precisely where the facade dots were (verified pixel-identical against map.project). */
    facadeParamsRef.current = { staticW, staticH, staticZoom, staticCenter }

    /* FACADE POI DOTS: the static image has no real map features, so we overlay the POI
       dots ourselves. Each lng/lat is projected to a pixel inside the staticW×staticH image
       (Web-Mercator at staticCenter/staticZoom — the same math the live map's SYNC POI SOURCE
       uses), then corrected for the <img>'s objectFit:cover scale + centering so the dot lands
       exactly where it sits on the rendered static map. Recomputed only when the framing or
       container size changes (≈23 POIs, trivial). */
    const facadeDots = useMemo(() => {
        if (pois.length === 0) return [] as { id: string; label: string; x: number; y: number; simple: boolean; diameter: number; hoverDiameter: number; stroke: number }[]
        const worldSize = 512 * Math.pow(2, staticZoom)
        const project = (lng: number, lat: number): [number, number] => {
            const s = Math.sin(lat * Math.PI / 180)
            return [
                (lng + 180) / 360 * worldSize,
                (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize,
            ]
        }
        const [cx, cy] = project(staticCenter[0], staticCenter[1])
        // objectFit:cover transform: scale the staticW×staticH image to cover the container,
        // then center it (negative offset = the cropped overflow on the larger axis).
        // Read the LIVE container size (same source computeHomeView uses for the live map), so
        // the facade dots stay consistent with the engaged map even if a ResizeObserver state
        // update is still pending. containerWidth/Height remain memo deps to trigger recompute.
        const el = containerRef.current
        const cw = el ? el.clientWidth : containerWidth
        const ch = el ? el.clientHeight : containerHeight
        const scale = Math.max(cw / staticW, ch / staticH)
        const offX = (cw - staticW * scale) / 2
        const offY = (ch - staticH * scale) / 2
        // Dot SIZE: match the engaged map exactly. The live map rests at this effective ("home")
        // zoom after the swap, so size each dot to the live poi-dot radius + stroke at that zoom.
        // Outer diameter = 2·(radius + stroke); with box-sizing:border-box the border is the ring.
        const effZoom = staticZoom + Math.log2(scale)
        const sizeFor = (simple: boolean) => {
            const stroke = liveDotStroke(simple)
            return {
                diameter: 2 * (liveDotRadius(effZoom, simple) + stroke),
                hoverDiameter: 2 * (liveDotHoverRadius(effZoom) + stroke),   // grown size on hover (matches live)
                stroke,
            }
        }
        const sz = { false: sizeFor(false), true: sizeFor(true) }
        const base = pois.map(poi => {
            const [px, py] = project(poi.longitude, poi.latitude)
            const simple = isSimplePOI(poi)
            return {
                id: poi.id,
                label: poi.name,
                x: (px - cx + staticW / 2) * scale + offX,
                y: (py - cy + staticH / 2) * scale + offY,
                simple,
                diameter: sz[`${simple}`].diameter,
                hoverDiameter: sz[`${simple}`].hoverDiameter,
                stroke: sz[`${simple}`].stroke,
            }
        })
        // PARSE timing: rank each dot per FACADE_DOT_PARSE.mode. loop / duration / stagger also
        // come from FACADE_DOT_PARSE.
        const P = FACADE_DOT_PARSE
        const n = base.length
        const ranks = computeParseRanks(base, cw, ch, P.mode)
        return base.map((d, i) => {
            let parseDelay: number
            if (P.loop) {
                // Loop: give each dot a PHASE in [0,1) within the cycle, then use a NEGATIVE
                // delay so it starts already mid-cycle → no initial parse-in, organic from
                // frame one. "random" → scattered phase per id; ordered modes → phase by rank.
                // For ordered modes the phase is REVERSED (1 - rank/n): with a negative delay the
                // travelling pulse sweeps in DECREASING-phase order, so reversing makes it run in
                // INCREASING-rank order — i.e. rank 0 leads (top → bottom = Charlesgate → Franklin Park).
                const phase = P.mode === "simultaneous" ? 0
                    : P.mode === "random" ? ((hashStringToInt(d.id) >>> 0) % 1000) / 1000
                    : 1 - ranks[i] / Math.max(1, n)
                parseDelay = -(phase * P.duration)
            } else {
                // One-shot reveal: positive staggered delay in the chosen order.
                parseDelay = P.startDelay + (P.stagger > 0 ? ranks[i] * P.stagger : 0)
            }
            return { ...d, parseDelay }
        })
    }, [pois, staticZoom, staticW, staticH, containerWidth, containerHeight, staticCenter[0], staticCenter[1]])

    /* === SECTION: FACADE TAG TRACKING ===
       Mirror the engaged map's positionTag rAF on the facade: while a facade dot is hovered, read its
       CURRENT (CSS-animating) radius every frame and keep the pill flush against the GROWING edge —
       so the label eases outward in lockstep with the dot, exactly like the live map (instead of
       jumping straight to the final-size offset). Positions before first paint (useLayoutEffect), then
       self-perpetuates until the grow settles, then stops. The pill flips to the dot's left near the
       right container edge, same as the engaged tag. */
    React.useLayoutEffect(() => {
        if (mapActive || selectedId || !hoveredCardId) return
        const d = facadeDots.find(x => x.id === hoveredCardId)
        if (!d) return
        const root = containerRef.current
        let lastR = -1, settled = 0
        const frame = () => {
            const el = facadeTagRef.current
            const dotEl = root?.querySelector(`[data-fdot-id="${CSS.escape(d.id)}"]`) as HTMLElement | null
            if (el && dotEl) {
                // Track the dot's RENDERED edge (getBoundingClientRect, post-transform) so the pill is
                // flush with what the user actually sees. Re-read every frame, so any transient (e.g. a
                // hover landing mid-pulse) self-corrects on the next frame. (offsetWidth — the layout
                // edge — was tried but diverges from the visual edge by ~4px whenever the dot is scaled,
                // breaking the flush; verified flush every frame with getBoundingClientRect.)
                const r = dotEl.getBoundingClientRect().width / 2
                const cw = root?.clientWidth ?? containerWidth
                const estTagWidth = d.label.length * 8 + 24
                const placeLeft = d.x + r + estTagWidth > cw - 8
                el.style.left = (d.x + (placeLeft ? -r : r)) + "px"
                el.style.top = d.y + "px"
                el.style.transform = placeLeft ? "translate(-100%, -50%)" : "translateY(-50%)"
                settled = Math.abs(r - lastR) < 0.05 ? settled + 1 : 0
                lastR = r
            }
            facadeTagRafRef.current = settled < 3 ? requestAnimationFrame(frame) : 0   // stop once the grow settles
        }
        frame()
        return () => { if (facadeTagRafRef.current) { cancelAnimationFrame(facadeTagRafRef.current); facadeTagRafRef.current = 0 } }
    }, [hoveredCardId, mapActive, selectedId, facadeDots, containerWidth])

    /* ============================================================
       RENDER
       ============================================================ */
    return (
        <div
            ref={containerRef}
            // HOVER-REVEAL: hovering anywhere in the map area brings the UI back
            // (only matters on the facade; once the map is active it's always shown).
            // Reveal is instant; hiding waits HIDE_DELAY_MS after the cursor leaves.
            onMouseEnter={() => {
                if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
                setUiRevealed(true)
            }}
            onMouseLeave={() => {
                if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
                hideTimerRef.current = setTimeout(() => setUiRevealed(false), HIDE_DELAY_MS)
            }}
            style={{
                width: "100%", height: "100%", minHeight: 400,
                position: "relative", overflow: "hidden",
                background: C.lemna,
            }}
        >
            {/* ===== MAP CANVAS ===== */}
            <div ref={mapContainer} style={{ position: "absolute", inset: 0 }} />

            {/* FACADE FRAME: a 2px willow (Salix) border framing the whole map while it's
                in the static, pre-interactive state. Fades out over 0.6s the moment the user
                engages (mapActive). Its own overlay div (not a border on the container) so the
                opacity can animate cleanly; pointerEvents none so it never blocks interaction. */}
            <div style={{
                position: "absolute", inset: 0,
                border: `2px solid ${C.salix}`,
                boxSizing: "border-box",
                pointerEvents: "none",
                zIndex: 6,
                opacity: mapActive ? 0 : 1,
                transition: "opacity 0.6s ease",
            }} />

            {/* TEMP/DEBUG: live zoom readout, pinned top-center (see SHOW_ZOOM_DEBUG). */}
            {SHOW_ZOOM_DEBUG && liveZoom !== null && (
                <div style={{
                    position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                    zIndex: 9999, pointerEvents: "none",
                    background: "rgba(16,26,12,0.85)", color: C.cygnus,
                    font: "500 12px/1 'IBM Plex Mono', monospace",
                    padding: "6px 10px", borderRadius: 6, letterSpacing: "0.02em",
                }}>
                    zoom {liveZoom.toFixed(2)}
                </div>
            )}

            {/* FACADE: static map image over the (empty) map canvas. Click anywhere to
                activate the live map. Stays until the live map has loaded, then fades out.
                zIndex 1 = above the map canvas, below all the UI (carousel, filter, etc.). */}
            <img
                src={staticMapUrl}
                alt="Map"
                onClick={() => setMapActive(true)}
                draggable={false}
                style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%",
                    objectFit: "cover", display: "block",
                    zIndex: 1,
                    cursor: mapActive ? "default" : "pointer",
                    opacity: (mapLoaded && minLoadElapsed) ? 0 : 1,
                    pointerEvents: mapActive ? "none" : "auto",
                    transition: "opacity 0.45s ease",
                }}
            />
            {/* FACADE POI DOTS — HTML overlay over the static image, positioned to match where
                the live map draws them (see facadeDots projection above). Sits at zIndex 2:
                above the static image (1), below the CTA (3). Fades out in sync with the static
                image once the live map (with its own real dots) is ready. pointerEvents none so a
                click still falls through to the image and activates the map. Styling mirrors the
                live poi-dot paint: Simple = lemna fill + salix ring; Full = salix fill + lemna ring. */}
            {facadeDots.length > 0 && (
                <div style={{
                    position: "absolute", inset: 0, zIndex: 2,
                    pointerEvents: "none",
                    opacity: (mapLoaded && minLoadElapsed) ? 0 : 1,
                    transition: "opacity 0.45s ease",
                }}>
                    {/* PARSE animation keyframes. `…ParseIn` = one-shot pop-in reveal (loop:false);
                        `…Pulse` = a breathing loop (loop:true). Per-dot animation-delay (computed
                        in facadeDots) staggers them into a ripple. transform-origin is the dot
                        center, so the scale reads as a clean pop. */}
                    <style>{`
@keyframes facadeDotParseIn {
  0%   { transform: scale(0);    opacity: 0; }
  55%  { transform: scale(1.18); opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
@keyframes facadeDotPulse {
  0%, 30%, 100% { transform: scale(1); }
  15%           { transform: scale(1.34); }
}
`}</style>
                    {facadeDots.map(d => {
                        const anim = FACADE_DOT_PARSE.enabled ? {
                            animationName: FACADE_DOT_PARSE.loop ? "facadeDotPulse" : "facadeDotParseIn",
                            animationDuration: `${FACADE_DOT_PARSE.duration}ms`,
                            animationDelay: `${d.parseDelay}ms`,
                            animationTimingFunction: FACADE_DOT_PARSE.easing,
                            animationIterationCount: FACADE_DOT_PARSE.loop ? ("infinite" as const) : 1,
                            // `both` holds the 0% frame during the delay (dots stay hidden until
                            // their turn) and the 100% frame after (so a one-shot reveal stays put).
                            animationFillMode: "both" as const,
                        } : {}
                        // Hovered (its own dot OR its carousel card) → grow to the live hover
                        // size, lift above neighbours, and pause the pulse — mirroring the live map.
                        const hov = hoveredCardId === d.id
                        const dia = hov ? d.hoverDiameter : d.diameter
                        return (
                            <div
                                key={d.id}
                                data-fdot-id={d.id}   // looked up by the FACADE TAG TRACKING effect to read this dot's live radius
                                // Facade interactivity: hover drives the SHARED hoveredCardId so the
                                // matching card grows+inverts and scrolls in (revealCard), and this dot
                                // grows + shows its tag — the same interconnect the live map has.
                                onMouseEnter={mapActive ? undefined : () => {
                                    // Cancel any pending buffered leave (we're (re)entering a dot).
                                    if (dotHoverClearRef.current) { clearTimeout(dotHoverClearRef.current); dotHoverClearRef.current = null }
                                    setHoveredCardId(d.id); revealCard(d.id)
                                }}
                                onMouseLeave={mapActive ? undefined : () => {
                                    // Buffer the clear. The idle pulse scales the dot's hit-area, and on hover
                                    // the pulse is dropped (transform snaps back) — both briefly move the dot's
                                    // edge across a stationary cursor, firing leave→enter. Deferring the clear
                                    // (cancelled by the re-enter as the dot grows under the cursor) kills the flicker.
                                    if (dotHoverClearRef.current) clearTimeout(dotHoverClearRef.current)
                                    dotHoverClearRef.current = setTimeout(() => {
                                        dotHoverClearRef.current = null
                                        setHoveredCardId(prev => (prev === d.id ? "" : prev))
                                    }, HOVER_LEAVE_BUFFER_MS)
                                }}
                                onClick={mapActive ? undefined : () => { setSelectedId(d.id); setMapActive(true) }}
                                style={{
                                position: "absolute",
                                left: d.x, top: d.y,
                                width: dia, height: dia,
                                marginLeft: -dia / 2, marginTop: -dia / 2,
                                borderRadius: "50%",
                                boxSizing: "border-box",
                                // Match the live poi-dot fill/border: Simple = lemna fill + salix ring;
                                // Full = salix fill + lemna ring.
                                background: d.simple ? C.lemna : C.salix,
                                border: `${d.stroke}px solid ${d.simple ? C.salix : C.lemna}`,
                                pointerEvents: mapActive ? "none" : "auto",
                                cursor: "pointer",
                                zIndex: hov ? 1 : 0,
                                // 200ms easeInOutQuad (cubic-bezier ≈), matching the engaged dot's
                                // animateHoverT grow/shrink. CSS reverses from the current value on leave.
                                transition: "width 0.2s cubic-bezier(0.45,0,0.55,1), height 0.2s cubic-bezier(0.45,0,0.55,1), margin 0.2s cubic-bezier(0.45,0,0.55,1)",
                                // Pulse while idle; drop it while hovered (live dots stop pulsing on hover).
                                ...(hov ? {} : anim),
                            }} />
                        )
                    })}
                </div>
            )}

            {/* FACADE HOVER TAG — same pill as the live hover tag, but positioned from the facade
                dot's screen coords (no live map to project from). Driven by the SHARED hoveredCardId,
                so it shows whether you hover the dot OR its carousel card. */}
            {!mapActive && !selectedId && hoveredCardId && (() => {
                const d = facadeDots.find(x => x.id === hoveredCardId)
                if (!d) return null
                return (
                    <div ref={facadeTagRef} style={{
                        // left / top / transform are driven imperatively by the FACADE TAG TRACKING
                        // effect each frame (flush against the dot's GROWING edge) — NOT set here, so
                        // a React re-render can't snap the pill back to a static offset mid-track.
                        position: "absolute",
                        zIndex: 4, pointerEvents: "none",
                        opacity: (mapLoaded && minLoadElapsed) ? 0 : 1,
                        transition: "opacity 0.45s ease",
                        padding: "5px 12px", borderRadius: 100,
                        background: d.simple ? C.lemna : C.salix,
                        border: d.simple ? `1px solid ${C.salix}` : "none",
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: 12, fontWeight: 500,
                        textTransform: "uppercase", color: d.simple ? C.salix : C.cygnus,
                        whiteSpace: "nowrap", lineHeight: 1.4,
                    }}>
                        {d.label}
                    </div>
                )
            })()}

            {/* ════════ CENTER CTA ════════
                Explicit, sequenced transition driven by `ctaPhase` (see the effect above),
                so the steps are deliberate and never rely on framer `layout` (which warped
                the pill into ellipses — the "shape kick") or `popLayout` (which flung the
                icon off-screen):
                  1. facade     → [ map-icon chip · "Explore Map" ]  (full pill)
                  2. collapsing → both collapse together (grid 1fr→0fr); pill → 72px circle
                  3/4. loading  → loading segment expands (0fr→1fr); "Finding …" slides up
                  5. dismiss    → outer AnimatePresence fades the whole CTA out on map-ready
                Width is animated purely by CSS grid-template-columns (the same collapse
                trick the Paths dropdown uses), so the rounded caps never distort. */}
            <AnimatePresence>
                {!(mapLoaded && minLoadElapsed) && (
                    <motion.div
                        key="center-cta"
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        style={{
                            position: "absolute", inset: 0, zIndex: 3,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            pointerEvents: "none",
                            // Query container so the CTA can scale to the REAL container width via
                            // cqw units — independent of the JS ResizeObserver (which can lag in
                            // some embeds). See the .cta-resp rules below.
                            containerType: "inline-size",
                        }}
                    >
                        {/* RESPONSIVE CTA SCALE (pure CSS, robust). lg (container >= 740px): scale 1,
                            unchanged. sm (< 740px): scale the pill down ONLY enough to fit THIS
                            message — (100cqw - 48px) is the available width (24px breathing room each
                            side), var(--cta-content) is the current pill's own width (set inline per
                            phase/message). So the message can never clip AND a short message stays as
                            large as it fits. Floored at 0.3. cqw + the var both track real layout, so
                            it's immune to ResizeObserver lag. */}
                        <style>{`
.cta-resp { transform: scale(clamp(0.3, calc((100cqw - 48px) / var(--cta-content, 480px)), 1)); transform-origin: center center; }
@container (min-width: 740px) { .cta-resp { transform: none; } }
`}</style>
                        <button
                            className="cta-resp"
                            onClick={mapActive ? undefined : () => setMapActive(true)}
                            onMouseEnter={() => { if (!mapActive) setExploreHover(true) }}
                            onMouseLeave={() => setExploreHover(false)}
                            aria-label={mapActive ? "Loading map" : "Explore map"}
                            style={{
                                position: "relative",
                                pointerEvents: mapActive ? "none" : "auto",
                                // transform (responsive scale) comes from the .cta-resp class above
                                // (cqw-based). maxWidth is intentionally NOT set — the scale, not a
                                // clip, keeps the pill in bounds.
                                // --cta-content tells that scale the CURRENT pill width, so on sm it
                                // shrinks each message only as much as ITS OWN width needs (a short
                                // message isn't punished by the longest one). Same value as width.
                                ["--cta-content" as any]: `${ctaPhase === "facade" ? ctaFacadeW : ctaPhase === "collapsing" ? 72 : ctaLoadingW}px`,
                                // Explicit measured width per phase → tweened as a REAL css width
                                // (no layout scale, so the rounded caps never distort). Collapsing
                                // forces the 72px circle between the two content widths.
                                width: ctaPhase === "facade" ? ctaFacadeW
                                     : ctaPhase === "collapsing" ? 72 : ctaLoadingW,
                                // GUARANTEE the pill contains its text WITHOUT trusting any JS
                                // measurement: in steady loading, min-width:max-content forces the
                                // pill at least as wide as the in-flow sizer below (a real copy of the
                                // message). So even if `width` (measured) is wrong, the text can't
                                // clip — the pill just grows, even past the screen padding if needed.
                                // Stays 72 during the morph so the collapse-to-circle still works.
                                height: 72,
                                minWidth: (ctaPhase === "loading" && !ctaMorphing) ? "max-content" : 72,
                                boxSizing: "border-box",
                                borderRadius: (exploreHover && !mapActive) ? 20 : 36,
                                background: C.salix,             // willow (Salix) green fill
                                border: `1px solid ${C.cygnus}`, // Cygnus border
                                cursor: mapActive ? "default" : "pointer",
                                // Visible in the facade so the icon chip can overlap (merge with)
                                // the pill's border; hidden once we leave the facade to clip the
                                // collapsing/expanding content (the icon has faded out by then).
                                overflow: ctaPhase === "facade" ? "visible" : "hidden",
                                padding: 0,
                                font: "500 26px/1.3 'IBM Plex Sans', sans-serif",
                                color: C.cygnus,
                                letterSpacing: "0.02em",
                                textTransform: mapActive ? "none" : "uppercase",
                                textAlign: "center",
                                // width + transform (scale) tween only during a phase morph; on a
                                // message rotation they SNAP (ctaMorphing false) so the pill is sized
                                // before the words slide up — no transient clip. border-radius always
                                // eases (hover squircle).
                                transition: `width ${ctaMorphing ? "0.38s cubic-bezier(0.4,0,0.2,1)" : "0s"}, border-radius 0.2s ease-in-out, transform ${ctaMorphing ? "0.38s cubic-bezier(0.4,0,0.2,1)" : "0s"}`,
                            }}
                        >
                            {/* WIDTH SIZER — the ONLY in-flow child, so it (not a JS measurement)
                                drives the pill's max-content width. It's a real copy of the loading
                                message at the same font/case, invisible and zero-height so it adds no
                                visible layout. Extra horizontal padding (vs the visible 28px) gives a
                                few px of slack, so min-width:max-content keeps the pill a touch wider
                                than the text — the words can never reach the rounded caps. */}
                            <span aria-hidden style={{
                                display: "block", height: 0, overflow: "hidden", visibility: "hidden",
                                whiteSpace: "nowrap", padding: "0 34px", pointerEvents: "none",
                            }}>{status === "error" ? `⚠️ ${errorMsg}` : `Finding ${loadingCritter}`}</span>
                            {/* STEP 1–2 · FACADE — map-icon chip + "Explore Map". Absolutely
                                positioned (so it never re-flows or flies off) and left-anchored so
                                the icon stays put; fades out as the pill collapses to its circle. */}
                            <div ref={ctaFacadeRef} aria-hidden={mapActive} style={{
                                position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                                display: "flex", alignItems: "center", whiteSpace: "nowrap",
                                opacity: ctaPhase === "facade" ? 1 : 0,
                                transition: "opacity 0.22s ease",
                                pointerEvents: "none",
                            }}>
                                {/* map-icon chip — circular willow fill + Cygnus border. Sized to
                                    the button's OUTER height (72) and pulled out by -1px so its
                                    border coincides with the pill's border instead of sitting 1px
                                    inside it (which read as a doubled border). The button is
                                    overflow:visible in the facade so this overlap shows. */}
                                <div style={{
                                    width: 72, height: 72, flexShrink: 0, boxSizing: "border-box",
                                    marginLeft: -1,   // overlap the pill's left border (merge, don't double)
                                    borderRadius: (exploreHover && !mapActive) ? 20 : 36,
                                    background: C.salix, border: `1px solid ${C.cygnus}`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    transition: "border-radius 0.2s ease-in-out",
                                }}>
                                    {/* iconoir: map — 1px stroke to match the other icons */}
                                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                                        <path
                                            d="M9 17.485L3 21V6.515L9 3M9 17.485L15 21M9 17.485V3M15 21L21 17.485V3L15 6.515M15 21V6.515M15 6.515L9 3"
                                            stroke={C.cygnus} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
                                        />
                                    </svg>
                                </div>
                                <span style={{ whiteSpace: "nowrap", padding: "0 28px 0 18px" }}>Explore Map</span>
                            </div>

                            {/* STEP 3–4 · LOADING — same absolute anchor; fades in once the pill has
                                re-expanded, then "Finding {critter}…" slides up segment by segment. */}
                            <div ref={ctaLoadingRef} style={{
                                position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                                whiteSpace: "nowrap", padding: "0 28px",
                                opacity: ctaPhase === "loading" ? 1 : 0,
                                transition: "opacity 0.25s ease",
                                pointerEvents: "none",
                            }}>
                                {status === "error" ? `⚠️ ${errorMsg}` : (() => {
                                    // Split "a pond-skimming dragonfly" → ["Finding",
                                    // "a pond-skimming", "dragonfly"]. Each segment sits in a clip
                                    // wrapper and slides up once revealStep reaches its index.
                                    const w = loadingCritter.split(" ")
                                    const segments = ["Finding", w.slice(0, 2).join(" "), w.slice(2).join(" ")]
                                    return (
                                        <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", gap: "0.32em" }}>
                                            {segments.map((text, i) => (
                                                <span key={i} style={{ display: "inline-block", overflow: "hidden", height: "1.4em", lineHeight: "1.4em" }}>
                                                    <span style={{
                                                        display: "inline-block", lineHeight: "1.4em",
                                                        transform: revealStep > i ? "translateY(0)" : "translateY(115%)",
                                                        transition: "transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)",
                                                    }}>
                                                        {text}
                                                    </span>
                                                </span>
                                            ))}
                                        </span>
                                    )
                                })()}
                            </div>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* DEBUG: faint tint over the gesture dead zone(s); gestures are live in the
                clear band. pointer-events:none so it never interferes. Off in production
                (SHOW_GESTURE_ZONE_DEBUG). */}
            {SHOW_GESTURE_ZONE_DEBUG && (
                <>
                    {(["top", "bottom"] as const)
                        .filter(edge => (edge === "top" ? GESTURE_DEAD_TOP_VH : GESTURE_DEAD_BOTTOM_VH) > 0)
                        .map(edge => (
                        <div key={edge} style={{
                            position: "fixed", left: 0, right: 0, [edge]: 0,
                            height: `${Math.round((edge === "top" ? GESTURE_DEAD_TOP_VH : GESTURE_DEAD_BOTTOM_VH) * 100)}vh`,
                            background: "rgba(31,47,22,0.12)",
                            borderBottom: edge === "top" ? `1px dashed ${C.salix}` : undefined,
                            borderTop: edge === "bottom" ? `1px dashed ${C.salix}` : undefined,
                            zIndex: 9, pointerEvents: "none",
                            display: "flex", alignItems: edge === "top" ? "flex-end" : "flex-start",
                            justifyContent: "center",
                        }}>
                            <span style={{
                                fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 500,
                                color: C.salix, padding: 6, opacity: 0.7,
                            }}>
                                no map gestures
                            </span>
                        </div>
                    ))}
                </>
            )}

            {/* (Loading / error message now lives in the CENTER CTA above —
                "Explore Map" morphs into "Finding {critter}…".) */}



            {/* HOVER TAG — appears beside the hovered dot (vertically centred), with NO appearance
                animation. Side flips to avoid clipping: placed to the RIGHT by default, but to the
                LEFT when the right placement would run off the container's right edge (so a dot near
                the left edge gets the tag on its right, a dot near the right edge gets it on the left). */}
            {hoveredPin && !selectedId && (() => {
                // left/top/transform below are a sensible INITIAL only — positionTag() (rAF +
                // useLayoutEffect) immediately drives the real position so the tag stays flush
                // against the dot's edge at any zoom and during the hover-grow/zoom/pan.
                const GAP = liveDotHoverRadius(mapRef.current?.getZoom?.() ?? 14)
                const estTagWidth = hoveredPin.label.length * 8 + 24   // overestimate so we flip before clipping
                const placeLeft = hoveredPin.x + GAP + estTagWidth > containerWidth - 8
                return (
                    <div ref={tagElRef} style={{
                        position: "absolute",
                        left: hoveredPin.x + (placeLeft ? -GAP : GAP),
                        top: hoveredPin.y,
                        transform: placeLeft ? "translate(-100%, -50%)" : "translateY(-50%)",
                        zIndex: 2,
                        pointerEvents: "none",
                        // Pill shaped, styled like the Simple POI hover dot: lemna fill + 1px salix
                        // ring. Text is salix (static) for contrast against the light lemna fill.
                        padding: "5px 12px",
                        borderRadius: 100,
                        background: hoveredPin.simple ? C.lemna : C.salix,
                        border: hoveredPin.simple ? `1px solid ${C.salix}` : "none",
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: 12, fontWeight: 500,
                        textTransform: "uppercase", color: hoveredPin.simple ? C.salix : C.cygnus,
                        whiteSpace: "nowrap",
                        lineHeight: 1.4,
                    }}>
                        {hoveredPin.label}
                    </div>
                )
            })()}


            {/* ===== FILTER BUTTON + ACTIVE FILTER CHIPS — top left ===== */}
            <div style={{
                position: "absolute", top: 24, left: 24, right: 24, zIndex: 5,
                display: "flex", alignItems: "flex-start", gap: 8,
                pointerEvents: "none",
                ...revealStyle(facadeUIHidden),
            }}>
                {/* alignItems:flex-start so each button hugs its OWN content width — without it
                    the column stretches both to the wider one (FILTER would match ZOOM OUT). */}
                {/* position/zIndex so the Zoom-Out button's hover-reveal paints ABOVE the
                    sibling chips when it overflows to the right. */}
                <div style={{ pointerEvents: "auto", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, position: "relative", zIndex: 1 }}>
                    {/* On sm the open Paths dropdown (220px, top-right) would collide with
                        the Filter label — collapse Filter (and Zoom Out) to icon-only while open. */}
                    <FilterButton onClick={openFilters} count={isSm ? appliedFilterCount : 0} iconOnly={isSm && pathsOpen} />
                    {/* "View whole necklace" — appears under Filter when the user has strayed from
                        the home framing: zoomed IN past ZOOM_OUT_MIN_ZOOM, zoomed OUT below
                        VIEW_NECKLACE_BELOW_ZOOM, or the necklace panned fully out of frame. Returns home. */}
                    <AnimatePresence>
                        {liveZoom != null && (liveZoom > ZOOM_OUT_MIN_ZOOM || liveZoom < VIEW_NECKLACE_BELOW_ZOOM || necklaceOutOfFrame) && (
                            <motion.div
                                key="zoom-out-btn"
                                initial={{ opacity: 0, y: -8, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -8, scale: 0.9 }}
                                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                // With lg chips present, this stays a fixed 48px icon slot so the
                                // column doesn't widen; the button (absolute below) overflows it
                                // over the chips on reveal. (sm has no chips, so no slot — the
                                // tapped label just expands the button in normal flow.)
                                style={{ transformOrigin: "top center", ...(chipsVisible ? { position: "relative", width: 48, height: 48 } : {}) }}
                            >
                                {/* Absolute (lg + chips) → the reveal overflows the 48px slot over
                                    the chips instead of pushing the layout. The wrapper shrink-wraps
                                    the button, so its width follows the reveal. */}
                                <div style={chipsVisible ? { position: "absolute", top: 0, left: 0, zIndex: 2 } : undefined}>
                                    <ZoomOutButton onClick={goHome} iconOnly={zoomIconOnly} tapReveal={isSm} />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {(() => {
                    // sm: filters are summarized on the Filter button instead of chips.
                    if (isSm) return null
                    const chips: { label: string; onRemove: () => void }[] = []
                    // Park chip: 1 park → its name; 2+ → "N Parks"; all parks (EN) → no chip.
                    // Removing it returns to the Emerald Necklace (all-parks) default.
                    if (!appliedParkSel.allParks && appliedParkSel.parks.length >= 1) {
                        const n = appliedParkSel.parks.length
                        chips.push({
                            label: n === 1 ? appliedParkSel.parks[0] : `${n} Parks`,
                            onRemove: () => {
                                setAppliedParkSel(DEFAULT_PARK_SELECTION)
                                isProgrammaticMoveRef.current = true
                                { const h = computeHomeView(); mapRef.current?.flyTo({ center: h.center, zoom: h.zoom, duration: 800 }) }
                            },
                        })
                    }
                    Object.entries(appliedFilters).forEach(([, vals]) =>
                        vals.forEach(v => chips.push({
                            label: v,
                            onRemove: () => setAppliedFilters(prev => {
                                const updated = { ...prev }
                                Object.keys(updated).forEach(k => { updated[k] = updated[k].filter(x => x !== v) })
                                return updated
                            }),
                        }))
                    )
                    if (chips.length === 0) return null
                    return (
                        <div style={{
                            display: "flex", flexWrap: "wrap", gap: 8,
                            pointerEvents: "auto",
                            // Cap the chip area so it wraps before reaching the Paths button
                            // (top-right). Reserves for the Paths button's OPEN width (~220px)
                            // plus the Filter button + margins, so chips clear it even when open.
                            maxWidth: "calc(100vw - 420px)",
                        }}>
                            {chips.map((chip, i) => (
                                <div key={i} style={{
                                    display: "flex", alignItems: "center",
                                    height: 48,
                                    background: C.cygnus,
                                    border: `1px solid ${C.salix}`,
                                    borderRadius: 100,
                                    flexShrink: 0,
                                }}>
                                    <ChipRemoveButton onRemove={chip.onRemove} size={48} />
                                    <span style={{
                                        fontFamily: "'IBM Plex Mono', monospace",
                                        fontSize: 13, fontWeight: 500, color: C.salix,
                                        // × on the LEFT now: 12 gap from the button, 20 clears the
                                        // rounded right cap (mirror of the old 20-left / 12-right).
                                        paddingLeft: 12, paddingRight: 20,
                                        whiteSpace: "nowrap",
                                    }}>
                                        {chip.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )
                })()}
            </div>

            {/* ===== PATHS BUTTON + DROPDOWN — top right ===== */}
            <div style={{ position: "absolute", top: 24, right: 24, zIndex: 5, pointerEvents: "auto", ...revealStyle(facadeUIHidden) }}>
                {/* The button IS the panel: width grows (closed pill → open panel) and height
                    grows (grid 0fr→1fr) to reveal the options. Right-anchored, so it expands
                    leftward + downward. */}
                <div style={{
                    width: pathsOpen ? 220 : 122,   // closed ≈ "Paths" pill · open ≈ panel
                    background: C.cygnus,
                    border: `1px solid ${C.salix}`,
                    borderRadius: 36,
                    overflow: "hidden",
                    transition: "width 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
                    display: "flex", flexDirection: "column",
                }}>
                    {/* Header = the toggle (icon + Paths). Opening it activates the live map
                        so it's loaded (with the real layer list) by the time you pick a path. */}
                    <button
                        onClick={() => { setPathsOpen(o => !o); setMapActive(true) }}
                        aria-label="Paths"
                        onMouseOver={(e) => (e.currentTarget.style.background = C.cygnusHover)}
                        onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                        style={{
                            flexShrink: 0, height: 48, width: "100%",
                            background: "transparent", border: "none", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "0 24px 0 20px", whiteSpace: "nowrap",
                            transition: "background 0.15s ease",
                        }}
                    >
                        {/* lucide: layers-2 — 1px stroke */}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.salix} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="m16.02 12 5.48 3.13a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74L7.98 12" />
                            <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z" />
                        </svg>
                        <span style={{ font: "500 14px/1 'IBM Plex Sans', sans-serif", color: C.salix, letterSpacing: "0.02em", textTransform: "uppercase" }}>Paths</span>
                    </button>

                    {/* Options — height reveal (grid 0fr→1fr); fade in after the box expands */}
                    <div style={{
                        display: "grid",
                        gridTemplateRows: pathsOpen ? "1fr" : "0fr",
                        transition: "grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}>
                        <div style={{ overflow: "hidden" }}>
                            <div style={{
                                padding: "0 20px 8px 20px",
                                opacity: pathsOpen ? 1 : 0,
                                transition: pathsOpen ? "opacity 0.2s ease 0.16s" : "opacity 0.1s ease",
                            }}>
                                {/* The existing Toggle- layers, wired to the shared layerToggles state.
                                    Radio-circle visual but independent — any combination can be on. */}
                                {(() => {
                                    // effectiveToggleLayers = live layers once loaded, else the facade fallback.
                                    const items = Object.entries(effectiveToggleLayers)
                                        .flatMap(([cat, names]) => names.map(name => ({ key: `${cat}--${name}`, name })))
                                    if (items.length === 0) return (
                                        <div style={{
                                            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14,
                                            color: C.disabled, padding: "8px 0", whiteSpace: "nowrap",
                                        }}>No path layers</div>
                                    )
                                    return items.map(({ key, name }) => (
                                        <FilterItem
                                            key={key}
                                            label={name}
                                            selected={layerToggles[key] === true}
                                            // Part 2: toggling a path is a meaningful interaction → activate
                                            // the live map so the layer actually renders.
                                            onToggle={() => {
                                                setLayerToggles(prev => ({ ...prev, [key]: !prev[key] }))
                                                setMapActive(true)
                                            }}
                                        />
                                    ))
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Click-away backdrop — closes the Paths dropdown */}
            {pathsOpen && (
                <div onClick={() => setPathsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 4 }} />
            )}

            {/* ===== CAROUSEL — hidden when a POI is selected OR the filter panel is open ===== */}
            {pois.length > 0 && (
                <div style={{
                    position: "absolute", bottom: 24, left: 0, right: 0, zIndex: 2,
                    // fade only; individual cards do their own staggered slide-up below.
                    // Hidden on the facade until the map area is hovered (hover-reveal), and
                    // hidden entirely while the filter panel is open (filtersOpen).
                    opacity: (carouselReady && !selectedId && !facadeUIHidden && !filtersOpen) ? 1 : 0,
                    visibility: ((facadeUIHidden || filtersOpen) ? "hidden" : "visible") as const,
                    transition: (facadeUIHidden || filtersOpen)
                        ? "opacity 0.3s ease, visibility 0s linear 0.3s"
                        : "opacity 0.5s ease",
                    pointerEvents: "none", // never block map clicks — inner scroll track opts back in
                }}>
                    {/* Scroll track. pointer-events: auto so TOUCH gestures can scroll it
                        (with pointer-events:none, mobile drags fell through to the map and the
                        carousel couldn't be scrolled). touch-action: pan-x → horizontal drags
                        scroll the carousel while vertical drags still pan the page. */}
                    <div
                        ref={carouselRef}
                        onScroll={updateCarouselArrows}
                        style={{
                            display: "flex", flexDirection: "row",
                            // Bottom-anchor cards so a hovered card grows UPWARD (photo gets taller,
                            // info panel stays put) and resting cards don't shift.
                            alignItems: "flex-end",
                            overflowX: "auto",
                            padding: "0 24px",
                            scrollSnapType: "x mandatory",
                            msOverflowStyle: "none" as any,
                            scrollbarWidth: "none" as any,
                            pointerEvents: "auto",
                            touchAction: "pan-x",
                            WebkitOverflowScrolling: "touch" as any,   // iOS momentum
                            userSelect: "none",
                        }}
                        onMouseMove={e => {
                            if (!dragRef.current.active) return
                            const dx = e.pageX - dragRef.current.startX
                            if (Math.abs(dx) > 4) dragRef.current.moved = true
                            carouselRef.current!.scrollLeft = dragRef.current.scrollLeft - dx
                        }}
                        onMouseUp={() => {
                            dragRef.current.active = false
                            const c = carouselRef.current!
                            c.style.scrollSnapType = "x mandatory"
                        }}
                        onMouseLeave={() => {
                            if (!dragRef.current.active) return
                            dragRef.current.active = false
                            carouselRef.current!.style.scrollSnapType = "x mandatory"
                        }}
                    >
                        {pois.filter(p => !isSimplePOI(p)).map((poi, i) => {
                            const visible = carouselPOIs.includes(poi) && carouselReady && !selectedId
                            const grown = visible && hoveredCardId === poi.id
                            return (
                                <div key={poi.id} style={{
                                    flexShrink: 0,
                                    // POP-OVER hover: the layout slot stays at cardWidth so neighbours
                                    // never shift. The card inside grows to CARD_HOVER_W and overflows
                                    // this wrapper, popping OVER its neighbours — so overflow is relaxed
                                    // to visible (kept hidden only while collapsing, so filtered-out cards
                                    // still clip cleanly) and the grown card is lifted above siblings via
                                    // z-index. translateX re-centres the +32px so it grows evenly both ways.
                                    position: "relative",
                                    zIndex: grown ? 3 : 0,
                                    width: visible ? cardWidth : 0,
                                    // Height is content-driven (the card sets it) and NOT transitioned —
                                    // transitioning a flex item's cross-axis (height) gets pinned here, so
                                    // the height snaps to the new size while the main-axis width animates.
                                    // Track align-end bottom-anchors, so the card grows UPWARD.
                                    marginRight: visible ? (isSm ? 12 : 32) : 0,
                                    opacity: visible ? 1 : 0,
                                    overflow: visible ? "visible" : "hidden",
                                    transform: grown ? `translateX(${-(CARD_HOVER_W - cardWidth) / 2}px)` : "none",
                                    scrollSnapAlign: "center",
                                    transition: "width 0.3s ease, margin-right 0.3s ease, opacity 0.25s ease, transform 0.3s ease",
                                    // Only the visible card area receives pointer events
                                    pointerEvents: visible ? "auto" : "none",
                                    cursor: visible ? "grab" : "default",
                                }}
                                    onMouseEnter={() => { if (visible) setHoveredCardId(poi.id) }}
                                    onMouseLeave={() => setHoveredCardId(prev => (prev === poi.id ? "" : prev))}
                                    onMouseDown={e => {
                                        const c = carouselRef.current!
                                        dragRef.current = { active: true, startX: e.pageX, scrollLeft: c.scrollLeft, moved: false }
                                        e.currentTarget.style.cursor = "grabbing"
                                        c.style.scrollSnapType = "none"
                                        e.preventDefault()
                                    }}
                                    onMouseUp={e => {
                                        e.currentTarget.style.cursor = "grab"
                                    }}
                                    onClickCapture={e => {
                                        if (dragRef.current.moved) { e.stopPropagation(); dragRef.current.moved = false }
                                    }}
                                >
                                    <motion.div
                                        initial={false}
                                        // Slide up from a slight offset whenever the carousel is
                                        // revealed (incl. each hover-reveal on the facade), with a
                                        // small delay after hover + a gentle stagger between cards.
                                        animate={(carouselReady && !facadeUIHidden) ? { y: 0, opacity: 1 } : { y: 16, opacity: 0 }}
                                        transition={{
                                            duration: 0.5,
                                            ease: [0.22, 1, 0.36, 1],
                                            delay: (carouselReady && !facadeUIHidden) ? 0.12 + i * 0.06 : 0,
                                        }}
                                    >
                                        <POICard
                                            poi={poi}
                                            isActive={poi.id === selectedId && selectedId !== ""}
                                            cardWidth={grown ? CARD_HOVER_W : cardWidth}
                                            cardHeight={grown ? CARD_HOVER_H : CARD_REST_H}
                                            isSm={useSmCards}
                                            hoveredExternally={grown}
                                            onSelect={() => {
                                                setSelectedId(poi.id)
                                                setMapActive(true)   // FACADE: clicking a card activates the live map…
                                                isProgrammaticMoveRef.current = true
                                                // …and flies (no-op now if the map isn't loaded yet; the
                                                // DEFERRED FLY-TO effect handles it once it loads).
                                                easeToVisibleRef.current?.(poi.longitude, poi.latitude, Math.max(mapRef.current?.getZoom() ?? 14, 14), 500)
                                            }}
                                            onHover={() => handleCardHover(poi.id)}
                                            onHoverEnd={() => handleCardHoverEnd(poi.id)}
                                        />
                                    </motion.div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Conditional scroll arrows — overlay the carousel's left/right edges,
                        vertically centered on the cards. Each shows only when there's more to
                        reveal on that side (canScrollLeft / canScrollRight). The wrapper above
                        already fades the whole carousel out on the facade / when a POI is
                        selected, so these inherit that and need only gate on scroll state. */}
                    <div style={{
                        // Align with the card's 88px text box (the cream info panel anchored to
                        // the bottom of each card), not the full card height — so the arrows sit
                        // level with the labels rather than the photos.
                        position: "absolute", left: 24, bottom: 0, height: 88, zIndex: 3,
                        display: "flex", alignItems: "center",
                        pointerEvents: "none",
                    }}>
                        <div style={{
                            opacity: canScrollLeft ? 1 : 0,
                            pointerEvents: canScrollLeft ? "auto" : "none",
                            transition: "opacity 0.25s ease",
                        }}>
                            <CarouselArrow dir="left" onClick={() => scrollCarousel("left")} />
                        </div>
                    </div>
                    <div style={{
                        position: "absolute", right: 24, bottom: 0, height: 88, zIndex: 3,
                        display: "flex", alignItems: "center",
                        pointerEvents: "none",
                    }}>
                        <div style={{
                            opacity: canScrollRight ? 1 : 0,
                            pointerEvents: canScrollRight ? "auto" : "none",
                            transition: "opacity 0.25s ease",
                        }}>
                            <CarouselArrow dir="right" onClick={() => scrollCarousel("right")} />
                        </div>
                    </div>
                </div>
            )}

            {/* ===== POI DETAIL PANEL ===== */}
            <POIDetailPanel
                poi={selectedPOI}
                isSm={isSm}
                onClose={() => {
                    setSelectedId("")
                    mapRef.current?.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 400 })
                }}
            />

            {/* ===== FILTER PANEL ===== */}
            <FilterPanel
                isOpen={filtersOpen}
                isSm={isSm}
                parkLayers={parkLayers}
                filterOptions={filterOptions}
                pendingFilters={pendingFilters}
                resultCount={pendingResultCount}
                allParkNames={allParkNames}
                onToggleEN={() => setPendingFilters(prev => prev.allParks
                    ? { ...prev, allParks: false, parks: [] }     // EN on→off: deselect all (zero)
                    : { ...prev, allParks: true, parks: [] })}    // EN off→on: select all (Emerald Necklace)
                onTapPark={name => setPendingFilters(prev => {
                    if (prev.allParks) return { ...prev, allParks: false, parks: [name] } // from EN → only this park
                    const has = prev.parks.includes(name)
                    return { ...prev, allParks: false, parks: has ? prev.parks.filter(p => p !== name) : [...prev.parks, name] }
                })}
                onToggleFilter={(label, value) => setPendingFilters(prev => {
                    const arr = prev.fields[label] ?? []
                    return {
                        ...prev,
                        fields: {
                            ...prev.fields,
                            [label]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
                        },
                    }
                })}
                onApply={handleApply}
                onClear={handleClear}
                // sm: closing commits the current selection (incl. cleared) instead of
                // discarding it — so deselecting/clearing sticks rather than reverting.
                // (lg keeps discard-on-close; it has the on-map chips for live removal.)
                onClose={isSm ? handleApply : () => { resetMapPadding(); setFiltersOpen(false) }}
                // Layer toggles moved to the Paths dropdown — hide them from the filter
                // panel by feeding it empty layer data (the real state lives above).
                toggleLayersByCategory={{}}
                layerToggles={{}}
                onToggleLayer={key => setLayerToggles(prev => ({ ...prev, [key]: !prev[key] }))}
            />
        </div>
    )
}

/* ============================================================
   POI CARD

   VISUAL STRUCTURE:
   ┌─────────────────────────┐
   │  photo (arched top,     │
   │  194px radius corners)  │
   │─────────────────────────│ ← cream info panel overlays bottom
   │  TAG   POI Name    [+]  │
   │        address          │
   └─────────────────────────┘
   ============================================================ */
function ParkButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 16px",
                borderRadius: selected ? 100 : 8,
                border: selected ? `1px solid ${C.lemna}` : "1px solid transparent",
                background: hovered ? "rgba(216,234,171,0.12)" : "transparent",
                cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 18, fontWeight: 500,
                color: C.lemna, lineHeight: 1.3,
                transition: "background 0.15s ease, border-color 0.15s ease, border-radius 0.2s ease",
                boxSizing: "border-box",
            }}
        >
            {label}
        </button>
    )
}

function ChipRemoveButton({ onRemove, size = 72, iconSize = 14 }: { onRemove: () => void; size?: number; iconSize?: number }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onRemove}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                width: size, height: size, borderRadius: "50%",
                border: `1px solid ${C.salix}`,
                // Sits flush at the chip's LEFT edge: overlap the top/bottom/left borders by 1px
                // so its ring merges with the chip's left cap (single line, not a doubled border).
                margin: "-1px 0 -1px -1px",
                background: hovered ? C.cygnusHover : C.cygnus,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s ease",
            }}
        >
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
                <line x1="2" y1="2" x2="10" y2="10" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
                <line x1="10" y1="2" x2="2" y2="10" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
            </svg>
        </button>
    )
}

// Carousel scroll arrow — round button matching the chip/close button rule (48px circle,
// 1px salix border, cygnus → cygnusHover background). Uses the iconoir nav-arrow line
// icon (same path as the FilterPanel back arrow), mirrored for the right direction.
function CarouselArrow({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onClick}
            aria-label={dir === "left" ? "Scroll carousel left" : "Scroll carousel right"}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                width: 48, height: 48, borderRadius: "50%",
                background: hovered ? C.cygnusHover : C.cygnus,
                border: `1px solid ${C.salix}`,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxSizing: "border-box",
                transition: "background 0.15s ease",
            }}
        >
            {/* iconoir: nav-arrow-left / nav-arrow-right */}
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                    d={dir === "left" ? "M15 6L9 12L15 18" : "M9 6L15 12L9 18"}
                    stroke={C.salix} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
                />
            </svg>
        </button>
    )
}

// iconOnly collapses the button to a 48px circle showing just the filter glyph —
// used on sm when the Paths dropdown is open, so it stays visible (full opacity)
// without its label colliding with the dropdown.
function FilterButton({ onClick, count = 0, iconOnly = false }: { onClick: () => void; count?: number; iconOnly?: boolean }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onClick}
            aria-label="Open filters"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                height: 48,
                width: iconOnly ? 48 : undefined,
                borderRadius: 100,
                background: hovered ? C.cygnusHover : C.cygnus,
                border: `1px solid ${C.salix}`,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8,
                padding: iconOnly ? 0 : "0 24px 0 20px",
                // width/padding timing matches the Paths dropdown's open/close (top-right)
                // so the two animate in lockstep.
                transition: "background 0.15s ease, width 0.32s cubic-bezier(0.4, 0, 0.2, 1), padding 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.salix} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10 7H3" />
                <path d="M21 17L14 17" />
                <path d="M21 7H18" />
                <path d="M6 17H3" />
                <circle cx="15" cy="7" r="2.5" />
                <circle cx="9" cy="17" r="2.5" />
            </svg>
            {!iconOnly && (
                <span style={{
                    font: "500 14px/1 'IBM Plex Sans', sans-serif",
                    color: C.salix,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}>{count > 0 ? `${count} Filter` : "Filter"}</span>
            )}
        </button>
    )
}

// ZOOM OUT button — same pill style as FilterButton, with the lucide "fullscreen" icon. Flies
// the map back to its initial launch view (see goHome).
//   iconOnly  = collapse to a 48px icon-only pill (lg: when chips crowd the bar; sm: always).
//   tapReveal = touch/sm mode: NO hover behavior; a tap flashes the label for ~1s, then it
//               collapses again (the goHome action still fires on that tap).
//   On lg, holding a hover over the collapsed pill for 0.1s reveals the label; leaving collapses.
function ZoomOutButton({ onClick, iconOnly = false, tapReveal = false }: { onClick: () => void; iconOnly?: boolean; tapReveal?: boolean }) {
    const [hovered, setHovered] = useState(false)
    const [revealed, setRevealed] = useState(false)   // label currently revealed (hover-held or tap-flashed)
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearReveal = () => { if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null } }
    // lg/hover: reveal after a 0.1s hover; sm/touch: hover does nothing (handled on tap).
    const onEnter = () => {
        if (tapReveal) return
        setHovered(true)
        if (iconOnly) revealTimer.current = setTimeout(() => setRevealed(true), 100)
    }
    const onLeave = () => {
        if (tapReveal) return
        setHovered(false); clearReveal(); setRevealed(false)
    }
    // sm/touch: a tap flashes the label for ~1s, then collapses; the action still runs.
    const handleClick = () => {
        if (tapReveal && iconOnly) {
            clearReveal()
            setRevealed(true)
            revealTimer.current = setTimeout(() => setRevealed(false), 1000)
        }
        onClick()
    }
    // If it stops being collapsible while revealed, drop the reveal + timer.
    useEffect(() => { if (!iconOnly) { clearReveal(); setRevealed(false) } }, [iconOnly])
    useEffect(() => () => clearReveal(), [])

    const collapsed = iconOnly && !revealed   // icon-only right now (no label, 48px circle)

    return (
        <button
            onClick={handleClick}
            aria-label="Birdeye whole necklace"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            style={{
                height: 48,
                width: collapsed ? 48 : undefined,
                borderRadius: 100,
                background: hovered ? C.cygnusHover : C.cygnus,
                border: `1px solid ${C.salix}`,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8,
                padding: collapsed ? 0 : "0 24px 0 20px",
                transition: "background 0.15s ease, width 0.32s cubic-bezier(0.4, 0, 0.2, 1), padding 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
        >
            {/* "Birdeye" — a swooping bird glyph, salix-themed, 20x20 to match the nav icons */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.salix} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M16.0098 5.75C16.0892 5.75 16.1668 5.75828 16.2422 5.77246C16.0975 5.86007 16 6.01771 16 6.19922C16 6.47536 16.2239 6.69922 16.5 6.69922H16.5098C16.77 6.69922 16.9811 6.50014 17.0049 6.24609C17.164 6.45584 17.2598 6.7164 17.2598 7C17.2598 7.69036 16.7001 8.25 16.0098 8.25H16C15.3096 8.25 14.75 7.69036 14.75 7C14.75 6.30964 15.3096 5.75 16 5.75H16.0098Z" fill={C.salix} stroke="none" />
                <path d="M3.4 17.9988H12C14.1217 17.9988 16.1566 17.156 17.6569 15.6557C19.1571 14.1554 20 12.1206 20 9.99885V6.99885C20.0023 6.14676 19.7323 5.31621 19.2296 4.62824C18.7269 3.94026 18.0175 3.43081 17.205 3.17411C16.3925 2.91741 15.5193 2.92688 14.7125 3.20115C13.9058 3.47541 13.2077 4.00013 12.72 4.69885L2 19.9988" />
                <path d="M20 7L22 7.5L20 8" />
                <path d="M10 18V21" />
                <path d="M14 17.75V21" />
                <path d="M7 18.0006C8.23312 18.0006 9.43627 17.6206 10.4457 16.9123C11.4552 16.2041 12.2219 15.2021 12.6416 14.0425C13.0612 12.883 13.1134 11.6224 12.7911 10.4321C12.4687 9.24189 11.7874 8.17988 10.84 7.39062" />
            </svg>
            {!collapsed && (
                <span style={{
                    font: "500 14px/1 'IBM Plex Sans', sans-serif",
                    color: C.salix,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}>Birdeye whole necklace</span>
            )}
        </button>
    )
}

function POICard({ poi, isActive, cardWidth, cardHeight, isSm, hoveredExternally = false, onSelect, onHover, onHoverEnd }: {
    poi: POIRecord
    isActive: boolean
    cardWidth: number
    cardHeight: number
    isSm: boolean
    // Driven by the linked POI-dot hover (map → carousel). ORed with the card's own hover so a
    // dot hover lights the card up exactly like a direct card hover.
    hoveredExternally?: boolean
    onSelect: () => void
    onHover: () => void
    onHoverEnd: () => void
}) {
    const [hoveredSelf, setHoveredSelf] = useState(false)
    const hovered = hoveredSelf || hoveredExternally
    // Blur-up: show the tiny `small` thumbnail (blurred) until the real `large` image loads,
    // then fade the real image in. imgLoaded flips on the real image's load — and immediately
    // if it's already cached (onLoad can be missed for cached images, so also check .complete).
    const [imgLoaded, setImgLoaded] = useState(false)
    const photoRef = useRef<HTMLImageElement>(null)
    useEffect(() => {
        if (photoRef.current?.complete) setImgLoaded(true)
    }, [poi.photoLarge, poi.photo])

    // Title is a fixed 14px, clamped to two lines with an ellipsis (…) for anything longer
    // — no auto-fit measurement.

    const imageWidth = cardWidth
    // sm: image fills the full 180×200 boundary (info card anchored bottom-center,
    //     overlapping the lower part of the photo); corners morph circle → 20px on hover.
    // lg: original "pill" image (slightly taller than wide), info panel overlapping
    //     with a 20px peek below.
    const pillRadius = cardWidth / 2                  // lg: circle-radius pill top
    // Both sizes morph to a 20px squircle on hover; resting shape differs
    // (sm: circle, lg: pill top). Animation timing is shared on the image div.
    const imageRadius = hovered ? 20 : (isSm ? imageWidth / 2 : pillRadius)
    const infoPanelHeight = isSm ? 88 : 90
    const peekBelow = 20                              // lg: image visible below info panel
    const totalHeight = isSm ? cardHeight : Math.round(cardWidth * 1.15)
    const imageHeight = totalHeight                   // image fills the full card-boundary height
    const infoPanelTop = isSm
        ? totalHeight - infoPanelHeight              // sm: flush to the bottom of the 200px boundary
        : imageHeight - infoPanelHeight - peekBelow

    return (
        <div
            data-poi-id={poi.id}
            onClick={onSelect}
            onMouseEnter={() => { setHoveredSelf(true); onHover() }}
            onMouseLeave={() => { setHoveredSelf(false); onHoverEnd() }}
            style={{
                width: imageWidth, height: totalHeight,
                position: "relative", cursor: "pointer", flexShrink: 0,
                transition: "width 0.3s ease, height 0.3s ease",   // both animate (content height, not the flex item)
            }}
        >
            {/* Photo — behind the info panel. sm: circle → squircle on hover. */}
            <div style={{
                position: "absolute", top: 0, left: 0,
                width: imageWidth, height: imageHeight,
                borderRadius: imageRadius, overflow: "hidden",
                zIndex: 1,
                transition: "border-radius 0.4s ease, width 0.3s ease, height 0.3s ease",
            }}>
                {poi.photo ? (
                    <>
                        {/* Blur-up placeholder — tiny `small` thumbnail, blurred + slightly
                            scaled so its soft edge falls outside the clip. Fades out on load. */}
                        {poi.photoSmall && (
                            <img
                                src={poi.photoSmall}
                                alt=""
                                aria-hidden
                                style={{
                                    position: "absolute", inset: 0,
                                    width: "100%", height: "100%",
                                    objectFit: "cover", objectPosition: "50% 100%", pointerEvents: "none",
                                    filter: "blur(12px)", transform: "scale(1.1)", transformOrigin: "50% 100%",
                                    opacity: imgLoaded ? 0 : 1,
                                    transition: "opacity 0.4s ease",
                                }}
                            />
                        )}
                        {/* Real image — mid-res `large` (cards are small); lazy + fades in on load. */}
                        <img
                            ref={photoRef}
                            src={poi.photoLarge ?? poi.photo}
                            alt={poi.name}
                            loading="lazy"
                            decoding="async"
                            onLoad={() => setImgLoaded(true)}
                            style={{
                                position: "absolute", inset: 0,
                                width: "100%", height: "100%",
                                objectFit: "cover", objectPosition: "50% 100%", pointerEvents: "none",
                                // Anchor the cover-crop AND the hover zoom at center-bottom so the photo
                                // stays pinned to the bottom as the card grows — the window reveals upward
                                // (like an expanding clip mask) instead of re-centering/reframing.
                                transform: hovered ? "scale(1.06)" : "scale(1)",
                                transformOrigin: "50% 100%",
                                opacity: imgLoaded ? 1 : 0,
                                transition: "transform 0.4s ease, opacity 0.4s ease",
                            }}
                        />
                    </>
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: C.salix }} />
                )}
            </div>

            {/* Info panel — sits ON TOP of the circle's bottom portion. sm: anchored to the
                card BOTTOM so it stays put as the card grows taller on hover (photo grows up). */}
            <div style={{
                position: "absolute",
                ...(isSm ? { bottom: 0 } : { top: infoPanelTop }),
                left: 0, right: 0, height: infoPanelHeight,
                // Hover: salix fill with cygnus text (rest: cygnus fill, salix text).
                background: hovered ? C.salix : C.cygnus,
                border: `1px solid ${C.salix}`,
                padding: "14px 16px",
                display: "flex", flexDirection: "column", justifyContent: "flex-start",
                gap: 4,
                zIndex: 2,
                transition: "background 0.2s ease",
                boxSizing: "border-box",
            }}>
                {poi.poiTag && (
                    <div style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 500, fontSize: 10,
                        textTransform: "uppercase", color: hovered ? C.cygnus : C.salix,
                        transition: "color 0.2s ease",
                    }}>
                        {poi.poiTag}
                    </div>
                )}
                <div style={{
                    fontFamily: "'Canela Text Trial', serif",
                    fontSize: 14, color: hovered ? C.cygnus : C.salix, lineHeight: 1.3,
                    transition: "color 0.2s ease",
                    // Fixed 14px; clamp to two lines, ellipsis (…) anything longer.
                    display: "-webkit-box", WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2, overflow: "hidden",
                }}>
                    {poi.name}
                </div>
            </div>
        </div>
    )
}

/* ============================================================
   FILTER PANEL

   Full-screen overlay with cream background, rounded right corners.
   Nav bar: result count | CLEAR | APPLY | ✕
   Body: 3 columns — (Park, Jurisdictions) | (Facilities, Accessibility, Projects) | (Activities, Iconic Views)
   ============================================================ */
function POIDetailPanel({ poi, onClose, isSm }: { poi: POIRecord | null; onClose: () => void; isSm: boolean }) {
    const isOpen = poi !== null

    // ADDRESS value: prefer the explicit "Address or Coordinates" field; fall back to the
    // POI's own lat/lng so the section ALWAYS shows — including Simple POIs, which carry
    // coordinates but no address field. Both an address string and a "lat, lng" string are
    // valid Google Maps `destination=` values, so the directions link works either way.
    const addressValue = poi
        ? (poi.address || `${Number(poi.latitude).toFixed(6)}, ${Number(poi.longitude).toFixed(6)}`)
        : ""

    const infoRows = poi ? [
        { label: "PARK", value: poi.park },
        { label: "NEIGHBORHOOD", value: poi.neighborhood },
        { label: "ADDRESS", value: addressValue },
        { label: "HOURS", value: poi.hours },
        { label: "ACCESSIBILITY", value: poi.accessibility },
    ].filter(r => r.value) : []

    return (
        <div style={{
            position: "absolute", zIndex: 8,
            // sm → bottom sheet: full width, slides UP from the bottom.
            // lg → right-docked, vertically-centered panel: slides IN from the right.
            ...(isSm
                ? {
                    left: 0, right: 0, bottom: 0,
                    width: "100%",
                    // Auto height → the sheet fits its content (image + info), capped at the
                    // fraction so tall content can't exceed it (then the info scrolls).
                    height: "auto",
                    maxHeight: `${Math.round(SM_SHEET_FRACTION * 100)}%`,
                    transform: isOpen ? "translateY(0)" : "translateY(100%)",
                }
                : {
                    top: "50%", right: "4vw",
                    // Auto height → the panel fits its content (image + info), capped to the
                    // component height (then the info scrolls).
                    width: "60vw", maxWidth: 560, height: undefined, maxHeight: "100%",
                    // Closed: clear the panel width PLUS the 4vw right margin so nothing peeks.
                    transform: isOpen ? "translate(0, -50%)" : "translate(calc(100% + 4vw), -50%)",
                }),
            transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: isOpen ? "auto" : "none",
            // With a photo: cream background + rounded top so the panel reads as one
            // rounded-top surface behind the image. No photo: transparent — the info card
            // stands on its own, no empty cream drop above it.
            background: poi?.photo ? C.cygnus : "transparent",
            borderRadius: "32px 32px 0 0",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
        }}>
            {!poi ? null : <>

                {/* Image — only when the POI has a photo. No photo → no blank block;
                    the info card stands alone (see marginTop guard below). */}
                {poi.photo && (
                    <div style={{
                        // Fixed-height header so the panel can fit its content instead of
                        // stretching. object-fit:cover crops the photo to this box.
                        height: 280, flexShrink: 0,
                        border: `1px solid ${C.salix}`,
                        borderRadius: "32px 32px 0 0", overflow: "hidden",
                    }}>
                        <img src={poi.photo} alt={poi.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                )}

                {/* Action bar — close + Learn More, ABOVE the info section.
                    Floats over the image bottom when there's a photo. */}
                <div style={{
                    flexShrink: 0,
                    display: "flex", flexDirection: "row", gap: 0,
                    marginTop: poi.photo ? -100 : 0,
                    position: "relative", zIndex: 2,
                }}>
                    {/* LEARN MORE pill — fills the rest; hidden for Simple POIs */}
                    {poi.slug && !isSimplePOI(poi) ? (
                        <a
                            href={`${CONFIG.siteBaseUrl}/poi/${poi.slug}`}
                            style={{
                                flex: 1, height: 72, boxSizing: "border-box",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: C.cygnus, textDecoration: "none",
                                border: `1px solid ${C.salix}`,
                                borderRadius: 100, // full pill
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 16, fontWeight: 500,
                                letterSpacing: "0.1em", textTransform: "uppercase" as const,
                                color: C.salix,
                                transition: "background 0.15s ease",
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.background = C.cygnusHover)}
                            onMouseOut={(e) => (e.currentTarget.style.background = C.cygnus)}
                        >
                            Learn More
                        </a>
                    ) : (
                        <div style={{ flex: 1 }} />
                    )}

                    {/* Close / X button — to the RIGHT of LEARN MORE, in all cases */}
                    <button onClick={onClose} aria-label="Close" style={{
                        flexShrink: 0,
                        width: 72, height: 72, boxSizing: "border-box",
                        background: C.cygnus,
                        border: `1px solid ${C.salix}`,
                        borderRadius: "50%", // square dims + 50% radius → circle
                        cursor: "pointer", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        transition: "background 0.15s ease",
                    }}
                        onMouseOver={(e) => (e.currentTarget.style.background = C.cygnusHover)}
                        onMouseOut={(e) => (e.currentTarget.style.background = C.cygnus)}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <line x1="2" y1="2" x2="14" y2="14" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
                            <line x1="14" y1="2" x2="2" y2="14" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                {/* Info section — name + rows (border + all corners rounded).
                    flex-basis:0 to match the image → a stable 50/50 split for every POI,
                    independent of the photo's aspect ratio; scrolls if content is tall. */}
                <div style={{
                    // Always size to content (the image is a fixed-height header now), so the
                    // panel fits its content; scrolls only when it hits the panel's max-height.
                    flex: "0 1 auto", minHeight: 0,
                    position: "relative", zIndex: 1,
                    background: C.cygnus,
                    border: `1px solid ${C.salix}`,
                    borderRadius: 0, // rectangle — no rounded corners
                    overflowY: "auto",
                    // Unified padding for the whole card; children carry no padding of their own.
                    padding: 32,
                }}>
                    {/* POI name */}
                    <div style={{
                        background: C.cygnus,
                        marginBottom: 24,
                        fontFamily: "'Boldonse', sans-serif",
                        fontSize: 24, color: C.salix,
                        textTransform: "uppercase", letterSpacing: "0.02em",
                        lineHeight: 1.8,
                    }}>
                        {poi.name}
                    </div>

                    {/* Info rows — label stacked above value */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, background: C.cygnus }}>
                        {infoRows.map((row, i) => (
                            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{
                                    fontFamily: "'IBM Plex Sans', sans-serif",
                                    fontSize: 12, fontWeight: 700,
                                    color: C.salix, textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                }}>
                                    {row.label}
                                </div>
                                {row.label === "ADDRESS" && row.value ? (
                                    <a
                                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(row.value)}`}
                                        target="_blank" rel="noopener noreferrer"
                                        style={{
                                            fontFamily: "'IBM Plex Mono', monospace",
                                            fontSize: 12, fontWeight: 500, color: C.salix,
                                            lineHeight: 1.5, textDecoration: "underline",
                                        }}
                                    >
                                        {row.value}
                                    </a>
                                ) : (
                                    <div style={{
                                        fontFamily: "'IBM Plex Mono', monospace",
                                        fontSize: 12, fontWeight: 500, color: C.salix, lineHeight: 1.5,
                                        whiteSpace: "pre-line",
                                    }}>
                                        {row.value}
                                    </div>
                                )}
                                <div style={{ height: 1, background: `rgba(31,47,22,0.15)`, marginTop: 4 }} />
                            </div>
                        ))}
                    </div>
                </div>
            </>}
        </div>
    )
}

function FilterPanel({
    isOpen, isSm, parkLayers, allParkNames, filterOptions, pendingFilters, resultCount,
    onToggleEN, onTapPark, onToggleFilter, onApply, onClear, onClose,
    toggleLayersByCategory, layerToggles, onToggleLayer,
}: {
    isOpen: boolean
    isSm: boolean
    parkLayers: ParkLayer[]
    allParkNames: string[]
    filterOptions: Record<string, string[]>
    pendingFilters: PendingFilters
    resultCount: number
    onToggleEN: () => void
    onTapPark: (name: string) => void
    onToggleFilter: (label: string, value: string) => void
    onApply: () => void
    onClear: () => void
    onClose: () => void
    toggleLayersByCategory: Record<string, string[]>
    layerToggles: Record<string, boolean>
    onToggleLayer: (key: string) => void
}) {
    const [hoveredBtn, setHoveredBtn] = useState<"clear" | "apply" | null>(null)
    // At least one park (or Emerald Necklace) must be chosen to apply / leave the panel.
    const parkChosen = pendingFilters.allParks || pendingFilters.parks.length >= 1
    const hasFields = Object.values(pendingFilters.fields).some(v => v.length > 0)
    const hasToggles = Object.values(layerToggles).some(v => v === true)
    // CLEAR is available whenever the state isn't already the default (EN + nothing else).
    const clearEnabled = !pendingFilters.allParks || hasFields || hasToggles

    /* ============================================================
       UNIFIED SECTION MODEL (used by the sm two-pane layout)
       PARK first, then the same merged Filter--/Toggle- sections the
       lg columns use. Each item carries its own selected/onToggle so
       the right list and chip bar stay in sync with pendingFilters.
       ============================================================ */
    type UIItem = { key: string; label: string; selected: boolean; onToggle: () => void; indent?: number; opacity?: number }
    type UISection = { key: string; title: string; items: UIItem[] }
    const sections: UISection[] = []
    // PARK section: "Emerald Necklace" parent row, then the parks indented beneath it.
    // When EN is on, every park reads selected at 50% opacity (parent-implied); when
    // off, parks reflect their own selection at full opacity.
    sections.push({
        key: "park",
        title: "PARK",
        items: [
            {
                key: "park-en",
                label: "Emerald Necklace",
                selected: pendingFilters.allParks,
                onToggle: onToggleEN,
            },
            ...parkLayers.map(layer => ({
                key: `park-${layer.id}`,
                label: layer.label,
                selected: pendingFilters.allParks ? true : pendingFilters.parks.includes(layer.label),
                onToggle: () => onTapPark(layer.label),
                indent: 12,
                opacity: pendingFilters.allParks ? 0.5 : 1,
            })),
        ],
    })
    {
        const sectionMap = new Map<string, { title: string; filterKey?: string; toggleCatKey?: string }>()
        Object.keys(filterOptions).forEach(label => {
            const norm = label.toLowerCase()
            if (norm === "park" || norm === "parks") return
            if (!sectionMap.has(norm)) sectionMap.set(norm, { title: label.toUpperCase() })
            sectionMap.get(norm)!.filterKey = label
        })
        Object.keys(toggleLayersByCategory).forEach(cat => {
            const norm = cat.toLowerCase()
            if (norm === "park" || norm === "parks") return
            if (!sectionMap.has(norm)) sectionMap.set(norm, { title: cat.toUpperCase() })
            sectionMap.get(norm)!.toggleCatKey = cat
        })
        for (const [norm, { title, filterKey, toggleCatKey }] of sectionMap.entries()) {
            const items: UIItem[] = []
            if (filterKey) (filterOptions[filterKey] ?? []).forEach(v => items.push({
                key: `f-${norm}-${v}`,
                label: v,
                selected: (pendingFilters.fields[filterKey] ?? []).includes(v),
                onToggle: () => onToggleFilter(filterKey, v),
            }))
            if (toggleCatKey) (toggleLayersByCategory[toggleCatKey] ?? []).forEach(name => items.push({
                key: `t-${norm}-${name}`,
                label: name,
                selected: layerToggles[`${toggleCatKey}--${name}`] === true,
                onToggle: () => onToggleLayer(`${toggleCatKey}--${name}`),
            }))
            if (items.length > 0) sections.push({ key: norm, title, items })
        }
    }

    /* Live pending selections → removable chips (park + multi-select fields + toggle layers) */
    const pendingChips: { key: string; label: string; onRemove: () => void }[] = []
    // Park chip: 1 park → its name; 2+ → "N Parks"; all parks (EN) → no chip.
    // Removing it returns to the Emerald Necklace (all-parks) default.
    if (!pendingFilters.allParks && pendingFilters.parks.length >= 1) {
        const n = pendingFilters.parks.length
        pendingChips.push({
            key: "chip-park",
            label: n === 1 ? pendingFilters.parks[0] : `${n} Parks`,
            onRemove: () => onToggleEN(), // EN is currently off, so this selects all (default)
        })
    }
    Object.entries(pendingFilters.fields).forEach(([cat, vals]) =>
        vals.forEach(v => pendingChips.push({
            key: `chip-f-${cat}-${v}`, label: v, onRemove: () => onToggleFilter(cat, v),
        }))
    )
    Object.entries(layerToggles).forEach(([k, on]) => {
        if (!on) return
        pendingChips.push({
            key: `chip-t-${k}`,
            label: k.split("--").slice(1).join("--"),
            onRemove: () => onToggleLayer(k),
        })
    })

    /* Scrollspy: tap left index → scroll right list; scroll right list → highlight index */
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const sectionEls = useRef<Record<string, HTMLDivElement | null>>({})
    const isProgrammaticScroll = useRef(false)
    const [activeKey, setActiveKey] = useState("")
    const effectiveActive = activeKey && sections.some(s => s.key === activeKey)
        ? activeKey
        : (sections[0]?.key ?? "")

    // lg box highlight is momentary: when the focused category changes, flash its box
    // for 200ms, then clear so the highlight fades out. (The index stays highlighted.)
    const [flashKey, setFlashKey] = useState("")
    useEffect(() => {
        if (!effectiveActive) return
        setFlashKey(effectiveActive)
        const t = window.setTimeout(() => setFlashKey(""), 200)
        return () => window.clearTimeout(t)
    }, [effectiveActive])

    const scrollToSection = (key: string) => {
        const el = sectionEls.current[key]
        const sc = scrollRef.current
        setActiveKey(key)
        if (!el || !sc) return
        isProgrammaticScroll.current = true
        sc.scrollTo({ top: el.offsetTop, behavior: "smooth" })
        window.setTimeout(() => { isProgrammaticScroll.current = false }, 600)
    }

    const handleListScroll = () => {
        if (isProgrammaticScroll.current) return
        const sc = scrollRef.current
        if (!sc) return
        // last section whose top has passed the viewport top (with a small lead)
        let current = sections[0]?.key ?? ""
        for (const s of sections) {
            const el = sectionEls.current[s.key]
            if (!el) continue
            if (el.offsetTop - 24 <= sc.scrollTop) current = s.key
            else break
        }
        // tail fix: short final section can never reach the top → force it at the bottom
        if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 4) {
            current = sections[sections.length - 1]?.key ?? current
        }
        setActiveKey(current)
    }

    // Nudge: bring the PARK section into view and pulse its highlight, used when the
    // user tries to apply / leave with zero parks selected.
    function nudgePark() {
        scrollToSection("park")
        let n = 0
        const id = window.setInterval(() => {
            setFlashKey(n % 2 === 0 ? "park" : "")
            if (++n >= 6) { window.clearInterval(id); setFlashKey("") }
        }, 180)
    }
    // Can't apply OR leave the panel with zero parks — nudge instead.
    const guardedClose = () => { if (parkChosen) onClose(); else nudgePark() }

    return (
        <>
        {/* Click-outside backdrop — closes the panel. Sits just under the panel
            (zIndex 19); the panel (zIndex 20) covers everything except the 1vw gap
            on the right, so the only clickable backdrop area is that gap. */}
        <div
            onClick={guardedClose}
            style={{
                position: "absolute", inset: 0, zIndex: 6,
                pointerEvents: isOpen ? "auto" : "none",
            }}
        />
        <div style={{
            // Full-width up to FILTER_PANEL_MAX_W, anchored left (the map peeks on the right
            // when the container is wider). One surface color via FILTER_PANEL_BG.
            position: "absolute", top: 0, bottom: 0, left: 0,
            width: "100%", maxWidth: FILTER_PANEL_MAX_W,
            background: FILTER_PANEL_BG,
            borderRadius: 0,
            border: "none",
            boxSizing: "border-box",
            zIndex: 7,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            transform: isOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: isOpen ? "auto" : "none",
        }}>
            {/* Nav bar — back arrow + CLEAR + APPLY in one flex row. Heights/fonts
                stay per-breakpoint (#3); CLEAR & APPLY flex-fill the <=480 width (#2/Q1a). */}
            <div style={{
                height: isSm ? 64 : 100, flexShrink: 0,
                display: "flex", alignItems: "stretch",
                borderBottom: `1px solid ${C.salix}`,
                boxSizing: "border-box",
            }}>
                {/* Close (×) — leftmost, fixed width; closes the panel (guarded). */}
                <div
                    onClick={guardedClose}
                    style={{
                        flexShrink: 0, width: isSm ? 64 : 100,
                        borderRight: `1px solid ${C.salix}`,
                        boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                    }}
                >
                    {/* iconoir: xmark — same icon set + thin 0.5 stroke / butt cap as the
                        nav-arrow it replaces, for visual continuity. */}
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <path d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426" stroke={C.salix} strokeWidth="0.5" strokeLinecap="butt" strokeLinejoin="miter" />
                    </svg>
                </div>

                {/* CLEAR — flex-fills half the remaining width. */}
                <button
                    onClick={clearEnabled ? onClear : undefined}
                    onMouseEnter={() => clearEnabled && setHoveredBtn("clear")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    style={{
                        // marginLeft:-1 overlaps this button's left border onto the previous
                        // element's border so each junction reads as a single 1px divider
                        // (back-arrow│CLEAR and CLEAR│APPLY) instead of a doubled 2px line.
                        flex: 1, height: "100%", padding: 0, marginLeft: -1, boxSizing: "border-box",
                        borderRadius: 80, border: `1px solid ${clearEnabled ? C.salix : C.disabled}`,
                        background: clearEnabled ? (hoveredBtn === "clear" ? C.cygnusHover : C.cygnus) : "transparent",
                        fontFamily: "'IBM Plex Mono', monospace", fontSize: isSm ? 18 : 28, fontWeight: 500,
                        color: clearEnabled ? C.salix : C.disabled,
                        cursor: clearEnabled ? "pointer" : "default",
                        transition: "background 0.15s ease",
                    }}
                >
                    CLEAR
                </button>

                {/* APPLY — flex-fills the other half; keeps the lg in-button count (#5). */}
                <button
                    // 0 parks -> blocked: clicking nudges the PARK section instead of applying.
                    onClick={parkChosen ? onApply : nudgePark}
                    onMouseEnter={() => parkChosen && setHoveredBtn("apply")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    style={{
                        // marginLeft:-1 overlaps this button's left border onto the previous
                        // element's border so each junction reads as a single 1px divider
                        // (back-arrow│CLEAR and CLEAR│APPLY) instead of a doubled 2px line.
                        flex: 1, height: "100%", padding: 0, marginLeft: -1, boxSizing: "border-box",
                        borderRadius: 0, border: `1px solid ${parkChosen ? C.salix : C.disabled}`,
                        background: parkChosen
                            ? (hoveredBtn === "apply" ? C.salixHover : C.salix)
                            : "transparent",
                        fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
                        color: parkChosen ? C.cygnus : C.disabled,
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 4,
                    }}
                >
                    {/* Line 1 — main label */}
                    <span style={{ fontSize: isSm ? 18 : 28, fontWeight: 500, lineHeight: 1 }}>
                        APPLY
                    </span>
                    {/* Line 2 — result count (lg only; on sm the count lives in the footer). */}
                    <AnimatePresence initial={false}>
                        {parkChosen && !isSm && (
                            <motion.span
                                key="apply-count"
                                initial={{ opacity: 0, y: 6, height: 0 }}
                                animate={{ opacity: 1, y: 0, height: "auto" }}
                                exit={{ opacity: 0, y: 6, height: 0 }}
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                style={{
                                    fontSize: 14, fontWeight: 500, lineHeight: 1,
                                    display: "inline-block", overflow: "hidden",
                                }}
                            >
                                <AnimatedCount count={resultCount} />
                            </motion.span>
                        )}
                    </AnimatePresence>
                </button>
            </div>

            {/* Body — chip bar + two-pane (index | scrolling list) + footer.
                One layout for every breakpoint (the former sm structure). */}
                    {/* Selected-options chip bar (live pending selections).
                        Always mounted; slides open/closed by animating the grid row
                        0fr↔1fr (animates to natural height, no hardcoded px). */}
                    <div style={{
                        flexShrink: 0,
                        display: "grid",
                        gridTemplateRows: pendingChips.length > 0 ? "1fr" : "0fr",
                        transition: "grid-template-rows 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
                    }}>
                        <div style={{ overflow: "hidden", minHeight: 0 }}>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 8,
                                overflowX: "auto", overflowY: "hidden",
                                padding: "12px 16px",
                                WebkitOverflowScrolling: "touch",
                            }}>
                                <AnimatePresence initial={false}>
                                    {pendingChips.map(chip => (
                                        <motion.div
                                            key={chip.key}
                                            layout
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                            style={{
                                                display: "flex", alignItems: "center",
                                                height: 40, flexShrink: 0,
                                                background: C.cygnus,
                                                border: `1px solid ${C.salix}`,
                                                borderRadius: 100,
                                            }}
                                        >
                                            <ChipRemoveButton onRemove={chip.onRemove} size={40} iconSize={12} />
                                            <span style={{
                                                fontFamily: "'IBM Plex Mono', monospace",
                                                fontSize: 13, fontWeight: 500, color: C.salix,
                                                // × on the LEFT now: 8 gap from the button, 16 clears
                                                // the rounded right cap (mirror of the old 16-left / 8-right).
                                                padding: "0 16px 0 8px", whiteSpace: "nowrap",
                                            }}>
                                                {chip.label}
                                            </span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>

                    {/* Two-pane: fixed left index | scrollable right list.
                        marginTop:-1 pulls the border up onto the line above so it
                        overlaps (1px) instead of stacking (2px) when the chip bar is closed. */}
                    <div style={{ flex: 1, minHeight: 0, display: "flex", borderTop: `1px solid ${C.salix}`, marginTop: -1 }}>
                        {/* Left index — plain divs (no <button> chrome / borders) */}
                        <div style={{
                            flexShrink: 0, width: 150,
                            borderRight: `1px solid ${C.salix}`,
                            overflowY: "auto",
                        }}>
                            {sections.map(s => {
                                const active = effectiveActive === s.key
                                return (
                                    <div
                                        key={s.key}
                                        role="button"
                                        onClick={() => scrollToSection(s.key)}
                                        style={{
                                            padding: "18px 12px", textAlign: "left",
                                            background: active ? C.cygnusHover : "transparent",
                                            fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 700,
                                            fontSize: 13, color: C.salix,
                                            cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
                                            transition: "background 0.15s ease",
                                        }}
                                    >
                                        {s.title}
                                    </div>
                                )
                            })}
                        </div>

                        {/* Right unified list */}
                        <div
                            ref={scrollRef}
                            onScroll={handleListScroll}
                            style={{
                                flex: 1, minWidth: 0,
                                overflowY: "auto", position: "relative",
                                padding: "0 0 40px 0",
                            }}
                        >
                            {sections.map((s, i) => (
                                <div
                                    key={s.key}
                                    ref={el => { sectionEls.current[s.key] = el }}
                                    style={{
                                        borderTop: i > 0 ? `1px solid ${C.salix}` : "none",
                                        padding: "8px 20px",
                                        // flash on nudge (zero-park apply attempt)
                                        background: flashKey === s.key ? C.cygnusHover : "transparent",
                                        transition: flashKey === s.key ? "background 0.12s ease" : "background 0.6s ease-out",
                                    }}
                                >
                                    {/* Category title — now shown in the list too (was
                                        previously only in the left index), per the merge. */}
                                    <p style={{
                                        margin: "0 0 8px 0",
                                        fontFamily: "'IBM Plex Sans', sans-serif",
                                        fontWeight: 700, fontSize: 14, color: C.salix,
                                    }}>
                                        {s.title}
                                    </p>
                                    {s.items.map(item => (
                                        <FilterItem
                                            key={item.key}
                                            label={item.label}
                                            selected={item.selected}
                                            onToggle={item.onToggle}
                                            py={16}
                                            indent={item.indent}
                                            opacity={item.opacity}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer — centered result count (sm ONLY; on lg the count lives in the APPLY
                        button, so showing it here too is redundant). Same treatment + animation. */}
                    {isSm && (
                    <div style={{
                        flexShrink: 0,
                        height: 32, padding: "0 24px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderTop: `1px solid ${C.salix}`,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 12, fontWeight: 500, color: C.salix,
                        overflow: "hidden", boxSizing: "border-box",
                    }}>
                        <AnimatePresence initial={false}>
                            {pendingChips.length > 0 && (
                                <motion.span
                                    key="footer-count"
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 6 }}
                                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                    style={{ display: "inline-block", lineHeight: 1 }}
                                >
                                    <AnimatedCount count={resultCount} />
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>
                    )}
        </div>
        </>
    )
}

// Animated result count — "N results" with the bold number rolling on each change
// (capped at 99+). Shared by the APPLY button (lg) and the filter footer (sm).
function AnimatedCount({ count }: { count: number }) {
    const label = count > 99 ? "99+" : String(count)
    return (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.strong
                    key={label}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    style={{ fontWeight: 700, display: "inline-block" }}
                >
                    {label}
                </motion.strong>
            </AnimatePresence>
            results
        </span>
    )
}

function FilterItem({ label, selected, onToggle, py = 8, px, indent = 0, opacity = 1 }: { label: string; selected: boolean; onToggle: () => void; py?: number; px?: number; indent?: number; opacity?: number }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onToggle}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "none", border: "none",
                padding: px != null ? `${py}px ${px}px` : `${py}px 8px ${py}px 0`,
                marginLeft: indent,                       // indent child rows (parks under EN)
                opacity,                                  // dim parent-implied parks (EN on → 50%)
                cursor: "pointer", textAlign: "left",
                transition: "opacity 0.2s ease",
            }}
        >
            {/* Radio circle */}
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ flexShrink: 0 }}>
                {selected ? (
                    <>
                        <circle cx="14" cy="14" r="13.5" fill={hovered ? C.salixHover : C.salix} stroke={hovered ? C.salixHover : C.salix} />
                        <circle cx="14" cy="14" r="5" fill={C.cygnus} />
                    </>
                ) : (
                    <>
                        <circle cx="14" cy="14" r="13.5" fill={hovered ? C.cygnusHover : "transparent"} stroke={C.salix} />
                    </>
                )}
            </svg>
            <span style={{
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: 16, color: "#000", lineHeight: 1.25,
                // wrap instead of nowrap so long labels never overflow their column
                minWidth: 0,
            }}>
                {label}
            </span>
        </button>
    )
}

function ToggleItem({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
    return (
        <button
            onClick={onToggle}
            style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "none", border: "none", padding: "8px 8px 8px 0",
                cursor: "pointer", textAlign: "left",
            }}
        >
            {/* Toggle track */}
            <div style={{
                width: 48, height: 28, borderRadius: 100,
                background: on ? C.salix : C.cygnusHover,
                border: `1.5px solid ${on ? C.salix : C.disabled}`,
                position: "relative", flexShrink: 0,
                transition: "background 0.2s ease, border-color 0.2s ease",
            }}>
                {/* Toggle thumb */}
                <div style={{
                    position: "absolute",
                    top: 2, left: on ? 22 : 2,
                    width: 20, height: 20, borderRadius: "50%",
                    background: on ? C.cygnus : C.disabled,
                    transition: "left 0.2s ease, background 0.2s ease",
                }} />
            </div>
            <span style={{
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: 16, color: "#000",
            }}>
                {label}
            </span>
        </button>
    )
}

/* ============================================================
   PROPERTY CONTROLS
   ============================================================ */
addPropertyControls(ParkMapHoverReveal, {})
