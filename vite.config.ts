/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ONNX Runtime's WASM binaries are self-hosted under /ort/ (strict CSP:
    // nothing may load from a CDN).
    viteStaticCopy({
      // Only the plain SIMD build: the jsep/jspi/asyncify variants weigh 15–27 MB
      // each and one of them exceeds Cloudflare Pages' 25 MB per-file limit.
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}',
          dest: 'ort',
          rename: { stripBase: true },
        },
      ],
    }),
    // Offline-first PWA — the strongest proof that nothing needs a server.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'theme-init.js'],
      manifest: {
        name: 'LabML — ML in your browser',
        short_name: 'LabML',
        description:
          'Train machine learning models on your own data, entirely in your browser. Nothing leaves your machine.',
        theme_color: '#0b6e5d',
        background_color: '#f4f7f6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Demo datasets included: the lab trains fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,csv}'],
        // The vision model and ONNX runtime are cached on first use instead of
        // being precached — they would bloat the install for non-vision users.
        globIgnores: ['models/**', 'ort/**'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/(models|ort)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'labml-vision', expiration: { maxEntries: 12 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
