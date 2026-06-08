// Vite build/dev configuration.

// Vite's config helper (gives us type hints and validation).
import { defineConfig } from 'vite'

// React plugin: enables JSX and Fast Refresh.
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Project plugins.
  plugins: [react()],

  // Dev server settings — tuned so a public tunnel can reach it.
  server: {
    // Listen on every network interface, not just localhost,
    // so the tunnel (and the local network) can connect.
    host: true,

    // Use a fixed port so the tunnel always points at the right place.
    port: 5173,

    // Fail loudly if 5173 is taken instead of silently picking another port.
    strictPort: true,

    // Accept requests coming through Cloudflare quick tunnels.
    // The leading dot matches the random "*.trycloudflare.com" subdomain.
    allowedHosts: ['.trycloudflare.com'],
  },
})
