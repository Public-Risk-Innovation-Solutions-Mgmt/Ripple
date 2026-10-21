// ============================================================================
// docs/PARAMETERS.md MUST MATCH THE CODE.
//
//   npx tsx scripts/diagnostics/parameters-page-check.ts
//
// ⚠ IT GUARDS A DOCUMENT, WHICH IS UNUSUAL HERE, AND THE REASON IS THAT THE
// DOCUMENT IS THE POINT OF THE COMMIT. The pricing rebuild exists so the model
// can be tuned by changing numbers in one place; a page that lists those
// numbers is worth having only while it is TRUE. A stale parameters page is
// worse than none — somebody reads a value off it, reasons about the model with
// it, and is wrong in a way nothing tells them about. This project has already
// found several comments that went stale exactly that way.
//
// It is a byte comparison against what the generator would write, so it catches
// an edited page, a changed constant that was not regenerated, and a changed
// generator that was not re-run — all three with one assertion.
//
// ⚠ WHAT IT CANNOT CATCH: a number that is wrong. The page renders the
// module's own constants, so the two agree by construction once regenerated.
// This holds the DESCRIPTION still, not the value; the value baselines are what
// hold the values still.
//
// CONFIRMED TO FAIL: by hand-editing one character of the page, by changing a
// constant without regenerating, and by deleting the page. See the commit.
// ============================================================================

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠ ESM, SO THERE IS NO __dirname. Derived the way every other tool in
// scripts/ derives it; a bare __dirname throws at load here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERATOR = path.join(__dirname, '../tools/generate-parameters-page.ts');

try {
  // ⚠ RUN THE GENERATOR'S OWN --check RATHER THAN RE-IMPLEMENTING IT. A second
  // copy of the rendering here would be a second thing to keep in step, which
  // is the defect this whole file exists to prevent.
  const out = execFileSync('npx', ['tsx', GENERATOR, '--check'], { encoding: 'utf8' });
  process.stdout.write(out);
  console.log('\nPARAMETERS PAGE MATCHES THE CODE.');
} catch (e) {
  const err = e as { stdout?: string; stderr?: string };
  process.stdout.write(err.stdout ?? '');
  process.stderr.write(err.stderr ?? '');
  console.log('\nPARAMETERS PAGE CHECK FAILED — docs/PARAMETERS.md is not what the code says.');
  process.exit(1);
}
