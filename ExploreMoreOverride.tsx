// ExploreMoreOverride.tsx — Framer code override (NOTE / reference file)
// ============================================================================
// Wakes up the ParkMap's live Mapbox map. ParkMap starts as a cheap
// static-image "facade" and only creates the (billable) Mapbox map once
// activated — by an internal click, OR by the `parkmap:activate` window event
// this override fires.
//
// SCOPE: this override ONLY loads the map. It does NOT touch the frame size —
// the map's layout / expansion is handled entirely in the Framer UI (variants,
// interactions, etc.). ParkMap's ResizeObserver adapts the map to whatever size
// the frame ends up at, so you don't need to coordinate anything here.
//
// This file is NOT imported by the app or the dev-harness. It's a reference you
// paste into Framer as a Code Override. (It imports from "framer", which only
// resolves inside Framer.)
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO USE IN FRAMER
// 1. In your Framer project: Assets ▸ Code ▸ New Override file, paste this in.
// 2. Select your button → Override dropdown → pick `ActivateMap`.
//    Tapping it now fires `parkmap:activate`, and ParkMap loads the real map.
//
// The matching listener already lives in ParkMap.tsx (SECTION: EXTERNAL ACTIVATION):
//   window.addEventListener("parkmap:activate", () => setMapActive(true))
// ─────────────────────────────────────────────────────────────────────────────

import type { Override } from "framer"

// Keep this in sync with the event name ParkMap listens for.
const ACTIVATE_EVENT = "parkmap:activate"

/** Apply to your button — tapping it loads (wakes up) the live Mapbox map. */
export function ActivateMap(): Override {
    return {
        // onTap is the Framer-idiomatic handler (Framer Motion). For a plain DOM
        // element you can use onClick instead — both work.
        onTap() {
            window.dispatchEvent(new CustomEvent(ACTIVATE_EVENT))
        },
    }
}
