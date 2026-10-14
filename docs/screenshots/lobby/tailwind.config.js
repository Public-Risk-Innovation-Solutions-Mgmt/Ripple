// Self-contained so the mockup does not depend on, or alter, the app's own
// Tailwind config — whose content globs cover ./index.html and ./src only and
// would not scan a file under docs/.
//
// ⚠ THE GLOBS ARE ABSOLUTE, AND THEY HAVE TO BE. Tailwind resolves a relative
// content glob against the process CWD, not against this file, and the mockup
// is served from the repo root — so './mockup.tsx' matched nothing and the
// first build emitted preflight with no utilities at all. The page rendered as
// unstyled text, which is exactly the "sketch" the mockup is meant not to be.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default {
  content: [`${here}/index.html`, `${here}/mockup.tsx`],
  theme: { extend: {} },
  plugins: [],
};
