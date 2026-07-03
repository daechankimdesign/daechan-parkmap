# Chromium Project Log

A running record of changes to this project, written for a non-technical reader.
Most recent entries are at the top.

---

## 2026-06-16 — Carousel: bottom offset reduced to 20px (copy148)

**What changed:** The POI card carousel now sits 20px above the bottom of the map (was 40px), so the cards rest a little lower, closer to the bottom edge.

---

## 2026-06-09 — POI dots: zoom-based scaling with half size at z12, full at z14 (copy147)

**What changed:** Added a zoom 12 stop at half the full size. Dots reach full size at zoom 14 (moved from 13). A small floor at zoom 8 keeps dots faintly visible when very zoomed out.

---

## 2026-06-09 — POI dots: move to top of layer stack so labels still win (copy146)

**What changed:** POI dot layers are now moved to the very top of the Mapbox layer array (no beforeId). Mapbox GL renders symbol/label layers in a separate post-processing pass regardless of stack position, so labels always appear above circles. This puts dots above the base style's hatch fill pattern and all other non-label layers.

---

## 2026-06-09 — POI dots: always float above all map layers except labels (copy145)

**What changed:** After all park fill layers are added (in the async idle callback), `moveLayer` re-floats `poi-dot` and `poi-dot-inner` to just below the first symbol/label layer. This guarantees POI dots are always on top of park fills, hydrography, and any other non-label layers regardless of add order.

---

## 2026-06-08 — Filter park list: fixed display order (copy144)

**What changed:** Parks in the filter sheet now appear in the specified order: Charlesgate → Back Bay Fens → The Riverway → Olmsted Park → Jamaica Pond → Arborway → Arnold Arboretum → Franklin Park. Any parks not in the list fall to the end alphabetically.

---

## 2026-06-08 — Filter button: added trailing "Filter" text label (copy143)

**What changed:** The circular filter button now shows the word "Filter" to the right of the icon. Button changed from fixed 72×72px circle to a pill shape with horizontal padding.

---

## 2026-06-08 — Carousel: only card hit areas are interactive, not empty scroll space (copy142)

**What changed:** The scroll track div now has `pointerEvents: none` always. Each visible card wrapper opts back in with `pointerEvents: auto` and `cursor: grab`. Drag handlers moved from the scroll track to each card wrapper. Empty carousel space (between/around cards, and when carousel is hidden) never intercepts map clicks or shows the grab cursor.

---

## 2026-06-08 — Carousel: outer wrapper always pointer-events none, inner scroll track opts in (copy141)

**What changed:** The carousel outer wrapper (full-width, position absolute) now always has `pointerEvents: none` so it never intercepts map clicks — including clicks on park labels that fall in the carousel's vertical zone. The inner scrollable track opts back in to `pointerEvents: auto` only when the carousel is visible and no POI is selected.

---

## 2026-06-08 — Carousel: no grab cursor when hidden behind POI detail panel (copy140)

**What changed:** The carousel's outer wrapper now forces `cursor: default` when a POI is selected (carousel hidden). Previously the inner scrollable div's `cursor: grab` style bled through even though pointer-events were disabled, showing a grabbing hand over empty space.

---

## 2026-06-08 — POI dot hover: 10% larger on hover (copy139)

**What changed:** Secondary (non-active) POI dot hover radius increased by 10% — from 3→3.3px at zoom 8 and 8→8.8px at zoom 13.

---

## 2026-06-08 — Filter sheet: revert to CSS 3-column vertical-scroll layout (copy138)

**What changed:** Removed the horizontal-scroll flex row and restored the original `columnCount: 3` CSS columns layout. Sections flow naturally across three columns and the sheet scrolls vertically if there are too many items. Also restored `breakInside: "avoid"` and `marginBottom: 48` on FilterSection so sections don't split mid-column.

---

## 2026-06-08 — Fix POI dots invisible: zoom interpolate must be outermost expression (copy137)

**What changed:** POI dots were not rendering because the `z()` helper was generating `["interpolate", ["zoom"], ...]` expressions nested inside `["case", ...]`. Mapbox GL requires zoom interpolations to be the outermost expression. Fixed by restructuring so `["interpolate", ["zoom"], ...]` wraps the `["case", ...]` for both the outer dot radius and the inner bullseye dot radius.

---

## 2026-06-08 — Filter chip: only shows when park selected via filter panel (copy136)

**What changed:** Tapping a park name label on the map zooms in and fills the park boundary, but no longer causes the filter chip to appear in the top bar. The chip now only appears when a park is selected through the filter panel (either by tapping the park row or pressing Apply). A new `parkFromFilter` boolean state tracks this distinction throughout all the places where `focusedPark` is set or cleared.

---

## 2026-06-08 — Camera padding: two named constants, set via setPadding on load

**What happened:** Removed padding from the Map constructor (caused slow tile loading). Defined two module-level constants — `DEFAULT_PAD` (bottom: 360, for the carousel) and `POI_OPEN_PAD` (right: 480, for the detail overlay) — and applied them consistently across all camera moves. `setPadding(DEFAULT_PAD)` is called immediately on map load so the initial view already clears the carousel.

---

## 2026-06-08 — Initial map view: center in top ⅔ above carousel

**What happened:** Added `padding: { bottom: 360 }` to the Mapbox map constructor so the default center loads in the top ⅔ of the screen above the carousel. All flyTo-to-default calls also now carry the same padding so returning to the default view is consistent.

---

## 2026-06-08 — Fix POI dot zoom scaling: interpolate must be outermost expression

**What happened:** Mapbox GL requires zoom-based interpolate to be the outermost expression in a paint property — nesting it inside a feature-state case silently breaks rendering. Restructured so interpolate wraps the case expressions, with small sizes at zoom 8 and full sizes at zoom 13.

---

## 2026-06-08 — POI dots scale down below zoom 13

**What happened:** All POI dots (Simple and regular, all states) now interpolate linearly from small sizes at zoom 8 to full size at zoom 13, then stay fixed above zoom 13. A `z(small, full)` helper in the layer definition makes it easy to adjust any individual size. To change the breakpoint zoom, edit the `13` in each `z()` call.

---

## 2026-06-08 — Simple POI active state: 10px radius (up from 7px)

**What happened:** Simple POI active state grows from 7px to 10px radius, keeping the white center dot.

---

## 2026-06-08 — Simple POI: hide Learn More, add white center dot on active

**What happened:** Learn More button is now hidden for Simple POIs. Simple POI active state shows the same 7px solid dot but with a 2px white center dot (using the existing inner-dot layer). Regular POI active state (18px bullseye) is unchanged.

---

## 2026-06-08 — Fix Simple POI dots not appearing on map

**What happened:** Simple POIs were being excluded from `filteredPOIs` which is also used to populate the map source, so their dots never rendered. Fixed by introducing `carouselPOIs` (filteredPOIs minus Simple) used only for the carousel and filter result count. The map source continues to use the full `filteredPOIs` so Simple dots appear on the map.

---

## 2026-06-08 — POI Mode "Simple": small dot, excluded from carousel

**What happened:** Added support for a "POI Mode" Airtable field. When set to "Simple", the POI renders as a 14px (7px radius) solid salix dot with no stroke and no hover/active state changes, and is excluded from the carousel. Regular POIs are unaffected. The `poiMode` property is included in the GeoJSON feature so Mapbox paint expressions can read it directly.

---

## 2026-06-08 — Park hover fill: label only, not entire polygon boundary

**What happened:** Removed mouseenter/mouseleave handlers from `park-fill-hit`. The hover fill (10% salix) now only activates when hovering the park name label, not when mousing over the park polygon area.

---

## 2026-06-08 — POI centering: use Mapbox padding (handles zoom changes correctly)

**What happened:** Replaced the project/unproject centering helper with `padding: { right: 480 }` in `easeTo`. Mapbox's padding handles zoom changes correctly by design, whereas the pixel-math approach broke when zoom changed simultaneously. The previous park polygon click handler was overriding the POI centering — now that it's removed, padding works as intended.

---

## 2026-06-08 — Remove park polygon click-to-zoom; label/filter only

**What happened:** Removed the click handler on `park-fill-hit` that was intercepting taps on the park polygon and zooming to the park. Park zoom now only triggers when tapping a park name label on the map or selecting a park in the filter menu.

---

## 2026-06-08 — Fix close/learn-more buttons showing hover state on panel open

**What happened:** Replaced `onMouseEnter`/`onMouseLeave` + React state with `onMouseOver`/`onMouseOut` directly mutating `e.currentTarget.style.background`. The browser only fires these when the mouse actually moves over the element, so the panel sliding in under a stationary cursor no longer triggers the hover appearance.

---

## 2026-06-08 — Fix POI centering: project/unproject to compute exact camera center

**What happened:** Replaced the unreliable `offset` parameter with an `easeToVisible` helper that uses `map.project()` / `map.unproject()` to compute the exact geographic center that places the POI dot at the center of the visible area (full width minus the 480px overlay). The overlay width is controlled by `OVERLAY_W = 480` inside the helper. Stored in `easeToVisibleRef` so the carousel card handler can use it too.

---

## 2026-06-08 — Fix POI centering: use offset instead of padding

**What happened:** Replaced `padding: { right: 480 }` with `offset: [-240, 0]` on POI `easeTo` calls. The offset shifts the camera's anchor point 240px left (half the overlay width), placing the POI dot in the exact center of the visible map area. Closing the panel resets the offset to `[0, 0]`.

---

## 2026-06-08 — Park fitBounds: account for carousel at bottom

**What happened:** When zooming to a park, the bottom padding is now 360px (up from 220) so the park polygon fits in the top ⅔ of the screen above the carousel. A `CAROUSEL_PAD` constant in `zoomToPark` makes this easy to adjust.

---

## 2026-06-08 — Remove debug panel; fix POI centering in visible map area

**What happened:** Removed the on-screen debug overlay and all `setDebugLines` calls (errors now go to `console.error`/`console.warn`). Fixed POI centering when the detail panel is open: all `easeTo`/`flyTo` padding calls now pass all four sides explicitly (`{ top: 0, bottom: 0, left: 0, right: 480 }` when open, all zeros when closed) so accumulated padding from park-zoom fitBounds no longer offsets the centering.

---

## 2026-06-08 — Park fill z-order: below enc-hydrography; added inline editing notes

**What happened:** All three park fill layers (hit, hover, selected) are now inserted before `enc-hydrography` in the Mapbox style stack, placing them below water. A single `PARK_FILL_BEFORE_LAYER` constant controls this — change it to reorder all three fills at once. Added a block comment above the fill section explaining each layer's purpose and how to adjust opacity or z-order.

---

## 2026-06-08 — Park fill z-order fix + Charlesgate/Riverway hover via polygon hit layer

**What happened:** Fill layers now inserted before `poi-dot` so they render beneath POI dots and park labels. Added a transparent `park-fill-hit` layer covering all park polygons — this fires hover and click events when the user mouses over the polygon area directly, which fixes Charlesgate and The Riverway whose label symbols may not be in view. Clicking anywhere on a park polygon now also triggers zoom-to-park.

---

## 2026-06-08 — Park fill: 10% on hover, 15% on selected

**What happened:** Split the park fill into two layers — `park-fill-hover` (salix 10%) driven by mouseenter/mouseleave on park labels, and `park-fill-selected` (salix 15%) driven by focusedPark state. Both start hidden and update their filter to the relevant park title.

---

## 2026-06-08 — Add Charlesgate fallback + salix fill on selected park

**What happened:** Charlesgate is confirmed in the tileset as `Title: "Charlesgate"` but is too small to be returned by `querySourceFeatures` at the discovery zoom level. Added it as a hardcoded fallback with known bounds so it always appears in the filter list and responds to clicks. Also added a `park-fill-selected` fill layer (salix #1f2f16 at 10% opacity) that activates over the selected park's polygon whenever a park is focused via click or filter panel.

---

## 2026-06-08 — Fix "The Riverway" label click; debug Charlesgate missing

**What happened:** `findParkLayer` now strips a leading "The " before comparing, so clicking the "The Riverway" map label correctly matches the "Riverway" polygon entry. Also added a debug log for any label click that has no matching park, which will show Charlesgate's raw `Title` value so we can see why it's absent from the filter list.

---

## 2026-06-08 — Remove all park label hover effects — cursor change only

**What happened:** Removed the highlight layer and all applyParkHalo logic entirely. Hovering a park label now only changes the cursor to a pointer. Clicking still zooms to the park and filters POIs as before.

---

## 2026-06-08 — Fix park label highlight repeating along polygon edges

**What happened:** The highlight layer was inheriting `symbol-placement` from the original label layer, which uses `"line"` placement on polygon features — causing the label to repeat along every edge of the park polygon. Fixed by forcing `"symbol-placement": "point"` on the highlight layer so it renders once at the centroid.

---

## 2026-06-08 — Park label hover/active: text 2px larger, no halo or box

**What happened:** Simplified the hover/active state for park labels. The highlight layer now just renders the same label 2px larger than the default size, matching the original font, color, and halo exactly. No background box or special halo on hover — just the size bump. The original label is hidden for the target park while the highlight is shown.

---

## 2026-06-08 — Park label hover: cream background box on hovered/active park label

**What happened:** Confirmed the highlight symbol layer renders correctly when `text-field` is a simple `["get", "Title"]` expression (the earlier failure was due to `getLayoutProperty` returning a complex expression that didn't survive being passed to a new layer). Now the highlight layer: uses `["get", "Title"]` for text, copies font/size/anchor/offset/placement from the original label layer, starts with an empty filter (hidden), and on hover/active shows only the target park with a cream (`#f9f3f5`) halo of width 8 — giving the filled-box look from the design. The original label is hidden for that park only via a `match` expression on `text-opacity`.

---

## 2026-06-08 — Debug: test whether highlight symbol layer can render any text at all

**What happened:** Changed the `park-labels-highlight` layer to use a hardcoded `text-field: "TEST"` (instead of copying the expression from `getLayoutProperty`) and `filter: ["has", "Title"]` (match all park features) with no hover gating. If red "TEST" labels appear over every park polygon, it confirms the layer works and the problem was the text-field expression. If nothing appears, the symbol layer itself cannot render from this source/source-layer combination.

---

## 2026-06-08 — Filter panel: horizontal scroll instead of vertical overflow

**What happened:** Replaced the CSS `column-count: 3` layout with a horizontal flexbox row where each filter section is its own fixed-width (220px) column. The container scrolls horizontally (no scrollbar shown) when there are more sections than fit on screen, rather than growing vertically. The PARK section is always the first column.

---

## 2026-06-08 — Park label highlight: hide original label to eliminate z-order competition

**What happened:** Instead of fighting Mapbox's symbol z-ordering (which kept rendering the original on top), now hide the original label for the hovered/active park using setPaintProperty("text-opacity", ["match", ["get", "Title"], targetPark, 0, 1]). With the original label gone, the highlight layer renders exclusively with no competition, so the cygnus halo is visible.

---

## 2026-06-08 — Fix park label highlight z-order: insert before original layer

**What happened:** Mapbox GL symbol z-ordering is the reverse of regular layers — symbols from layers listed earlier in the style stack render ON TOP of later layers. The highlight layer was being added last (appended), so its symbols were rendering below the original layer and being hidden. Fixed by using addLayer(layer, slId0) to insert the highlight layer immediately before the original, so its symbols render on top.

---

## 2026-06-08 — Park label highlight: drop icon-text-fit, use halo on separate layer above original

**What happened:** icon-text-fit with raw image data wasn't stretching — the icon rendered as tiny 3px blocks. Replaced with a simple text-halo on the highlight layer (halo-width 8, blur 0, cygnus color). Because the highlight layer is above the original in the Mapbox layer stack, collision detection means only the highlight layer's version of the label renders at that position on hover/active — the original layer is never touched and all other labels keep their native halo.

---

## 2026-06-08 — Fix infinite loading: wrap highlight layer setup and idle callback in try/catch

**What happened:** The canvas getContext call and addLayer could throw in Framer's sandbox, crashing the map.on("load") callback before setMapLoaded(true) was ever reached. Switched addImage to use raw Uint8Array data (no canvas needed). Wrapped both the addImage/addLayer block and the idle callback body in try/catch so any failure is shown in the debug panel but setMapLoaded(true) always fires.

---

## 2026-06-08 — Park label highlight: canvas-drawn image + debug for layer existence

**What happened:** Switched from ImageData to a canvas element for addImage (more reliable cross-browser). Added debug lines to applyParkHalo showing whether the highlight layer exists and what arguments it's called with, so we can see if the filter is reaching the layer.

---

## 2026-06-08 — Park label highlight: bounding box via icon-text-fit, no halo

**What happened:** Replaced the text-halo approach entirely. A 1×1 solid cygnus ImageData is registered as "park-highlight-bg" and used as the icon-image on the highlight layer. Setting icon-text-fit:"both" and icon-text-fit-padding:[6,14,6,14] makes Mapbox stretch the image to exactly the label's text bounding box plus margins — a proper rectangle with no halo. The original park labels layer is never modified.

---

## 2026-06-08 — Park label highlight: separate overlay layer, never touch original

**What happened:** Replaced the broken setPaintProperty approach (which was clobbering the original halo for all labels) with a dedicated `park-labels-highlight` symbol layer added above the original. The original layer is never modified — it always shows with its native halo. The highlight layer copies the same layout properties (font, size, anchor, etc.) but uses a solid cygnus halo (width 10, blur 0). Its filter is updated on hover/active to match only the targeted park title, so only that one label gets the box. When nothing is hovered/active the filter matches nothing and the highlight layer is invisible.

---

## 2026-06-08 — Park label halo: preserve original style, add cygnus box on hover/active

**What happened:** The previous approach reset the halo to transparent when no park was highlighted, removing the original label styling. Now the original `text-halo-color`, `text-halo-width`, and `text-halo-blur` are read from the layer at load time and used as the fallback in the match expression. Non-highlighted labels always keep their original appearance; hovered or active labels get the cygnus background box on top of that.

---

## 2026-06-08 — Park label highlight via Mapbox text-halo (no React overlay)

**What happened:** Replaced the React tooltip overlay with a Mapbox `setPaintProperty` approach. On hover and when a park is active, a `match` expression is applied to `text-halo-color` and `text-halo-width` on the `emerald-necklace-labels` symbol layer, giving the targeted label a cream background box. Only the hovered/active label is highlighted; all others stay unchanged. Active state persists until the park is deselected. Works when selecting via the map label or the filter panel.

---

## 2026-06-08 — Exclude Justine Mee Liff Park; remove duplicate Parks section from filter columns

**What happened:** Added "justine mee liff park" to an exclusion list applied when setting park layers, so it never appears in the PARK filter list. Also added a guard in the merged filter-column section builder to skip any Airtable `Filter--Parks` or `Filter--Park` field — those were creating a duplicate PARKS heading in the right-side columns, since parks are already handled by the dedicated PARK section at the top.

---

## 2026-06-08 — Park label hover/active style + fix Riverway/Charlesgate click

**What happened:** The Riverway and Charlesgate weren't responding to clicks because the lookup was exact-match string equality — any casing or whitespace difference silently failed. Changed to case-insensitive trimmed comparison. Also switched from projecting polygon geometry coordinates (a nested array, not a point) to `e.lngLat` for tooltip positioning. Updated hover tooltip to match design: Canela Text Trial 20px, cream background, no border. Added active-state tooltip: when a park is focused via the filter panel or map click, the same tooltip shows at the park polygon center and tracks map panning/zooming.

---

## 2026-06-08 — Fix park labels: correct layer ID, Title property, querySourceFeatures for all parks

**What happened:** Debug revealed three root causes: (1) `CONFIG.parkLabelsLayerId` ("65ad24a2edf7804f4b43") is the source-layer name, not a style layer ID — the real layer ID is `emerald-necklace-labels`, now auto-detected; (2) the click/hover handlers read `e.features[0].properties.label` but the actual property is called `Title`; (3) the tileset has only polygon features (no separate Point markers), so Tilequery was useless. Replaced the whole approach: now uses `querySourceFeatures` after `fitBounds` + `idle` to load all polygon features, reads their `Title` property to build the park list and compute bounds in one pass. No more Tilequery.

---

## 2026-06-08 — Fix source detection: scan by tileset URL not source-layer suffix

**What happened:** The previous source-layer detection assumed the source-layer name inside the vector tiles matched the suffix of the tileset ID (`utqyswzwhi90`) — debug confirmed this was wrong (NONE FOUND). Now scans all style sources for one whose URL contains the full tileset ID (`adamatot.utqyswzwhi90`), then reads the actual source-layer name from the layers using it. Also temporarily removed the `geometry=point` filter from Tilequery so the debug panel shows all feature types in the tileset, helping confirm whether Point features with label data actually exist.

---

## 2026-06-08 — Add on-screen debug panel for park label diagnostics

**What happened:** Added a temporary green-on-black debug overlay (bottom-left of map) that shows: which Mapbox layers were found on the Emerald Necklace tileset, which layer IDs events are wired to, and exactly what the Tilequery API returned (feature count, raw properties of first result, park names found). Also switched Tilequery to use `geometry=point` to avoid the 50-result limit being filled by polygon features, and widened the property name search to try `label`, `title`, `name`, `labels`, `Title`, `Name`, `Label`.

---

## 2026-06-08 — Fix park label hover/click events not firing

**What happened:** The Mapbox event handlers for park label hover and click were broken — mouseenter, mousemove, and mouseleave were still wired to the hardcoded `CONFIG.parkLabelsLayerId` instead of iterating over all detected layer IDs, and the `forEach` callback was never properly closed. Rewrote the section so all four events (click, mouseenter, mousemove, mouseleave) are registered on every layer ID in `allParkLabelIds` inside a clean `forEach`. This means hover tooltips and click-to-zoom-and-filter will now work regardless of which Mapbox layer ID the park label symbols actually live on.

---

## 2026-06-07 — PARK section moved above filter columns

**What happened:** The PARK section in the filter panel now renders as a full-width row above the three-column layout rather than inside the columns. Parks flow horizontally with wrapping so they don't crowd the column grid.

---

## 2026-06-07 — Selecting a POI zooms to at least level 14

**What happened:** Clicking a POI pin or carousel card now zooms the map to level 14 if the current zoom is less than 14. If already zoomed in further, the zoom level is preserved.

---

## 2026-06-07 — Park labels: hardcoded layer ID, hover tooltip, Tilequery for filter list

**What happened:** Confirmed the park labels symbol layer ID is `65ad24a2edf7804f4b43` — added to CONFIG so there's no guesswork. Click zooms to the park polygon (fitBounds) and filters POIs. Hover shows a cream Boldonse tooltip above the label, same pattern as POI hover. PARK filter list populated via Tilequery API (server-side, reliable) using Point features with a `label` property in the Emerald Necklace tileset.

---

## 2026-06-07 — Park discovery: Tilequery API replaces querySourceFeatures for park names

**What happened:** Replaced the unreliable `querySourceFeatures` approach for populating the PARK list with Mapbox's Tilequery API — a server-side query that returns feature data without needing any tiles loaded client-side. Phase 1 fetches tileset metadata to compute a center + radius, then queries all Point features with a `label` property to populate the filter panel immediately. Phase 2 still attempts `querySourceFeatures` (tiles force-loaded via fitBounds behind the loading screen) to get polygon bounds for accurate zoom; if that fails, it falls back to a small bbox around each point label.

---

## 2026-06-07 — Park discovery: force-load all tiles before querying; filter panel radius removed

**What happened:** Fixed the core reliability problem — `querySourceFeatures` only returns features in tiles the renderer has loaded. The fix: fetch the tileset's own bounding box from the Mapbox metadata API, silently jump the map to cover that area (while still behind the loading screen), wait for idle, query all features, then snap back to the default position before showing the map. This guarantees 100% of tiles are loaded before querying. Also removed the right-side border radius from the filter panel.

---

## 2026-06-07 — Park layer discovery fixed: source detected by source-layer name

**What happened:** Fixed two bugs from the initial tileset implementation. Source detection now finds the right Mapbox source by matching the source-layer name (the part after the dot in the tileset ID: `utqyswzwhi90`) rather than scanning source URLs, which is far more reliable for both standalone and composite sources. Park label click/hover now auto-detects all symbol layers from the tileset so no layer ID needs to be hardcoded. Added a retry if `querySourceFeatures` returns zero features on first idle.

---

## 2026-06-07 — Park layers now driven by Emerald Necklace tileset

**What happened:** Replaced the `Toggle-Parks--XXX` naming convention with runtime discovery from the `adamatot.utqyswzwhi90` tileset already in the Mapbox style. On map load the code finds the tileset source, waits for idle, then queries polygon features using their `Title` field to build the park list and compute bounding boxes. Clicking a park label on the map now triggers the same zoom + filter behaviour as selecting a park in the filter panel. Cursor changes to pointer on hover over park labels.

---

## 2026-06-07 — Hovered and selected POI dots render on top

**What happened:** POI dots now sort themselves so the hovered dot is above all others, and the selected (active) dot is on top of everything. Achieved by reordering GeoJSON features — Mapbox renders later features on top within the same layer.

---

## 2026-06-07 — Layer toggles now unlock CLEAR/APPLY buttons

**What happened:** Selecting a Mapbox layer toggle now counts as an active filter, enabling the CLEAR and APPLY buttons. CLEAR also resets all layer toggles back to off.

---

## 2026-06-07 — Mapbox toggle layers merge with Airtable filter sections by category name (copy76)

**What happened:** Reworked the toggle-layer system so Mapbox layers named `Toggle-{Category}--{Name}` automatically merge into the same filter section as Airtable's `Filter--{Category}` fields, matched case-insensitively. For example, a Mapbox layer `Toggle-Activities--Bike-Paths` will appear alongside Airtable's `Filter--Activities` items under one "ACTIVITIES" heading. State renamed from `activityLayerNames`/`activityToggles` to `toggleLayersByCategory`/`layerToggles` to reflect the generalised approach.

---

## 2026-06-07 — Mapbox toggle layers merge with Airtable filter sections by category name

**What happened:** The Activities section (and any future category) now merges automatically. If a Mapbox layer is named `Toggle-Activities--Bike-Paths` and Airtable has a `Filter--Activities` field, they'll both appear under one "ACTIVITIES" heading. Matching is case-insensitive. The internal naming convention changed from `Toggle-Activity--` to `Toggle-{Category}--{Name}` so the category name can match any Airtable section.

---

## 2026-06-07 — Toggle-Activity--XXXX reworked: detection from Mapbox layer IDs

**What happened:** The Toggle-Activity feature was reworked. Instead of reading from Airtable fields, the map now scans its own Mapbox style on load for any layer whose ID starts with `Toggle-Activity--`. Those layers are hidden by default and appear as **deselected** radio-button items under "ACTIVITIES" in the filter panel (same UI as other filter sections). Selecting one makes that layer visible; deselecting hides it again. The old Airtable-field detection and the on-by-default behaviour are removed.

---

## 2026-06-07 — Preview-Parks--XXXX: park boundary layers shown for 4s on load

**What happened:** New Airtable field naming convention: any field named `Preview-Parks--XXXX` (where XXXX matches a Mapbox layer ID) causes that layer to be shown automatically for 4 seconds after the map and data finish loading, then hidden. Intended for park boundary overlays that orient the user on first load.

---

## 2026-06-07 — Toggle-Activity--XXXX: map layer toggles in filter panel

**What happened:** New Airtable field naming convention: any field named `Toggle-Activity--XXXX` (where XXXX matches a Mapbox layer ID) is automatically detected at runtime and adds a toggle switch to an "ACTIVITIES" section in the filter panel. Toggling it on/off calls `map.setLayoutProperty(XXXX, 'visibility', ...)`. All activity layers default to ON. The toggle uses a sliding pill UI (dark green when on, grey when off).

---

## 2026-06-05 — Configurable site base URL for slug links

**What happened:** Added `siteBaseUrl` to the CONFIG object at the top of the file. The LEARN MORE button now builds its href as `siteBaseUrl + /poi/ + slug`. To switch domains, change the one line in CONFIG — all slug links update automatically. Currently set to `https://large-shape-151756.framer.app`.

---

## 2026-06-05 — POI overlay: action bar overlaps photo, bordered buttons

**What happened:** Action bar now uses `marginTop: -40` to float up over the bottom of the hero photo. X button is a true circle (`borderRadius: 50%`) with salix border. LEARN MORE pill has matching salix border. Both on cream background. Content section below has `borderRadius: 32px 32px 0 0`. Panel outer background set to lemna so the gap between action bar and content reads as the map background peeking through.

---

## 2026-06-05 — POI overlay: action bar style tweaks

**What happened:** LEARN MORE button now 16px regular weight. POI name now 16px. X and LEARN MORE buttons both have borderRadius 32px with a cygnusHover background fill; action bar uses 8px padding/gap so the rounded buttons are visible against the photo.

---

## 2026-06-05 — POI overlay: action bar replaces blue section

**What happened:** Removed the blue (Scarboro) description section from the POI detail overlay. Replaced with a full-width action bar sitting at the photo/cream boundary: a 72px square X (close) button on the left, and a LEARN MORE text button filling the remaining width on the right. Both sit in the cream (`cygnus`) background with a thin divider. POI name moved above the info rows in the cream section (Boldonse 20px uppercase). No more floating close button over the photo.

---

## 2026-06-05 — Fix Airtable field name mappings

**What happened:** Corrected two field name mismatches in the FIELDS constant. `park` now pulls from `"Park Name"` (previously `"Park"`, which returned a linked record ID like `recXXXXX` instead of a readable name). `accessibility` now pulls from `"Accessibility Notes"` (previously `"Accessibility"`).

---

## 2026-06-04 — POI detail panel fully built out

**What happened:** Expanded the POI detail panel to match the full reference design. New sections added (all optional — only render if the Airtable field is populated): Headline, info table (Park, Address, Neighborhood, Hours, Accessibility), second photo with caption/credits, About + Explore For two-column section, Did You Know block, FAQ accordion, and Notices section (lemna background). New Airtable fields supported: Headline, Neighborhood, Hours, Accessibility, About, Did You Know, Photo 2, Photo 2 Caption, Photo 2 Credits, FAQ, Notice, Notice Date.

---

## 2026-06-04 — Filter panel: sections now stack vertically within 3 columns

**What happened:** Changed filter body from a CSS grid (which flowed left-to-right) to CSS `column-count: 3` so sections stack on top of each other within each column. Each FilterSection has `break-inside: avoid` to prevent splitting across columns.

---

## 2026-06-04 — Close POI overlay on map drag; active filter chips

**What happened:** Dragging the map now closes the POI detail panel (only for user-initiated drags, not programmatic moves). Active filters now appear as pill chips next to the filter button at the top left — each chip shows the filter value and an X button to remove it individually.

---

## 2026-06-04 — POI overlay redesigned to match Figma 4022-734

**What happened:** Full overlay redesign. Three-layer structure: hero photo, blue (#79C1F9) description section overlapping photo (rounded top corners, Canela serif heading), cream info section overlapping blue (POI name in Boldonse + LEARN MORE button, info rows with label stacked above value). Close button moved to top-left. Address row is a clickable link. New Airtable fields supported: Description, Neighborhood, Hours, Accessibility.

---

## 2026-06-04 — POI card, filter chips, shadow, overlay fixes

**What happened:** POI card rebuilt to match updated Figma (arch container, no plus button, info panel at 68% from top, white bg on hover). Filter chips now 68px tall matching filter button height. Drop shadow removed from filter button. Opening filters now closes any open POI overlay.

---

## 2026-06-04 — Active filter chips appear next to filter button

**What happened:** When filters are active, pill chips appear in a scrollable row next to the filter button. Each chip shows the filter value and an X to remove it individually. Park filter chip appears first, field filter values after.

---

## 2026-06-04 — POI pins suppress overlapping map labels

**What happened:** Added an invisible symbol layer (`poi-label-suppress`) at each POI position. Symbol layers participate in Mapbox's collision detection system (circle layers don't), so this causes any map text labels that overlap a POI dot to be automatically hidden.

---

## 2026-06-04 — POI pin active state: bullseye, hover label border removed

**What happened:** Active pin is now a large salix circle (radius 18) with a small cream dot in the center (radius 5) via a second `poi-dot-inner` layer — matching the bullseye reference. Hover label border removed.

---

## 2026-06-04 — POI pin: hover fill darkens, label gets solid cream box

**What happened:** Hover state on `poi-dot` now fills with `cygnusHover` (#e5dee0) instead of staying plain cream. The hover name label is now a solid cream box with a salix border — matching the reference — instead of the faint translucent tint.

---

## 2026-06-04 — POI card: taller pill image, plus button no longer grows on hover

**What happened:** Image is now 20% taller than wide (pill shape) with the same border-radius as before, giving a rounder top. Plus button no longer grows on hover — it stays the same size and only changes background color to cygnusHover.

---

## 2026-06-04 — POI card: circle + overlapping info panel (correct structure)

**What happened:** Rebuilt POI card as two separate layers matching the reference: (1) a full circle photo (borderRadius 50%, overflow hidden, zIndex 1), and (2) a cream info panel that sits ON TOP of the circle's bottom portion (zIndex 2). A 20px sliver of the circle peeks out below the panel. No overflow clipping on the outer wrapper, so the panel isn't cut off.

---

## 2026-06-04 — POI card rebuilt to match Figma arch shape

**What happened:** Completely rewrote the POI card geometry to match Figma node 3942-604 exactly. The card is no longer a separate circle + info panel — it's one container (263×291 proportions, `borderRadius: 194px`, `overflow: hidden`) that clips everything into the arch/vault shape. The photo fills the full card and is clipped by the arch. The info panel is absolutely positioned at Figma's exact percentages (top 65.29%, bottom 4.47%). No more z-index layering issues. Active selection ring now uses the same arch radius.

---

## 2026-06-04 — Fix POI card layering (info panel now visible)

**What happened:** The cream info panel (tag + name + plus button) was hidden behind the circle photo because their z-index values were inverted. Fixed by swapping: circle is now z-index 1, info panel is z-index 2. The 24px peek of the circle below the panel is now visible as intended.

---

## 2026-06-03 — Clicking a POI pin centers the map on it

**What happened:** Tapping a POI pin now smoothly pans the map to center on that pin (400ms ease).

---

## 2026-06-03 — Card shape restored, carousel hides on selection, map centers in visible area

**What happened:** POI card geometry fixed — circle diameter = card width, info panel sits inside the circle with a 24px peek of the circle visible below it. Carousel fades out when a POI is selected. Map uses Mapbox padding to center the pin in the left portion of the viewport (excluding the 480px detail panel). Closing the panel restores full-width centering.

---

## 2026-06-03 — POI detail panel slides in from right on selection

**What happened:** Selecting a POI pin or card now opens a detail panel that slides in from the right (480px wide, 0.4s ease). It shows the hero photo, POI tag, name, and all available info fields (Park, Address, any Filter-- fields). A Get Directions button links to Google Maps. The close X button (top-right of the panel) dismisses it.

---

## 2026-06-03 — POI card: full circle image overlapping info panel

**What happened:** Card photo is now clipped to a full circle (not just an arched top). The circle spans the full card width and overlaps the cream info panel below it, with the bottom of the circle peeking out beneath. Tag text is now IBM Plex Mono regular weight. Active selection ring matches the circle shape.

---

## 2026-06-03 — Removed sidebar, full-screen map layout

**What happened:** The dark green sidebar was removed. The map now fills the full component. A floating filter button sits top-left and a floating close (X) button sits top-right, both overlaying the map. The POI carousel remains at the bottom. Park selection now lives entirely inside the filter panel.

---

## 2026-06-03 — POI pins redesigned to match Figma (cream fill, HTML tooltip)

**What happened:** Pins now use cream fill with dark stroke by default and on hover (growing from 8→10px radius). Selected pins are solid dark green (12px). The hover tooltip is now an HTML overlay — a cream box with dark border and IBM Plex Mono text — positioned above the pin, matching the Figma reference exactly.

---

## 2026-06-03 — POI pins redesigned to match Figma

**What happened:** Map pins now have 3 states matching the Figma design — default (outlined circle, no fill), hover (filled dark green, slightly larger, with POI name label floating above), selected (largest filled dark green circle). Label uses IBM Plex Mono Medium with a lemna-tinted halo and fades in/out on hover.

---

## 2026-06-03 — Updated filter button icon to 2-line sliders

**What happened:** The filter button icon was updated from 3 lines to 2 lines with offset slider circles, matching the reference design.

---

## 2026-06-03 — Filter panel: halved radio spacing, 64px right gap

**What happened:** Spacing between filter radio button rows was halved (padding 16px → 8px). The filter panel no longer covers the full width — it leaves a 64px strip of the map visible on the right edge.

---

## 2026-06-03 — Park buttons + filter button redesign

**What happened:** Park buttons now match the Figma 4-state design — default (text only), hover (subtle fill), selected (lemna border + pill shape), selected+hover (fill + border). The filter button moved from the vertical midpoint of the sidebar into the header block, aligning with the "Explore the Necklace" title.

---

## 2026-06-03 — Filter section headings: enforce IBM Plex Sans Bold 20px

**What happened:** Filter section headings (PARK, FACILITIES, etc.) now use the CSS font shorthand to explicitly enforce IBM Plex Sans Bold 20px, ensuring the bold weight loads correctly in Framer.

---

## 2026-06-03 — Filter panel spacing doubled

**What happened:** All spacing inside the filter panel was doubled — gaps between filter sections, between the heading and its items, and the padding on each individual filter row.

---

## 2026-06-03 — Filter overlay slides in from left + Figma-style radio buttons

**What happened:** The filter panel now animates in from the left side of the screen when you press the filter button, instead of appearing instantly. Each filter item now uses a custom radio-style button matching the Figma design — filled dark green circle when selected, empty circle when not, with hover states for both.

---

## 2026-06-03 — POI card: tag label, no truncation, image zoom on hover

**What happened:** The address line was removed and replaced with the "POI Tag" field from Airtable. The POI name no longer truncates — it wraps naturally. The card photo now subtly zooms within its frame when you hover.

---

## 2026-06-03 — Fix plus button border on hover

**What happened:** The plus button border is now consistently 1px in both default and hover states.

---

## 2026-06-03 — POI card image now uses Cover Image field

**What happened:** The photo shown in each POI card now pulls from the "Cover Image" field in Airtable instead of the "Photo" field.

---

## 2026-06-03 — Card hover triggers map pin hover state

**What happened:** When you hover over a POI card in the carousel, the corresponding pin on the map now also lights up in its hover state — and clears when you move your mouse off the card.

**How it works:** Card hover events call into Mapbox's `setFeatureState` API on the pin's feature, the same mechanism already used when you hover a pin directly on the map. Both directions now stay in sync.

---

## 2026-06-03 — POI card icon and font corrections

**What changed:**
- Tag and address fonts are now consistent across default and hover (both use Carbona Variable — fonts no longer switch on hover)
- Plus icon redrawn to match Figma: thinner stroke (1px instead of 1.5px), cleaner proportions in a 20×20 viewBox

---

## 2026-06-03 — POI card rebuilt to match Figma exactly

**What happened:** Rewrote the POI card component to match the Figma default and hover states precisely.

**Default state:**
- Tag text uses IBM Plex Mono Bold (corrected from wrong font)
- Address text uses IBM Plex Sans Regular (corrected from wrong font)
- Photo has a dark translucent overlay (`rgba(46,42,43,0.15)`) — matches Figma
- Plus button: padding-based size (`17.6px`), rounded (`borderRadius: 42`), no fill

**Hover state (exact Figma Variant2):**
- Darkening overlay on photo disappears — photo looks brighter
- Tag text switches to Carbona Variable Mono Bold
- Address text switches to Carbona Variable Regular
- Info panel right padding removed so the large button can expand to the edge
- Plus button grows to `87.2×87.2px`, fills with cygnusHover (`#e5dee0`), icon grows from 21.6 to 32.8px
- All transitions are smooth (0.2s ease)

**Other fixes:**
- Info panel position corrected to exact Figma values (`top: 65.29%, bottom: 4.47%`)
- Text container now fixed `72px` wide as in Figma (instead of `flex: 1`)
- Removed uppercase/letter-spacing on tag text (not in Figma spec)

---

## 2026-06-03 — UI refinements matched to Figma designs

**What happened:** Refined the visual details of `ParkMap.tsx` by pulling the exact specs from Figma for each component.

**What changed:**
- **Filter button** (the icon that floats off the right edge of the sidebar): changed from a perfect circle to the correct pill shape (`borderRadius: 56`, `padding: 22px`). On hover it smoothly transitions to a circle shape with a slightly darker cream background — matching the Figma hover state exactly.
- **POI card — tag font**: changed from IBM Plex Mono to Carbona Variable (the correct font from the design system).
- **POI card — address font**: changed from IBM Plex Sans to Carbona Variable.
- **POI card — plus button**: now uses padding instead of a fixed size (`padding: 17.6px`, `borderRadius: 42`), matching the Figma spec. It also picks up a hover background when you hover the card.
- **Filter panel — CLEAR/APPLY buttons**: widened from 220px to 296px (the correct Figma width). CLEAR now shows a darker cream on hover; APPLY shows a darker green on hover.
- **Filter panel — layout**: filter sections now appear in a 3-column grid (matching the Figma layout), spaced evenly across the panel.
- **Filter panel — item spacing**: tightened gap between items in each filter section from 8px to 5px (matching Figma).
- **Sidebar — spacing**: adjusted padding so the gap between "Explore the Necklace" and the park list matches the Figma (40px gap, consistent padding).

**What stayed the same:** All filter logic, map connections, Airtable fetching, and intro animation are unchanged.

---

## 2026-06-03 — New ParkMap.tsx built from Figma design

**What happened:** Created a brand new file called `ParkMap.tsx` — a complete rebuild of the park map from scratch, based on a new Figma design reference. The old `ParkMapDev.tsx` was left untouched.

**What's new visually:**
- The sidebar now shows "Explore the Necklace" as a large heading, with a list of park names below it (pulled automatically from the Mapbox map)
- A circular filter button floats on the right edge of the sidebar, half-sticking into the map area — clicking it opens the new filter panel
- POI cards at the bottom now have an arched/vaulted photo shape (very rounded top corners), a cream info panel at the bottom, and a circle "+" button that links to the POI detail page
- New color palette from the design: dark green sidebar, light green map background, cream cards

**What's new with filters:**
- A full-screen filter panel slides over the map when the filter button is clicked
- Shows a live count of how many results match your current selections before you commit
- Has 6 filter categories: Park (radio buttons — pick one), Jurisdictions, Facilities, Accessibility, Projects, Activities, and Iconic Views (all checkboxes)
- Park options come from the Mapbox map layers automatically; all other options come from the Airtable data
- Hit APPLY to update the map and cards; CLEAR to reset everything; ✕ to close without changing anything

**What stayed the same under the hood:**
- All Mapbox and Airtable connection logic is preserved
- The intro animation (zoom out to show all parks, then fly to visitor center) still works
- Clicking a pin scrolls the carousel to that card; clicking a card flies the map to that location
- Clicking a park name in the sidebar immediately zooms the map to that park

**Next up:** Add fields to the Airtable base using the `Filter--XXXX` naming convention (e.g. `Filter--Activities`, `Filter--Facilities`). Each one will automatically appear as its own section in the filter panel — no code changes needed. Debug logging added to console to confirm which Filter-- fields Airtable is returning.

---

## 2026-05-28 — Planning session

**What happened:** No code changes. We talked through how we'll work together going forward.

**Decisions made:**
- This log file will be updated every time the code is touched, in plain English.
- Design system will be shared as a published Framer page (URL) instead of Figma.
- For hover states and interactions, you'll share a prototype URL plus a short written description of what each interaction does — since I can read pages but can't click around myself.

**Next up:** You'll share a site prototype showing the interaction you want to build.

---
