// ParkMap.tsx

import facadeLg from "./facade-lg.png"
import facadeSm from "./facade-sm.png"
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
    defaultCenter: [-71.10, 42.315] as [number, number],
    defaultZoom: 12.5, // ← matches the facade screenshot zoom
    minZoom: 1,
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

// sm POI detail panel = bottom sheet covering this fraction of the container height.
// Used both for the sheet's height and for the map's bottom padding (so the selected
// POI centers in the visible strip ABOVE the sheet). Keep the two in sync via this.
const SM_SHEET_FRACTION = 0.75

type Breakpoint = "sm" | "lg"

// Whimsical loading copy: "finding {…}" — critters native to the Boston Emerald
// Necklace (Back Bay Fens, the Riverway, Jamaica Pond, Arnold Arboretum, Franklin
// Park) doing a characteristic behavior. One is picked at random per load.
const LOADING_CRITTERS = [
    "a sun-basking painted turtle",
    "a traffic-controlling goose",
    "a statue-still great blue heron",
    "an acorn-hoarding gray squirrel",
    "a grumpy mute swan",
    "a wing-drying cormorant",
    "a cheek-stuffing chipmunk",
    "a worm-wrangling robin",
    "a clover-nibbling rabbit",
    "a pond-skimming dragonfly",
    "a den-digging red fox",
    "a lily-hopping leopard frog",
]

// Minimum time the "finding …" loading message stays up after the live map is
// triggered — the map often loads instantly (404 tiles fail fast), so without a
// floor the message would flash by before it's readable.
const MIN_LOADING_MS = 2500

// Zonal map control: gestures (wheel/drag/pinch) are live only outside the dead zones.
// The top GESTURE_DEAD_TOP_VH and bottom GESTURE_DEAD_BOTTOM_VH of the map height let
// those gestures fall through to the page (so it scrolls). 0 + 0.3 → no top dead zone,
// bottom 30vh dead, top 70vh live. PLUS a GESTURE_DEAD_PAD_PX border all around the map
// (top/bottom/left/right) so edge gestures fall through too.
const GESTURE_DEAD_TOP_VH = 0
const GESTURE_DEAD_BOTTOM_VH = 0.3
const GESTURE_DEAD_PAD_PX = 20
// Faint debug tint over the dead zone(s) while testing. Off for production.
const SHOW_GESTURE_ZONE_DEBUG = false

// Result-count readout in the filter nav bar. Disabled per current design —
// kept in code (not deleted) so it can be switched back on by flipping this.
const SHOW_RESULT_COUNT = false

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
    Paths: ["Bike Paths", "Walking Paths"], // TODO: match your actual Toggle- layer names
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
}

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
    address: "Address",
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
    photo?: string
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

interface PendingFilters {
    park: string | null
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

function poiMatchesFilters(poi: POIRecord, park: string | null, filters: NonParkFilters): boolean {
    if (park && poi.park !== park) return false
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
            const withCoords = results.length
            const withFilters = results.filter(p => Object.keys(p.filterFields).length > 0).length
            const sampleFilters = results.find(p => Object.keys(p.filterFields).length > 0)?.filterFields
            console.error(`ParkMap: parsed ${withCoords} POIs with coordinates`)
            console.error(`ParkMap: ${withFilters} of those have Filter-- fields`)
            console.error("ParkMap: sample filterFields from first matching POI →", sampleFilters ?? "none")
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
export default function ParkMap() {
    const defaultZoom = CONFIG.defaultZoom
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
    const isProgrammaticMoveRef = useRef(false)
    const zoomStartRef = useRef(0)
    const introPlayedRef = useRef(false)
    const layerBoundsRef = useRef<Record<string, [[number, number], [number, number]]>>({})
    const parkLayersRef = useRef<ParkLayer[]>(INITIAL_PARK_LAYERS)
    const focusedParkRef = useRef<string | null>(null)
    const parkSourceRef = useRef<{ name: string; layer: string } | null>(null)
    const parkSymbolLayerRef = useRef<string | null>(null)   // style layer ID for park name labels
    const hoveredParkTitleRef = useRef<string | null>(null)  // currently hovered park name
    const easeToVisibleRef = useRef<((lng: number, lat: number, zoom: number, duration?: number) => void) | null>(null)
    const encOriginalColorRef = useRef<any>(null)
    const encOriginalOpacityRef = useRef<any>(null)

    const [pois, setPOIs] = useState<POIRecord[]>([])
    const [mapLoaded, setMapLoaded] = useState(false)
    const [debugZoom, setDebugZoom] = useState<number | null>(null)
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
    const [focusedPark, setFocusedPark] = useState<string | null>(null)
    // true only when park was selected via the filter panel — controls whether the chip shows
    const [parkFromFilter, setParkFromFilter] = useState(false)
    const [filtersOpen, setFiltersOpen] = useState(false)
    // Paths dropdown open/close. The path options ARE the existing Toggle- layers,
    // driven through the shared layerToggles state below.
    const [pathsOpen, setPathsOpen] = useState(false)
    const [appliedFilters, setAppliedFilters] = useState<NonParkFilters>(EMPTY_NON_PARK)
    const [pendingFilters, setPendingFilters] = useState<PendingFilters>({ park: null, fields: EMPTY_NON_PARK })
    const [carouselReady, setCarouselReady] = useState(false)
    const [containerWidth, setContainerWidth] = useState(1200)
    const [containerHeight, setContainerHeight] = useState(800)
    // FACADE: until the user clicks the map or a POI card, show a static image and DON'T
    // create the (billable) Mapbox map. Flips true on first meaningful click.
    const [mapActive, setMapActive] = useState(false)
    // true once the minimum loading-message display time has elapsed after activation
    const [minLoadElapsed, setMinLoadElapsed] = useState(false)
    const [hoveredPin, setHoveredPin] = useState<{ label: string; x: number; y: number } | null>(null)

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

    /* === DERIVED: POIs visible on map + carousel (applied filters) === */
    // All POIs matching current filters — shown on the map (includes Simple POIs)
    const filteredPOIs = useMemo(() =>
        pois.filter(poi => poiMatchesFilters(poi, focusedPark, appliedFilters)),
        [pois, focusedPark, appliedFilters]
    )
    // Carousel POIs — same as filteredPOIs but excludes Simple POIs
    const carouselPOIs = useMemo(() =>
        filteredPOIs.filter(poi => !isSimplePOI(poi)),
        [filteredPOIs]
    )

    /* === DERIVED: selected POI record === */
    const selectedPOI = useMemo(() =>
        selectedId ? pois.find(p => p.id === selectedId) ?? null : null,
        [pois, selectedId]
    )

    /* === DERIVED: preview count for filter panel (pending filters) === */
    const pendingResultCount = useMemo(() =>
        pois.filter(poi => !isSimplePOI(poi) && poiMatchesFilters(poi, pendingFilters.park, pendingFilters.fields)).length,
        [pois, pendingFilters]
    )

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

            mapRef.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: CONFIG.mapStyle,
                center: CONFIG.defaultCenter,
                zoom: defaultZoom,
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
            mapRef.current.on("zoom", () => { setDebugZoom(mapRef.current?.getZoom() ?? null) })
            mapRef.current.on("zoomend", () => {
                if (isProgrammaticMoveRef.current) { isProgrammaticMoveRef.current = false; return }
                if (mapRef.current.getZoom() < zoomStartRef.current) { setFocusedPark(null); setParkFromFilter(false) }
            })
            mapRef.current.on("error", (e: any) => {
                console.error("ParkMap: map error", e?.error?.message || String(e))
            })

            mapRef.current.on("load", () => {
                if (destroyed || !mapRef.current) return
                const map = mapRef.current
                map.resize()
                setDebugZoom(map.getZoom())
                ;(window as any).__map = map
                console.log("layers:", map.getStyle().layers.map((l: any) => `${l.id} (${l.type})`).join("\n"))

                // Turn all land layers lemna green after 3s delay
                const landColors: Array<[string, string, string, string, number]> = [
                    ["land",          "background-color", "background-opacity", "#C8DC8A", 0.6],
                    ["landcover",     "fill-color",       "fill-opacity",       "#C8DC8A", 0.6],
                    ["national-park", "fill-color",       "fill-opacity",       "#B9CF7B", 0.6],
                    ["landuse",       "fill-color",       "fill-opacity",       "#B5CA78", 0.6],
                ]
                setTimeout(() => {
                    landColors.forEach(([id, colorProp, opacityProp, color, opacity]) => {
                        try {
                            if (map.getLayer(id)) {
                                map.setPaintProperty(id, `${colorProp}-transition`, { duration: 1200, delay: 0 })
                                map.setPaintProperty(id, `${opacityProp}-transition`, { duration: 1200, delay: 0 })
                                map.setPaintProperty(id, colorProp, color)
                                map.setPaintProperty(id, opacityProp, opacity)
                            }
                        } catch (_) {}
                    })
                }, 1000)

                // Centers a lng/lat coordinate in the VISIBLE portion of the map
                // (i.e. to the left of the 480px detail overlay) at the given zoom.
                // Uses project/unproject to compute the exact geographic center needed.

                // Centers a POI in the visible portion of the map, accounting for the
                // POIDetailPanel. Uses Mapbox padding so it works even when zoom changes too.
                //   lg → panel is 60vw on the right  → pad right  (POI sits left of it)
                //   sm → panel is a bottom sheet      → pad bottom (POI sits above it)
                const easeToVisible = easeToVisibleRef.current = (lng: number, lat: number, zoom: number, duration = 400) => {
                    const el = map.getContainer()
                    const padding = el.clientWidth < BREAKPOINT
                        ? { top: 0, bottom: el.clientHeight * SM_SHEET_FRACTION, left: 0, right: 0 }
                        : { top: 0, bottom: 0, left: 0, right: el.clientWidth * 0.6 }
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
                // – Regular POIs: 8px default → 3px at z8 | 10px hover → 4px at z8 | 18px active → 7px at z8
                // To adjust the full sizes, edit the second stop (zoom 13) in each interpolate.
                // POI dot sizing — zoom interpolate MUST be the outermost expression (Mapbox GL restriction).
                // Zoom range: 8 (small) → 13 (full). To adjust sizes edit the numbers in the case branches.
                const isSimple = ["in", "Simple", ["get", "poiMode"]]
                const active   = ["boolean", ["feature-state", "active"], false]
                const hover    = ["boolean", ["feature-state", "hover"],  false]

                map.addLayer({
                    id: "poi-dot", type: "circle", source: "poi-source",
                    paint: {
                        // Simple dots now have a hover size-bump too (the ["all",isSimple,hover]
                        // branch). The circle-radius-transition below animates the bump.
                        "circle-radius": ["interpolate", ["linear"], ["zoom"],
                            8,  ["case", ["all", isSimple, active], 2,   ["all", isSimple, hover], 1.7, isSimple, 1.5, active, 4,   hover, 2,   1.5],
                            12, ["case", ["all", isSimple, active], 5,   ["all", isSimple, hover], 4,   isSimple, 3.5, active, 9,   hover, 4.4, 4],
                            14, ["case", ["all", isSimple, active], 10,  ["all", isSimple, hover], 8,   isSimple, 7,   active, 18,  hover, 8.8, 8],
                        ],
                        "circle-color": ["case",
                            isSimple, C.salix,
                            active, C.salix,
                            hover,  C.cygnusHover,
                            C.cygnus,
                        ],
                        // 1px light-green (lemna) border on Simple dots; salix on regular.
                        "circle-stroke-color": ["case", isSimple, C.lemna, C.salix],
                        "circle-stroke-width": ["case",
                            isSimple, 1,
                            active, 0,
                            1.5,
                        ],
                        "circle-radius-transition": { duration: 200 },
                        "circle-color-transition": { duration: 200 },
                    },
                }, firstSymbol)

                // Inner dot: cream bullseye for regular active POIs; small white dot for Simple active POIs
                map.addLayer({
                    id: "poi-dot-inner", type: "circle", source: "poi-source",
                    paint: {
                        "circle-radius": ["interpolate", ["linear"], ["zoom"],
                            8,  ["case", ["all", isSimple, active], 0.5, active, 1,   0],
                            12, ["case", ["all", isSimple, active], 1,   active, 2.5, 0],
                            14, ["case", ["all", isSimple, active], 2,   active, 5,   0],
                        ],
                        "circle-color": C.cygnus,
                        "circle-stroke-width": 0,
                        "circle-radius-transition": { duration: 150 },
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
                    if (focusedParkRef.current) {
                        setFocusedPark(null)
                        setParkFromFilter(false)
                        isProgrammaticMoveRef.current = true
                        map.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 800 })
                    }
                })

                map.on("mouseenter", "poi-dot", (e: any) => {
                    if (!e.features?.length) return
                    const id = e.features[0].properties.id
                    const name = e.features[0].properties.name ?? ""
                    hoveredPinIdRef.current = id
                    map.setFeatureState({ source: "poi-source", id }, { hover: true })
                    map.getCanvas().style.cursor = "pointer"
                    const pt = map.project(e.features[0].geometry.coordinates)
                    setHoveredPin({ label: name, x: pt.x, y: pt.y })
                })
                map.on("mousemove", "poi-dot", (e: any) => {
                    if (!e.features?.length) return
                    const pt = map.project(e.features[0].geometry.coordinates)
                    setHoveredPin(prev => prev ? { ...prev, x: pt.x, y: pt.y } : prev)
                })
                map.on("mouseleave", "poi-dot", () => {
                    if (hoveredPinIdRef.current) {
                        map.setFeatureState({ source: "poi-source", id: hoveredPinIdRef.current }, { hover: false })
                        hoveredPinIdRef.current = null
                    }
                    map.getCanvas().style.cursor = "default"
                    setHoveredPin(null)
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

                // Store the symbol layer ID so useEffect can update the halo when focusedPark changes
                if (autoSymbolIds[0]) parkSymbolLayerRef.current = autoSymbolIds[0]

                // No visual hover effect on park labels — cursor change only (handled in mouseenter/mouseleave).

                // ─── PARK FILL LAYERS ────────────────────────────────────────────────────
                // Three fill layers are added over the park polygons, stacked in this order
                // (bottom → top):
                //
                //   park-fill-hit      — fully transparent; only exists for mouse event hit-testing
                //   park-fill-hover    — salix at 10% opacity, shown when the cursor is over a park
                //   park-fill-selected — salix at 15% opacity, shown when a park is focused
                //
                // All three are inserted BEFORE the layer named in PARK_FILL_BEFORE_LAYER below,
                // which controls their z-order in the Mapbox style stack. Change that one constant
                // to move all three fills above or below a different base-map layer.
                //
                // To adjust opacity: edit fill-opacity in the addLayer calls for
                // park-fill-hover (currently 0.10) and park-fill-selected (currently 0.15).
                // ─────────────────────────────────────────────────────────────────────────
                const PARK_FILL_BEFORE_LAYER = "emerald-necklace-texture" // inserted between color and texture layers

                if (pkSourceName && pkSourceLayer) {
                    try {
                        const beforeFill = map.getLayer(PARK_FILL_BEFORE_LAYER) ? PARK_FILL_BEFORE_LAYER : (map.getLayer("poi-dot") ? "poi-dot" : undefined)
                        map.addLayer({
                            id: "park-fill-hover",
                            type: "fill",
                            source: pkSourceName,
                            "source-layer": pkSourceLayer,
                            paint: { "fill-color": C.salix, "fill-opacity": 0.10 },
                            filter: ["==", ["get", "Title"], ""],
                        }, beforeFill)

                        map.addLayer({
                            id: "park-fill-selected",
                            type: "fill",
                            source: pkSourceName,
                            "source-layer": pkSourceLayer,
                            paint: { "fill-color": "#D2C7FF", "fill-opacity": 1 },
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
                        if (focusedParkRef.current === layer.label) {
                            setFocusedPark(null)
                            setParkFromFilter(false)
                            isProgrammaticMoveRef.current = true
                            map.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 800 })
                        } else {
                            setFocusedPark(layer.label)
                            setParkFromFilter(false) // map tap — do not show filter chip
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
                // All parks are within the default viewport at zoom 11.7, so we query source
                // features from the tiles that load naturally — no fitBounds needed.
                if (pkSourceName && pkSourceLayer) {
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

                                // Move POI dot layers to the very top of the layer stack.
                                // Mapbox GL renders symbol/label layers in a separate post-processing pass,
                                // so they always appear above circle layers regardless of stack position.
                                // This means poi-dot ends up above all fill/line layers but below all labels.
                                if (map.getLayer("poi-dot"))       map.moveLayer("poi-dot")
                                if (map.getLayer("poi-dot-inner")) map.moveLayer("poi-dot-inner")

                                if (map.getLayer("emerald-necklace-map-color")) {
                                    encOriginalColorRef.current = map.getPaintProperty("emerald-necklace-map-color", "fill-color")
                                    encOriginalOpacityRef.current = map.getPaintProperty("emerald-necklace-map-color", "fill-opacity")
                                }

} catch(e) { console.error("ParkMap idle error", e) }
                        setMapLoaded(true)
                    })
                } else {
                    setMapLoaded(true)
                }
            })
        }).catch(err => {
            if (!destroyed) { setErrorMsg(err.message); setStatus("error") }
        })

        return () => {
            destroyed = true
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
        } else if (focusedPark) {
            const layer = parkLayers.find(l => l.label === focusedPark)
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

        // Dots whose centers fall within OVERLAP_PX of each other AT THE CURRENT ZOOM are
        // treated as overlapping and fanned onto a ring (a pair lands SPREAD_PX apart) so
        // each stays visible + clickable. Recomputed on zoom, so the spread engages only
        // while dots actually overlap and always reads ~SPREAD_PX (no fly-apart on zoom-in).
        const OVERLAP_PX = 10
        const SPREAD_PX = 4
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
            filteredPOIs.forEach(p => P.set(p.id, project(p.longitude, p.latitude)))
            const parent: Record<string, string> = {}
            filteredPOIs.forEach(p => { parent[p.id] = p.id })
            const find = (a: string): string => parent[a] === a ? a : (parent[a] = find(parent[a]))
            for (let i = 0; i < filteredPOIs.length; i++) for (let j = i + 1; j < filteredPOIs.length; j++) {
                const a = P.get(filteredPOIs[i].id)!, b = P.get(filteredPOIs[j].id)!
                if (Math.hypot(a[0] - b[0], a[1] - b[1]) < OVERLAP_PX) parent[find(filteredPOIs[i].id)] = find(filteredPOIs[j].id)
            }
            const clusters: Record<string, string[]> = {}
            filteredPOIs.forEach(p => { const r = find(p.id); (clusters[r] = clusters[r] || []).push(p.id) })
            Object.values(clusters).forEach(ids => ids.sort())   // stable ring assignment
            const spread = (poi: POIRecord): [number, number] => {
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
            const sorted = [...filteredPOIs].sort((a, b) => {
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
    }, [mapLoaded, filteredPOIs, selectedId, hoveredPin])

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

    /* === SECTION: KEEP REFS IN SYNC === */
    useEffect(() => { parkLayersRef.current = parkLayers }, [parkLayers])
    useEffect(() => {
        focusedParkRef.current = focusedPark
        const map = mapRef.current as any
        if (map?.getLayer("park-fill-selected")) {
            map.setFilter("park-fill-selected",
                focusedPark
                    ? ["==", ["get", "Title"], focusedPark]
                    : ["==", ["get", "Title"], ""]
            )
        }
        // Lighten background land layers when a park is focused (opacity doesn't render in v3, color does)
        const bgColorLayers: Array<[string, string, string, string]> = [
            ["land",          "background-color", "#C8DC8A", "#F4F8E8"],
            ["landcover",     "fill-color",       "#C8DC8A", "#F4F8E8"],
            ["national-park", "fill-color",       "#B9CF7B", "#F1F5E5"],
            ["landuse",       "fill-color",       "#B5CA78", "#F0F4E4"],
        ]
        bgColorLayers.forEach(([id, prop, normal, dimmed]) => {
            if (map?.getLayer(id)) {
                try { map.setPaintProperty(id, prop, focusedPark ? dimmed : normal) } catch (_) {}
            }
        })
        // Dim all parks on emerald-necklace-map-color when a park is selected
        // (park-fill-selected covers the active park with purple on top)
        if (map?.getLayer("emerald-necklace-map-color")) {
            if (focusedPark) {
                map.setPaintProperty("emerald-necklace-map-color", "fill-color", C.lemna)
                map.setPaintProperty("emerald-necklace-map-color", "fill-opacity", 0.5)
            } else {
                map.setPaintProperty("emerald-necklace-map-color", "fill-color", encOriginalColorRef.current)
                map.setPaintProperty("emerald-necklace-map-color", "fill-opacity", encOriginalOpacityRef.current ?? 1)
            }
        }
    }, [focusedPark])

    /* === SECTION: INTRO ANIMATION — removed, map starts at CONFIG.defaultCenter/Zoom === */

    /* === SECTION: CAROUSEL REVEAL ===
       Gated on POIs (Airtable), NOT the map — so the cards show in the facade state
       before the live map is ever loaded. */
    useEffect(() => {
        if (pois.length === 0 || carouselReady) return
        const timer = setTimeout(() => setCarouselReady(true), 300)
        return () => clearTimeout(timer)
    }, [pois, carouselReady])

    /* === SECTION: MIN LOADING TIME ===
       Once the live map is triggered, hold the "finding …" message for at least
       MIN_LOADING_MS so it's readable even when the map loads near-instantly. */
    useEffect(() => {
        if (!mapActive) return
        const timer = setTimeout(() => setMinLoadElapsed(true), MIN_LOADING_MS)
        return () => clearTimeout(timer)
    }, [mapActive])

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
    async function zoomToPark(layerId: string) {
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
        mapRef.current.fitBounds(bounds, { padding: { top: 40, bottom: CAROUSEL_PAD, left: 40, right: 40 }, duration: 800 })
    }

    function handleParkClick(layer: ParkLayer) {
        if (focusedPark === layer.label) {
            setFocusedPark(null)
            setParkFromFilter(false)
            setAppliedFilters(prev => ({ ...prev }))
            isProgrammaticMoveRef.current = true
            mapRef.current?.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 800 })
        } else {
            setFocusedPark(layer.label)
            setParkFromFilter(true) // selected from filter panel
            zoomToPark(layer.id)
        }
    }

    function openFilters() {
        setMapActive(true)   // FACADE: opening the filter loads the live map (apply no longer does)
        setPendingFilters({ park: focusedPark, fields: { ...appliedFilters } })
        setSelectedId("")
        mapRef.current?.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 })
        setFiltersOpen(true)
    }

    function handleApply() {
        setAppliedFilters(pendingFilters.fields)
        if (pendingFilters.park !== focusedPark) {
            setFocusedPark(pendingFilters.park)
            setParkFromFilter(pendingFilters.park !== null) // show chip only when set from filter panel
            if (pendingFilters.park) {
                const layer = parkLayers.find(l => l.label === pendingFilters.park)
                if (layer) zoomToPark(layer.id)
            } else {
                isProgrammaticMoveRef.current = true
                mapRef.current?.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 800 })
            }
        }
        setFiltersOpen(false)
    }

    function handleClear() {
        setPendingFilters({ park: null, fields: {} })
        setLayerToggles(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])))
    }

    function handleCardHover(poiId: string) {
        if (!mapRef.current || !mapLoaded) return
        if (hoveredPinIdRef.current && hoveredPinIdRef.current !== poiId) {
            mapRef.current.setFeatureState({ source: "poi-source", id: hoveredPinIdRef.current }, { hover: false })
        }
        hoveredPinIdRef.current = poiId
        mapRef.current.setFeatureState({ source: "poi-source", id: poiId }, { hover: true })
    }

    function handleCardHoverEnd(poiId: string) {
        if (!mapRef.current || !mapLoaded) return
        mapRef.current.setFeatureState({ source: "poi-source", id: poiId }, { hover: false })
        if (hoveredPinIdRef.current === poiId) hoveredPinIdRef.current = null
    }

    function scrollCarouselTo(poiId: string) {
        if (!carouselRef.current) return
        const card = carouselRef.current.querySelector(`[data-poi-id="${poiId}"]`) as HTMLElement
        if (!card) return
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
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
        (focusedPark && parkFromFilter ? 1 : 0) +
        Object.values(appliedFilters).reduce((n, vals) => n + vals.length, 0)

    // Always use the compact sm-scale POI cards in the carousel — on every
    // breakpoint, and both before AND after the Mapbox map is engaged. (The lg
    // pill cards are no longer used; the small cards stay put through activation.)
    const useSmCards = true
    // Fixed 180px compact cards (more visible per screen).
    const cardWidth = useSmCards ? 180 : Math.min(263, containerWidth - 72)

    // Center the "Explore Map / Finding…" CTA in the CLEAR map band — below the
    // top controls (Filter/Paths) and above the carousel — not the geometric
    // screen center. Top controls: top:24 + 48 tall ≈ 72. Carousel footprint:
    // 200px card + 40px bottom offset + 8px track pad ≈ 248 (only when cards exist).
    const ctaTopReserve = 72
    const ctaBottomReserve = pois.length > 0 ? 248 : 0

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

    // Frozen facade images — white style, captured locally to avoid CDN/token issues.
    // To update: tell Claude to retake the screenshot.
    const staticMapUrl = isSm ? facadeSm : facadeLg

    /* ============================================================
       RENDER
       ============================================================ */
    return (
        <div
            ref={containerRef}
            style={{
                width: "100%", height: "100%", minHeight: 400,
                position: "relative", overflow: "hidden",
                background: C.lemna,
            }}
        >
            {/* ===== MAP CANVAS ===== */}
            <div ref={mapContainer} style={{ position: "absolute", inset: 0 }} />


            {/* DEBUG zoom badge — remove before ship */}
            {debugZoom !== null && (
                <div style={{
                    position: "absolute", top: 8, left: 8, zIndex: 999,
                    background: "rgba(0,0,0,0.65)", color: "#fff",
                    padding: "3px 7px", borderRadius: 4, fontFamily: "monospace", fontSize: 13,
                    pointerEvents: "none",
                }}>
                    z {debugZoom.toFixed(2)}
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
                    transition: "opacity 1s ease",
                }}
            />
            {/* CENTER CTA — one pill that morphs between two states:
                  facade  → "Explore Map" (click to load the live map)
                  loading → "Finding {critter}…" (the message system)
                Same salix pill in both; `layout` animates the width as the text
                swaps (crossfade). Fades out once the map is revealed. */}
            <AnimatePresence>
                {!(mapLoaded && minLoadElapsed) && (
                    <motion.div
                        key="center-cta"
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        style={{
                            // span the clear map band (below top controls, above carousel)
                            // so the button centers there, not at the screen's geometric center
                            position: "absolute", top: ctaTopReserve, left: 0, right: 0, bottom: ctaBottomReserve,
                            zIndex: 3,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            pointerEvents: "none",
                        }}
                    >
                        <motion.button
                            layout
                            onClick={mapActive ? undefined : () => setMapActive(true)}
                            aria-label={mapActive ? "Loading map" : "Explore map"}
                            transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                            style={{
                                pointerEvents: mapActive ? "none" : "auto",
                                maxWidth: "calc(100% - 32px)",
                                minHeight: 48, borderRadius: 100, boxSizing: "border-box",
                                background: C.salix,
                                border: `1px solid ${C.salix}`,
                                cursor: mapActive ? "default" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                padding: "13px 28px",
                                font: "500 14px/1.3 'IBM Plex Sans', sans-serif",
                                color: C.cygnus,
                                letterSpacing: "0.02em",
                                textTransform: mapActive ? "none" : "uppercase",
                                textAlign: "center",
                            }}
                        >
                            <AnimatePresence mode="popLayout" initial={false}>
                                <motion.span
                                    key={!mapActive ? "explore" : status === "error" ? "error" : "finding"}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.25, ease: "easeOut" }}
                                    style={{ display: "block", whiteSpace: "normal" }}
                                >
                                    {!mapActive ? "Explore Map" : status === "error" ? `⚠️ ${errorMsg}` : (() => {
                                        // Split "a pond-skimming dragonfly" → ["Finding", "a pond-skimming",
                                        // "dragonfly"]. word[0]=article, word[1]=adjective, word[2..]=animal.
                                        const w = loadingCritter.split(" ")
                                        const segments = ["Finding", w.slice(0, 2).join(" "), w.slice(2).join(" ")]
                                        // Each segment lives in a clip wrapper (overflow hidden) and slides up
                                        // from below once revealStep reaches its index. The wrappers reserve
                                        // their full width immediately, so the pill expands to fit the whole
                                        // message while the words are still hidden below the clip.
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
                                </motion.span>
                            </AnimatePresence>
                        </motion.button>
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



            <AnimatePresence>
                {hoveredPin && !selectedId && (
                    // Outer motion.div = positioning/centering + fade (opacity only, so the
                    // centering transform is preserved). Inner motion.div = the up/down slide.
                    // AnimatePresence retains the last position so it animates out in place.
                    <motion.div
                        key="hover-tip"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            position: "absolute",
                            left: hoveredPin.x,
                            top: hoveredPin.y - 16,
                            transform: "translate(-50%, -100%)",
                            zIndex: 2,
                            pointerEvents: "none",
                        }}
                    >
                        <motion.div
                            initial={{ y: 6 }}
                            animate={{ y: 0 }}
                            exit={{ y: 6 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            style={{
                                padding: "5px 10px",
                                background: C.cygnus,
                                fontFamily: "'IBM Plex Sans', sans-serif",
                                fontSize: 12, fontWeight: 500,
                                textTransform: "uppercase", color: C.salix,
                                whiteSpace: "nowrap",
                                lineHeight: 1.4,
                            }}
                        >
                            {hoveredPin.label}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>


            {/* ===== FILTER BUTTON + ACTIVE FILTER CHIPS — top left ===== */}
            <div style={{
                position: "absolute", top: 24, left: 24, right: 24, zIndex: 5,
                display: "flex", alignItems: "flex-start", gap: 8,
                pointerEvents: "none",
            }}>
                <div style={{ pointerEvents: "auto", flexShrink: 0 }}>
                    <FilterButton onClick={openFilters} count={isSm ? appliedFilterCount : 0} />
                </div>
                {(() => {
                    // sm: filters are summarized on the Filter button instead of chips.
                    if (isSm) return null
                    const chips: { label: string; onRemove: () => void }[] = []
                    if (focusedPark && parkFromFilter) chips.push({
                        label: focusedPark,
                        onRemove: () => {
                            setFocusedPark(null)
                            setParkFromFilter(false)
                            isProgrammaticMoveRef.current = true
                            mapRef.current?.flyTo({ center: CONFIG.defaultCenter, zoom: CONFIG.defaultZoom, duration: 800 })
                        },
                    })
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
                                    <span style={{
                                        fontFamily: "'IBM Plex Mono', monospace",
                                        fontSize: 13, fontWeight: 500, color: C.salix,
                                        paddingLeft: 20, paddingRight: 12,
                                        whiteSpace: "nowrap",
                                    }}>
                                        {chip.label}
                                    </span>
                                    <ChipRemoveButton onRemove={chip.onRemove} size={48} />
                                </div>
                            ))}
                        </div>
                    )
                })()}
            </div>

            {/* ===== PATHS BUTTON + DROPDOWN — top right ===== */}
            <div style={{ position: "absolute", top: 24, right: 24, zIndex: 5, pointerEvents: "auto" }}>
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

            {/* ===== CAROUSEL — hidden when a POI is selected ===== */}
            {pois.length > 0 && (
                <div style={{
                    position: "absolute", bottom: 24, left: 0, right: 0, zIndex: 2,
                    // fade only; individual cards do their own staggered slide-up below
                    opacity: carouselReady && !selectedId ? 1 : 0,
                    transition: "opacity 0.5s ease",
                    pointerEvents: "none", // never block map clicks — inner scroll track opts back in
                }}>
                    {/* Scroll track. pointer-events: auto so TOUCH gestures can scroll it
                        (with pointer-events:none, mobile drags fell through to the map and the
                        carousel couldn't be scrolled). touch-action: pan-x → horizontal drags
                        scroll the carousel while vertical drags still pan the page. */}
                    <div
                        ref={carouselRef}
                        style={{
                            display: "flex", flexDirection: "row",
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
                            return (
                                <div key={poi.id} style={{
                                    flexShrink: 0,
                                    width: visible ? cardWidth : 0,
                                    marginRight: visible ? (isSm ? 12 : 32) : 0,
                                    opacity: visible ? 1 : 0,
                                    overflow: "hidden",
                                    scrollSnapAlign: "center",
                                    transition: "width 0.3s ease, margin-right 0.3s ease, opacity 0.25s ease",
                                    // Only the visible card area receives pointer events
                                    pointerEvents: visible ? "auto" : "none",
                                    cursor: visible ? "grab" : "default",
                                }}
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
                                        animate={carouselReady ? { y: 0, opacity: 1 } : { y: 48, opacity: 0 }}
                                        transition={{
                                            duration: 0.9,
                                            ease: [0.22, 1, 0.36, 1],
                                            // staggered so cards rise one after another at launch
                                            delay: carouselReady ? i * 0.15 : 0,
                                        }}
                                    >
                                        <POICard
                                            poi={poi}
                                            isActive={poi.id === selectedId && selectedId !== ""}
                                            cardWidth={cardWidth}
                                            isSm={useSmCards}
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
                onChangePark={park => setPendingFilters(prev => ({ ...prev, park }))}
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
                onClose={isSm ? handleApply : () => setFiltersOpen(false)}
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
                margin: "-1px -1px -1px 0",
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

function FilterButton({ onClick, count = 0 }: { onClick: () => void; count?: number }) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            onClick={onClick}
            aria-label="Open filters"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                height: 48,
                borderRadius: 100,
                background: hovered ? C.cygnusHover : C.cygnus,
                border: `1px solid ${C.salix}`,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8,
                padding: "0 24px 0 20px",
                transition: "background 0.15s ease",
            }}
        >
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
                <line x1="1" y1="3.5" x2="21" y2="3.5" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
                <line x1="1" y1="10.5" x2="21" y2="10.5" stroke={C.salix} strokeWidth="1" strokeLinecap="round" />
                <circle cx="15" cy="3.5" r="3" fill="transparent" stroke={C.salix} strokeWidth="1" />
                <circle cx="7" cy="10.5" r="3" fill="transparent" stroke={C.salix} strokeWidth="1" />
            </svg>
            <span style={{
                font: "500 14px/1 'IBM Plex Sans', sans-serif",
                color: C.salix,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
            }}>{count > 0 ? `${count} Filter` : "Filter"}</span>
        </button>
    )
}

function POICard({ poi, isActive, cardWidth, isSm, onSelect, onHover, onHoverEnd }: {
    poi: POIRecord
    isActive: boolean
    cardWidth: number
    isSm: boolean
    onSelect: () => void
    onHover: () => void
    onHoverEnd: () => void
}) {
    const [hovered, setHovered] = useState(false)

    // Title fit: render at 16px; if the name would wrap past two lines, step down
    // to 14px. The 2-line clamp + ellipsis on the title (below) catches anything
    // that still overflows at 14px.
    const titleRef = useRef<HTMLDivElement>(null)
    const [titleSize, setTitleSize] = useState(16)
    React.useLayoutEffect(() => {
        const measure = () => {
            const el = titleRef.current
            if (!el) return
            // Measure the UNCLAMPED height at 16px (toggle the clamp off, read, restore).
            // scrollHeight while -webkit-line-clamp is active is unreliable, so we
            // temporarily switch to a plain block at 16px to get the true height.
            const s = el.style
            const prev = { font: s.fontSize, display: s.display, clamp: s.webkitLineClamp, overflow: s.overflow }
            s.fontSize = "16px"; s.display = "block"; s.webkitLineClamp = "unset"; s.overflow = "visible"
            const twoLines = 16 * 1.3 * 2 + 1        // px height of two 16px/1.3 lines
            const overflowsTwoLines = el.scrollHeight > twoLines
            s.fontSize = prev.font; s.display = prev.display; s.webkitLineClamp = prev.clamp; s.overflow = prev.overflow
            setTitleSize(overflowsTwoLines ? 14 : 16)
        }
        const el = titleRef.current
        if (!el) return
        // The carousel animates each card's width 0→full, so the title's available
        // width settles AFTER mount — re-measure whenever its size changes (rAF-
        // debounced to avoid ResizeObserver feedback). measure() always reads at a
        // forced 16px, so the 14/16 decision is stable and the loop converges.
        let raf = 0
        const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) })
        ro.observe(el)
        measure()
        // Re-measure once the async web font (Canela) loads — fallback metrics differ.
        let cancelled = false
        if (document.fonts?.ready) document.fonts.ready.then(() => { if (!cancelled) measure() })
        return () => { ro.disconnect(); cancelAnimationFrame(raf); cancelled = true }
    }, [poi.name])

    const imageWidth = cardWidth
    // sm: image fills the full 180×200 boundary (info card anchored bottom-center,
    //     overlapping the lower part of the photo); corners morph circle → 20px on hover.
    // lg: original "pill" image (slightly taller than wide), info panel overlapping
    //     with a 20px peek below.
    const pillRadius = cardWidth / 2                  // lg: circle-radius pill top
    // Both sizes morph to a 20px squircle on hover; resting shape differs
    // (sm: circle, lg: pill top). Animation timing is shared on the image div.
    const imageRadius = hovered ? 20 : (isSm ? imageWidth / 2 : pillRadius)
    const infoPanelHeight = isSm ? 84 : 90
    const peekBelow = 20                              // lg: image visible below info panel
    const totalHeight = isSm ? 200 : Math.round(cardWidth * 1.15)
    const imageHeight = totalHeight                   // image fills the full card-boundary height
    const infoPanelTop = isSm
        ? totalHeight - infoPanelHeight              // sm: flush to the bottom of the 200px boundary
        : imageHeight - infoPanelHeight - peekBelow

    return (
        <div
            data-poi-id={poi.id}
            onClick={onSelect}
            onMouseEnter={() => { setHovered(true); onHover() }}
            onMouseLeave={() => { setHovered(false); onHoverEnd() }}
            style={{
                width: imageWidth, height: totalHeight,
                position: "relative", cursor: "pointer", flexShrink: 0,
            }}
        >
            {/* Photo — behind the info panel. sm: circle → squircle on hover. */}
            <div style={{
                position: "absolute", top: 0, left: 0,
                width: imageWidth, height: imageHeight,
                borderRadius: imageRadius, overflow: "hidden",
                zIndex: 1,
                transition: "border-radius 0.4s ease",
            }}>
                {poi.photo ? (
                    <img
                        src={poi.photo}
                        alt={poi.name}
                        style={{
                            position: "absolute", inset: 0,
                            width: "100%", height: "100%",
                            objectFit: "cover", pointerEvents: "none",
                            transform: hovered ? "scale(1.06)" : "scale(1)",
                            transition: "transform 0.4s ease",
                        }}
                    />
                ) : (
                    <div style={{ position: "absolute", inset: 0, background: C.salix }} />
                )}
            </div>

            {/* Info panel — sits ON TOP of the circle's bottom portion */}
            <div style={{
                position: "absolute",
                top: infoPanelTop, left: 0, right: 0, height: infoPanelHeight,
                background: hovered ? "#fff" : C.cygnus,
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
                        textTransform: "uppercase", color: C.salix,
                    }}>
                        {poi.poiTag}
                    </div>
                )}
                <div ref={titleRef} style={{
                    fontFamily: "'Canela Text Web', serif",
                    fontSize: titleSize, color: C.salix, lineHeight: 1.3,
                    // Cap at two lines; ellipsis anything longer (even after the 14px step).
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

    const infoRows = poi ? [
        { label: "PARK", value: poi.park },
        { label: "NEIGHBORHOOD", value: poi.neighborhood },
        { label: "ADDRESS", value: poi.address },
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
                                {row.label === "ADDRESS" && poi.address ? (
                                    <a
                                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(poi.address)}`}
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
    isOpen, isSm, parkLayers, filterOptions, pendingFilters, resultCount,
    onChangePark, onToggleFilter, onApply, onClear, onClose,
    toggleLayersByCategory, layerToggles, onToggleLayer,
}: {
    isOpen: boolean
    isSm: boolean
    parkLayers: ParkLayer[]
    filterOptions: Record<string, string[]>
    pendingFilters: PendingFilters
    resultCount: number
    onChangePark: (park: string | null) => void
    onToggleFilter: (label: string, value: string) => void
    onApply: () => void
    onClear: () => void
    onClose: () => void
    toggleLayersByCategory: Record<string, string[]>
    layerToggles: Record<string, boolean>
    onToggleLayer: (key: string) => void
}) {
    const [hoveredBtn, setHoveredBtn] = useState<"clear" | "apply" | null>(null)

    /* ============================================================
       UNIFIED SECTION MODEL (used by the sm two-pane layout)
       PARK first, then the same merged Filter--/Toggle- sections the
       lg columns use. Each item carries its own selected/onToggle so
       the right list and chip bar stay in sync with pendingFilters.
       ============================================================ */
    type UIItem = { key: string; label: string; selected: boolean; onToggle: () => void }
    type UISection = { key: string; title: string; items: UIItem[] }
    const sections: UISection[] = []
    sections.push({
        key: "park",
        title: "PARK",
        items: parkLayers.map(layer => ({
            key: `park-${layer.id}`,
            label: layer.label,
            selected: pendingFilters.park === layer.label,
            onToggle: () => onChangePark(pendingFilters.park === layer.label ? null : layer.label),
        })),
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
    if (pendingFilters.park) pendingChips.push({
        key: "chip-park", label: pendingFilters.park, onRemove: () => onChangePark(null),
    })
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

    /* ============================================================
       lg column packing (real <div> columns, not CSS multicol)
       Measure each category box's height, then greedily pack WHOLE
       categories into fixed-width columns until one would overflow,
       then start the next. Real bordered columns, predictable layout.
       ============================================================ */
    const [columns, setColumns] = useState<string[][]>([])
    const sectionsSig = sections.map(s => `${s.key}:${s.items.length}`).join("|")
    React.useLayoutEffect(() => {
        if (isSm) return
        const pack = () => {
            const sc = scrollRef.current
            if (!sc) return
            const H = sc.clientHeight
            if (H <= 0) return
            const cols: string[][] = [[]]
            let h = 0
            for (const s of sections) {
                const boxH = sectionEls.current[s.key]?.offsetHeight ?? 0
                if (h + boxH > H && cols[cols.length - 1].length > 0) {
                    cols.push([]); h = 0
                }
                cols[cols.length - 1].push(s.key)
                h += boxH
            }
            setColumns(prev => {
                const same = prev.length === cols.length &&
                    prev.every((c, i) => c.length === cols[i].length && c.every((k, j) => k === cols[i][j]))
                return same ? prev : cols
            })
        }
        pack()
        const t = window.setTimeout(pack, 150) // re-pack once fonts settle
        window.addEventListener("resize", pack)
        return () => { window.clearTimeout(t); window.removeEventListener("resize", pack) }
    }, [isSm, sectionsSig])

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

    // Horizontal scrollspy for the lg two-pane (continuous multi-column flow).
    // Uses getBoundingClientRect because CSS multicol breaks offsetLeft/offsetTop
    // for flowed content.
    const scrollToSectionH = (key: string) => {
        const el = sectionEls.current[key]
        const sc = scrollRef.current
        setActiveKey(key)
        if (!el || !sc) return
        isProgrammaticScroll.current = true
        // LIST_LEFT_GAP: leave a little gap from the divider instead of slamming flush.
        const delta = el.getBoundingClientRect().left - sc.getBoundingClientRect().left - 40
        sc.scrollTo({ left: sc.scrollLeft + delta, behavior: "smooth" })
        window.setTimeout(() => { isProgrammaticScroll.current = false }, 600)
    }
    const handleListScrollH = () => {
        if (isProgrammaticScroll.current) return
        const sc = scrollRef.current
        if (!sc) return
        const scLeft = sc.getBoundingClientRect().left
        // Active = top-most category of the left-most column that has scrolled into view.
        let best: { key: string; left: number; top: number } | null = null
        for (const s of sections) {
            const el = sectionEls.current[s.key]
            if (!el) continue
            const r = el.getBoundingClientRect()
            const left = r.left - scLeft
            if (left <= 48 && (!best || left > best.left || (left === best.left && r.top < best.top))) {
                best = { key: s.key, left, top: r.top }
            }
        }
        setActiveKey(best?.key ?? sections[0]?.key ?? "")
    }

    return (
        <>
        {/* Click-outside backdrop — closes the panel. Sits just under the panel
            (zIndex 19); the panel (zIndex 20) covers everything except the 1vw gap
            on the right, so the only clickable backdrop area is that gap. */}
        <div
            onClick={onClose}
            style={{
                position: "absolute", inset: 0, zIndex: 6,
                pointerEvents: isOpen ? "auto" : "none",
            }}
        />
        <div style={{
            // sm: fill full width (no gap); lg: keep the 10vw peek of map on the right
            position: "absolute", top: 0, bottom: 0, left: 0, right: isSm ? 0 : "10vw",
            background: C.cygnus,
            borderRadius: 0,
            // 1px inner border around the whole panel (both sm + lg). box-sizing:
            // border-box keeps it inset rather than growing the panel.
            border: `1px solid ${C.salix}`,
            boxSizing: "border-box",
            zIndex: 7,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            transform: isOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: isOpen ? "auto" : "none",
        }}>
            {/* Nav bar */}
            <div style={{
                position: "relative",
                height: isSm ? 64 : 100, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                paddingLeft: 60,
                borderBottom: `1px solid ${C.salix}`,
                boxSizing: "border-box",
            }}>
                {(() => {
                    const hasFilters = pendingFilters.park !== null || Object.values(pendingFilters.fields).some(v => v.length > 0) || Object.values(layerToggles).some(v => v === true)
                    return (hasFilters && SHOW_RESULT_COUNT) ? (
                        <p style={{ margin: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 16, color: "#000" }}>
                            <strong style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>{resultCount}</strong>
                            {" results available"}
                        </p>
                    ) : <div />
                })()}
                <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
                    {(() => {
                        const hasFilters = pendingFilters.park !== null || Object.values(pendingFilters.fields).some(v => v.length > 0) || Object.values(layerToggles).some(v => v === true)
                        return (<>
                            <button
                                onClick={hasFilters ? onClear : undefined}
                                onMouseEnter={() => hasFilters && setHoveredBtn("clear")}
                                onMouseLeave={() => setHoveredBtn(null)}
                                style={{
                                    width: isSm ? "auto" : 240, height: "100%",
                                    padding: isSm ? "0 24px" : 0,
                                    borderRadius: 80, border: `1px solid ${hasFilters ? C.salix : C.disabled}`,
                                    background: hasFilters ? (hoveredBtn === "clear" ? C.cygnusHover : C.cygnus) : "transparent",
                                    fontFamily: "'IBM Plex Mono', monospace", fontSize: isSm ? 18 : 28, fontWeight: 500,
                                    color: hasFilters ? C.salix : C.disabled,
                                    cursor: hasFilters ? "pointer" : "default",
                                    transition: "background 0.15s ease",
                                }}
                            >
                                CLEAR
                            </button>
                            <button
                                onClick={hasFilters ? onApply : undefined}
                                onMouseEnter={() => hasFilters && setHoveredBtn("apply")}
                                onMouseLeave={() => setHoveredBtn(null)}
                                style={{
                                    width: isSm ? "auto" : 240, height: "100%",
                                    padding: isSm ? "0 24px" : 0,
                                    borderRadius: 0, border: `1px solid ${hasFilters ? C.salix : C.disabled}`,
                                    background: hasFilters
                                        ? (hoveredBtn === "apply" ? C.salixHover : C.salix)
                                        : "transparent",
                                    fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
                                    color: hasFilters ? C.cygnus : C.disabled,
                                    cursor: hasFilters ? "pointer" : "default",
                                    transition: "background 0.15s ease",
                                    display: "flex", flexDirection: "column",
                                    alignItems: "center", justifyContent: "center", gap: 4,
                                }}
                            >
                                {/* Line 1 — main label */}
                                <span style={{ fontSize: isSm ? 18 : 28, fontWeight: 500, lineHeight: 1 }}>
                                    APPLY
                                </span>
                                {/* Line 2 — result count. Animates in/out when filters
                                    toggle; the number re-animates on every change. */}
                                {/* lg only — on sm the count moves to the footer. */}
                                <AnimatePresence initial={false}>
                                    {hasFilters && !isSm && (
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
                        </>)
                    })()}
                    <div
                        onClick={onClose}
                        style={{
                            // Pinned to the far-left end of the nav bar (style-only;
                            // pulled out of the button-group flow). Divider now sits
                            // on its right edge.
                            position: "absolute", left: 0, top: 0,
                            width: isSm ? 64 : 100, height: "100%",
                            borderRight: `1px solid ${C.salix}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer",
                        }}
                    >
                        {/* iconoir: nav-arrow-left */}
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                            <path d="M15 6L9 12L15 18" stroke={C.salix} strokeWidth="0.5" strokeLinecap="butt" strokeLinejoin="miter" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* ── lg: vertical index (like sm) + horizontal multi-column flow ── */}
            {!isSm && (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    {/* Left index — fixed; same look/behavior as sm */}
                    <div style={{
                        flexShrink: 0, width: "16vw",
                        borderRight: `1px solid ${C.salix}`,
                        overflowY: "auto",
                    }}>
                        {sections.map(s => {
                            const active = effectiveActive === s.key
                            return (
                                <button
                                    key={s.key}
                                    onClick={() => scrollToSectionH(s.key)}
                                    style={{
                                        display: "block", width: "100%",
                                        padding: "18px 16px", textAlign: "left",
                                        background: active ? C.cygnusHover : "transparent",
                                        border: "none",
                                        fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 700,
                                        fontSize: 14, color: C.salix,
                                        cursor: "pointer", whiteSpace: "nowrap",
                                        transition: "background 0.15s ease",
                                    }}
                                >
                                    {s.title}
                                </button>
                            )
                        })}
                    </div>

                    {/* Right pane — REAL columns (flex row), scrolls HORIZONTALLY.
                        Each column is a fixed-width <div> with a right border; whole category
                        boxes are packed into columns by the measure pass above. */}
                    <div
                        ref={scrollRef}
                        onScroll={handleListScrollH}
                        style={{
                            flex: 1, minWidth: 0, height: "100%",
                            display: "flex", flexDirection: "row",
                            overflowX: "auto", overflowY: "hidden",
                        }}
                    >
                        {/* Before the first measure pass, render everything in one column so the
                            boxes exist (at column width) to be measured; then they get packed. */}
                        {(columns.length ? columns : [sections.map(s => s.key)]).map((colKeys, ci) => (
                            <div
                                key={ci}
                                style={{
                                    // Fill the pane evenly when columns fit; never below 260px
                                    // (then the row overflows and scrolls horizontally) — wide
                                    // enough for the option labels to sit on one line.
                                    flex: "1 1 260px", minWidth: 260, height: "100%",
                                    borderRight: `1px solid ${C.salix}`,
                                    boxSizing: "border-box",
                                    display: "flex", flexDirection: "column",
                                    // Scroll the WHOLE column vertically. Packing balances
                                    // categories across columns, but if a column's stacked
                                    // boxes still overrun the height, this keeps every item
                                    // reachable instead of clipping the tail.
                                    overflowX: "hidden", overflowY: "auto",
                                }}
                            >
                                {colKeys.map((key, ki) => {
                                    const s = sections.find(x => x.key === key)
                                    if (!s) return null
                                    const active = flashKey === s.key
                                    return (
                                        <div
                                            key={s.key}
                                            ref={el => { sectionEls.current[s.key] = el }}
                                            style={{
                                                // Natural height — the parent column scrolls.
                                                flexShrink: 0,
                                                // Divider between stacked categories — but NOT on the
                                                // first box (the container's top border already lines
                                                // the column top, so a top border here would double it).
                                                borderTop: ki === 0 ? "none" : `1px solid ${C.salix}`,
                                                background: active ? C.cygnusHover : "transparent",
                                                padding: "16px 20px 8px 20px",
                                                boxSizing: "border-box",
                                                transition: active
                                                    ? "background 0.12s ease"
                                                    : "background 0.9s ease-out",
                                            }}
                                        >
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
                                                    py={12}
                                                />
                                            ))}
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── sm: chip bar + two-pane (index | unified list) ── */}
            {isSm && (
                <>
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
                                            <span style={{
                                                fontFamily: "'IBM Plex Mono', monospace",
                                                fontSize: 13, fontWeight: 500, color: C.salix,
                                                padding: "0 8px 0 16px", whiteSpace: "nowrap",
                                            }}>
                                                {chip.label}
                                            </span>
                                            <ChipRemoveButton onRemove={chip.onRemove} size={40} iconSize={12} />
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
                            background: C.cygnus,
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
                                    }}
                                >
                                    {s.items.map(item => (
                                        <FilterItem
                                            key={item.key}
                                            label={item.label}
                                            selected={item.selected}
                                            onToggle={item.onToggle}
                                            py={16}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer — centered result count (sm only).
                        Same treatment + animation as the lg APPLY count. */}
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
                </>
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

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, breakInside: "avoid", marginBottom: 48 }}>
            <p style={{
                margin: 0,
                font: "700 20px/1.2 'IBM Plex Sans', sans-serif",
                color: "#000",
            }}>
                {title}
            </p>
            {children}
        </div>
    )
}

function FilterItem({ label, selected, onToggle, py = 8, px }: { label: string; selected: boolean; onToggle: () => void; py?: number; px?: number }) {
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
                cursor: "pointer", textAlign: "left",
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
addPropertyControls(ParkMap, {})
