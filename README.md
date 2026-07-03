# ParkMap

An interactive map application built with **React 19 + TypeScript + Vite**, rendering a custom
Mapbox GL map with animated overlays (via `framer-motion`) and data-driven points of interest.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your Mapbox token
npm run dev
```

Then open http://localhost:5173/.

The map needs a Mapbox access token. Copy `.env.example` to `.env.local` and set
`VITE_MAPBOX_TOKEN` to your own publishable (`pk.`) token from
[account.mapbox.com](https://account.mapbox.com/access-tokens/). `.env.local` is gitignored, so
your token never gets committed.

> **Note:** `npm install` uses `legacy-peer-deps` (configured in `.npmrc`) because the `framer`
> package declares a React 18 peer dependency while this project runs on React 19. The `framer`
> import is stubbed at build time via a Vite alias (`src/framer.ts`), so it has no runtime effect.

## Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start the Vite dev server with HMR           |
| `npm run build`   | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Preview the production build locally         |
| `npm run lint`    | Run Oxlint                                    |

## Project structure

| Path                       | Purpose                                              |
| -------------------------- | --------------------------------------------------- |
| `src/main.tsx`             | App entry point                                     |
| `src/App.tsx`              | Root component, mounts the map full-screen          |
| `ParkMap.tsx`              | Main map component (config, Mapbox loading, layers) |
| `ParkMapHoverReveal.tsx`   | Hover-reveal map variant                            |
| `ExploreMoreOverride.tsx`  | Framer Code Override (for use inside Framer)         |

## Configuration

Map configuration lives at the top of `ParkMap.tsx` (`CONFIG`), including the Mapbox access
token, map style, default center/zoom, and the data proxy endpoint.

The included Mapbox token is a *publishable* (`pk.`) token intended for client-side use. If you
fork this project, replace it with your own token and restrict it by URL in your Mapbox account.
