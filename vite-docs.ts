/**
 * V32 — the documentation build step.
 *
 * Reads `src/content/docs/<lang>/*.md`, compiles each file with the pure
 * compiler in `src/features/docs/compile.ts`, and exposes the finished pages
 * as the virtual module `virtual:labml-docs`. The browser therefore receives
 * HTML, an outline and a search index — never a Markdown parser, and never a
 * request to a documentation host: the strict CSP allows no third party, and
 * a site that publishes /privacy cannot make an exception for its own docs.
 *
 * A malformed page fails the BUILD rather than rendering half a page: the
 * compiler throws with the file name, and this plugin lets it through.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { compileDoc, type DocPage } from './src/features/docs/compile.ts';

const ROOT = 'src/content/docs';
const VIRTUAL = 'virtual:labml-docs';
const RESOLVED = '\0' + VIRTUAL;

export function readDocs(root = ROOT): DocPage[] {
  const pages: DocPage[] = [];
  for (const lang of readdirSync(root).sort()) {
    const dir = join(root, lang);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.md')) continue;
      const path = join(dir, file);
      pages.push(compileDoc(readFileSync(path, 'utf8'), lang, path));
    }
  }
  // Sorted here, once, so every consumer sees the same order without
  // re-deciding it: quadrant order first, then the author's `order`.
  const rank = { tutorial: 0, 'how-to': 1, reference: 2, explanation: 3 } as const;
  return pages.sort(
    (a, b) => a.lang.localeCompare(b.lang) || rank[a.kind] - rank[b.kind] || a.order - b.order,
  );
}

export function docsPlugin(): Plugin {
  return {
    name: 'labml-docs',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const pages = readDocs();
      if (pages.length === 0) throw new Error(`${ROOT} holds no .md page`);
      // Every file is a build dependency: editing prose reloads the page in
      // dev without restarting the server.
      for (const lang of readdirSync(ROOT)) {
        const dir = join(ROOT, lang);
        if (statSync(dir).isDirectory()) {
          for (const file of readdirSync(dir)) this.addWatchFile(join(dir, file));
        }
      }
      return `export const DOCS = ${JSON.stringify(pages)};`;
    },
    configureServer(server) {
      server.watcher.add(ROOT);
      server.watcher.on('all', (_, path) => {
        if (!path.includes('content/docs')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
