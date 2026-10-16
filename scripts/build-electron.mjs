// Bundles the Electron main process (server + UI included) into dist-electron/main.cjs.
// Used by `npm run build:desktop` / `npm run dist`; electron-builder then packages it.
/* global process, console */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist-electron', { recursive: true, force: true });

execFileSync(
  process.execPath,
  [
    'node_modules/tailwindcss/lib/cli.js',
    '-c',
    'tailwind.config.js',
    '-i',
    'src/web/tailwind.input.css',
    '-o',
    'src/web/tailwind.generated.css',
    '--minify',
  ],
  { stdio: 'inherit' },
);

await build({
  entryPoints: { main: 'src/electron/main.ts', preload: 'src/electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
  define: {
    __TAILWIND_CSS__: JSON.stringify(readFileSync('src/web/tailwind.generated.css', 'utf8')),
    'import.meta.url': 'import_meta_url',
  },
  banner: { js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
});

console.log('Built dist-electron/main.cjs and preload.cjs');
