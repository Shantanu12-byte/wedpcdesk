import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Crucial for Electron to load assets via relative paths
  server: {
    port: 5173,
    host: true, // Listen on all network interfaces to allow external LAN access during development
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
  },
});
