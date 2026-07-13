import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  // Required for GitHub Pages project site served at /daechan-parkmap/.
  // Without this, built asset URLs are root-absolute (/assets/…) and 404.
  base: "/daechan-parkmap/",
  plugins: [react()],
  resolve: {
    alias: {
      framer: path.resolve(__dirname, "./src/framer.ts"),
    },
  },
})