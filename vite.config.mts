import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
  // Tauri expects static files to be served on port 1420 by default
  server: {
    port: 1420,
    strictPort: true,
  },
  // envPrefix is important so that tauri-specific variables are exposed to the frontend
  envPrefix: ['VITE_', 'TAURI_'],
})
