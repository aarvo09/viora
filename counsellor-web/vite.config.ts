import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 so the dashboard can be opened from another machine on the LAN.
    host: true,
    port: 5173,
  },
})
