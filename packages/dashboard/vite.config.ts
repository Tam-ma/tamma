import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Prevent Node.js built-ins from being bundled — @tamma/shared
      // re-exports server-side modules (event-store, etc.) that import
      // node:crypto. The dashboard only uses type imports from shared,
      // but Vite's bundler follows the barrel export. Mark these as
      // external so Rollup skips them.
      external: [/^node:/],
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
