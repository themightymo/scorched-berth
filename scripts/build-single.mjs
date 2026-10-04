// Builds the whole game into one self-contained HTML file:
//   standalone/scorched-berth.html
// Runs a normal Vite production build into a temporary folder, then inlines
// the bundled script and stylesheet into the page. The file works when opened
// straight from disk (file://), emailed, or dropped on any static host. The
// only external reference is the Google Fonts stylesheet, which falls back to
// system monospace fonts when offline.
//
// Usage: npm run build:single

import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.single-build');
const outDir = join(root, 'standalone');
const outFile = join(outDir, 'scorched-berth.html');

await build({
  root,
  logLevel: 'warn',
  base: './',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

let page = readFileSync(join(tmp, 'index.html'), 'utf8');
const asset = (href) => readFileSync(join(tmp, href.replace(/^\.?\//, '')), 'utf8');

// Inline scripts. "</script" inside the bundle would end the tag early.
page = page.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  const code = asset(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${code}\n</script>`;
});
// Inline local stylesheets (leave the Google Fonts link alone).
page = page.replace(/<link rel="stylesheet"(?: crossorigin)? href="(\.\/assets\/[^"]+)">/g, (_, href) => `<style>\n${asset(href)}\n</style>`);

const leftovers = page.match(/(?:src|href)="\.?\/?assets\/[^"]+"/g);
if (leftovers) throw new Error(`Single-file build still references external assets: ${leftovers.join(', ')}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, page);
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
console.log(`Single-file build: ${outFile.replace(`${root}/`, '')} (${Math.round(page.length / 1024)} KB)`);
