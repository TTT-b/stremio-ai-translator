// Builds dist/stremio-ai-translator.exe: esbuild bundle -> Node SEA blob -> inject into node.exe.
// Run with: npm run build:exe   (needs Node 22+ on the build machine, not on the user's)
/* global process, console */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { inject } from 'postject';

const out = 'dist';
const bundle = `${out}/app.cjs`;
const blob = `${out}/app.blob`;
const exe = `${out}/stremio-ai-translator.exe`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

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
  entryPoints: ['src/sea/entry.ts'],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
  define: {
    __TAILWIND_CSS__: JSON.stringify(readFileSync('src/web/tailwind.generated.css', 'utf8')),
    'import.meta.url': 'import_meta_url',
  },
  banner: { js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
});

writeFileSync(
  `${out}/sea-config.json`,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ['--experimental-sea-config', `${out}/sea-config.json`], {
  stdio: 'inherit',
});

copyFileSync(process.execPath, exe);
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

console.log(`\nBuilt ${exe}`);
