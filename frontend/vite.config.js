// Vite build/dev configuration.

// Vite's config helper (gives us type hints and validation).
import { defineConfig } from 'vite'

// React plugin: enables JSX and Fast Refresh.
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Project plugins.
  plugins: [react()],

  // Build tuning.
  build: {
    rollupOptions: {
      output: {
        // Split the big third-party libraries into their own chunks instead of
        // one ~700KB bundle. Smaller app chunk + the vendor code is cached
        // separately, so app changes don't force a re-download of Firebase.
        manualChunks: {
          firebase: [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/storage',
          ],
          react: ['react', 'react-dom'],
        },
      },
    },
  },

  // Dev server settings — tuned so a public tunnel can reach it.
  server: {
    // Listen on every network interface, not just localhost,
    // so the tunnel (and the local network) can connect.
    host: true,

    // Use a fixed port so the tunnel always points at the right place.
    port: 5173,

    // Fail loudly if 5173 is taken instead of silently picking another port.
    strictPort: true,

    // Accept requests coming through public preview tunnels. The leading dot
    // matches the random subdomain each service hands out:
    //   - Cloudflare quick tunnels  ->  *.trycloudflare.com
    //   - localhost.run (no-password, ssh) -> *.lhr.life
    //   - localtunnel (fallback)    ->  *.loca.lt
    allowedHosts: ['.trycloudflare.com', '.lhr.life', '.loca.lt'],
  },
})
