import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    target: 'esnext',
    // three core alone is ~half a megabyte minified; it is one cacheable chunk
    // by design, so lift the warning threshold just above it.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep the hero's `three` core separate from the GLTF/DRACO/utils
        // "examples" modules (only the code-split vine + procession scenes need
        // those) and give gsap its own long-lived chunk.
        manualChunks(id) {
          const p = id.replace(/\\/g, '/');
          if (p.includes('/node_modules/three/examples/')) return 'three-examples';
          if (p.includes('/node_modules/three/')) return 'three';
          if (p.includes('/node_modules/gsap/')) return 'gsap';
        },
      },
    },
  },
});
