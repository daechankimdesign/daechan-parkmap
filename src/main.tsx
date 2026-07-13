import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode is intentionally OFF here to match the dev-harness (1574):
// it double-invokes effects in dev, which makes the Mapbox map initialize twice.
createRoot(document.getElementById('root')!).render(
  <App />,
)
