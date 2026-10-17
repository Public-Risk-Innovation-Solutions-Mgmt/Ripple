// Registers the `--set` loader. Passed to node's `--import` by the re-exec in
// pricing-overrides-install.ts; it must come AFTER tsx's own loader on the
// command line so this one is outermost and patches tsx's transpiled output
// rather than the raw TypeScript.
import { register } from 'node:module';
register(new URL('./pricing-overrides-loader.mjs', import.meta.url));
