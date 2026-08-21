/// <reference types="vitest/config" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * Lazy routes normally load in a second network phase after the entry has
 * executed. Injecting modulepreload hints for the main routes' chunk graphs
 * lets the browser fetch them in parallel with the entry — the waterfall
 * collapses without giving up code splitting.
 */
function preloadRouteChunks(targets: string[]): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  return {
    name: 'labml-preload-route-chunks',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_, bundle) {
      // Facade chunks only: preloading their whole import graphs competes
      // with the entry for bandwidth and makes first paint WORSE (measured).
      files = Object.values(bundle)
        .filter(
          (entry) =>
            entry.type === 'chunk' &&
            entry.facadeModuleId !== null &&
            targets.some((target) => entry.facadeModuleId!.includes(target)),
        )
        .map((chunk) => chunk.fileName);
    },
    closeBundle() {
      const htmlPath = join(outDir, 'index.html');
      const links = files
        .map((file) => `    <link rel="modulepreload" crossorigin href="/${file}">`)
        .join('\n');
      const html = readFileSync(htmlPath, 'utf8').replace('</head>', `${links}\n  </head>`);
      writeFileSync(htmlPath, html);

      // Static shell for /ml: the hero paints as soon as the CSS arrives and
      // React simply replaces it on mount (same markup, no hydration involved).
      // Cloudflare Pages serves exact files before the SPA fallback, so only
      // first visits to /ml get this head start — measured LCP driver was 87%
      // render delay without it.
      const en = JSON.parse(readFileSync('src/locales/en.json', 'utf8')) as {
        ml: { eyebrow: string; titlePre: string; titleHighlight: string; lede: string };
      };
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
      const hero =
        `<div class="mx-auto max-w-6xl px-4"><section class="py-12 sm:py-16">` +
        `<p class="font-mono text-xs font-semibold tracking-[0.18em] text-copper uppercase">${esc(en.ml.eyebrow)}</p>` +
        `<h1 class="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">${esc(en.ml.titlePre)} ` +
        `<span class="bg-accent-soft box-decoration-clone px-1 text-accent-strong">${esc(en.ml.titleHighlight)}</span></h1>` +
        `<p class="mt-5 max-w-2xl text-lg text-muted">${esc(en.ml.lede)}</p></section></div>`;
      mkdirSync(join(outDir, 'ml'), { recursive: true });
      writeFileSync(
        join(outDir, 'ml', 'index.html'),
        html.replace('<div id="root"></div>', `<div id="root">${hero}</div>`),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadRouteChunks(['features/home/HomePage', 'features/ml/pages/MlHomePage']),
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
      // 'prompt' + in-app registration: the update toast lets the user choose
      // when to reload, and no render-blocking registerSW.js is emitted.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
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
