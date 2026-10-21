// ============================================================================
// BUILD THE LAMBDA: src/session/server/handler.ts -> dist-lambda/handler.zip.
//
//   npm run build:handler        (npx tsx scripts/tools/build-handler.ts)
//
// ⚠ ONE FILE, EVERYTHING BUNDLED, NO EXTERNALS. The AWS SDK v3 is in the Node
// Lambda runtime, but which version is the runtime's choice and changes under
// you; bundling pins it to what the contract harness ran against. One CJS file
// has no native code, so the same zip runs on arm64 and x86_64 — the pipeline
// builds once and promotes the same artifact (the AWS owner's guide, section 6).
//
// ⚠ THE ZIP HAS index.js AT ITS ROOT, EXPORTING `handler`. That is what the
// function's handler setting `index.handler` resolves, and it is checked below
// by loading the built file and looking, rather than assumed from the config —
// a zip that builds and does not load fails only when deployed.
//
// It needs no AWS credentials and talks to nothing. Deploying is the pipeline's
// job, not this script's.
// ============================================================================

import { build } from 'esbuild';
import { zipSync, unzipSync } from 'fflate';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'dist-lambda');
const zipPath = path.join(outDir, 'handler.zip');

const result = await build({
  entryPoints: [path.join(root, 'src/session/server/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  write: false,
  minify: false,       // a stack trace in CloudWatch should name real functions
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const code = result.outputFiles[0].contents;

mkdirSync(outDir, { recursive: true });
// A fixed mtime, so the same source gives a byte-identical zip — the pipeline
// stores one artifact per commit and promotes it, and a rebuild that differs
// only by timestamp would look like a different build.
const zip = zipSync({ 'index.js': [code, { mtime: new Date('2026-01-01T00:00:00Z') }] }, { level: 9 });
writeFileSync(zipPath, zip);

// ---- the check: unzip what was written, load it, and find the handler -------
const entries = unzipSync(readFileSync(zipPath));
const names = Object.keys(entries);
if (names.length !== 1 || names[0] !== 'index.js') {
  throw new Error(`handler.zip should hold exactly index.js at its root; it holds ${names.join(', ')}`);
}
const scratch = mkdtempSync(path.join(tmpdir(), 'ripple-handler-'));
try {
  const file = path.join(scratch, 'index.js');
  writeFileSync(file, entries['index.js']);
  const loaded = createRequire(file)(file) as { handler?: unknown };
  if (typeof loaded.handler !== 'function') throw new Error('index.js does not export a handler function.');
  // No TABLE_NAME here, on purpose: the handler must still answer — with a
  // retryable 500 — rather than crash on load. Routing runs before any I/O.
  const probe = await (loaded.handler as (e: unknown) => Promise<{ statusCode: number; body: string }>)({
    rawPath: '/nowhere', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{}',
  });
  if (probe.statusCode !== 404) throw new Error(`An unknown route returned ${probe.statusCode}, not 404.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`dist-lambda/handler.zip  ${kb(zip.length)} (index.js ${kb(code.length)} unzipped)`);
console.log('  index.js at the root exports handler — loaded and called to check.');
