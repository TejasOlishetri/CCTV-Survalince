import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/video_feed': 'http://127.0.0.1:5000',
      '/snapshots': 'http://127.0.0.1:5000',
      '/missing_persons': 'http://127.0.0.1:5000',
      '/enrolled_faces': 'http://127.0.0.1:5000',
      '/recordings': 'http://127.0.0.1:5000',
    }
  }
})
