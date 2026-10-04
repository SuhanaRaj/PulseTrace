import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// strictPort: the backend CORS allowlist expects the dashboard on http://localhost:5173
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:5000' } } })
