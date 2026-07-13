// Aligned with the dev-harness (1574): render the HOVER-REVEAL variant,
// not the plain ParkMap. This file is byte-identical to
// ENC_codes-main/Mapbox/ParkMapHoverReveal.tsx.
import ParkMapHoverReveal from "../ParkMapHoverReveal"

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ParkMapHoverReveal />
    </div>
  )
}