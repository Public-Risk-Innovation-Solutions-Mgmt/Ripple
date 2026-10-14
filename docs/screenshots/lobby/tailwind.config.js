// Self-contained so the mockup does not depend on, or alter, the app's own
// Tailwind config — whose content globs cover ./index.html and ./src only and
// would not scan a file under docs/.
//
// ⚠ THE GLOBS ARE ABSOLUTE, AND THEY HAVE TO BE. Tailwind resolves a relative
// content glob against the process CWD, not against this file, and the mockup
// is served from the repo root — so './mockup.tsx' matched nothing and the
// first build emitted preflight with no utilities at all. The page rendered as
// unstyled text, which is exactly the "sketch" the mockup is meant not to be.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export default {
  // src/** is scanned too, because the mockup renders the REAL screens and
  // their classes must be generated.
  content: [`${here}/index.html`, `${here}/mockup.tsx`, `${here}/../../../src/**/*.{ts,tsx}`],
  theme: { extend: {} },
  // Matches the app's own config — the real screens may reach for `prose`.
  plugins: [require('@tailwindcss/typography')],
};
