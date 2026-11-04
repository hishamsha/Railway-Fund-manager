import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to this server, which forwards API calls, so the API
// needs no cross-origin access. BACKEND_URL overrides the local API address.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    proxy: { '/api': process.env.BACKEND_URL ?? 'http://127.0.0.1:3000' },
  },
});
