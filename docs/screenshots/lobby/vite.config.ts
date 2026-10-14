// Its own Vite root, so building or serving the mockup never touches the app's
// build. Run from the repo root:
//   npx vite --config docs/screenshots/lobby/vite.config.ts
//
// ⚠ fs.allow REACHES THE REPO ROOT ON PURPOSE. The mockup imports the REAL
// screens out of src/, which is outside this Vite root; without it every
// import of a real component is refused and the mockup would be driven back to
// copying markup, which is the thing it exists not to do.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

export default defineConfig({
  root: here,
  plugins: [react()],
  css: { postcss: here },
  server: { port: 4180, strictPort: true, fs: { allow: [repoRoot] } },
});
