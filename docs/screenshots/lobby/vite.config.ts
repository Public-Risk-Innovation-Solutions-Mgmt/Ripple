// Its own Vite root, so building or serving the mockup never touches the app's
// build. Run from the repo root:  npx vite --config docs/screenshots/lobby/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: { postcss: __dirname },
  server: { port: 4180, strictPort: true },
});
