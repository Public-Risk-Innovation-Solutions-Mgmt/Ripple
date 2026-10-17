// Every run of a tuning tool leaves a log in runlogs/, without the caller
// having to remember to redirect one.
//
// ⚠ IT TEES RATHER THAN REDIRECTS. A tuning session is a conversation — run,
// read, change a parameter, run again — so the output has to stay on the
// terminal. The file is for afterwards: comparing the run that used a 7%
// trend against the one that used 9%, when both have scrolled away.
//
// ⚠ AND THE FILENAME CARRIES THE OVERRIDES, which is the whole point of
// keeping the file. `outcomes-summary.log` tells a reader nothing about which
// of six tuning runs it was; `outcomes-summary--SEVERITY_TREND_PER_YEAR.WC=0.09.log`
// tells them without opening it. The banner inside says it too, but a
// directory listing should not need opening to be read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PricingOverride } from './pricing-overrides-install';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Safe for a filename, and still readable: `TREND.WC=0.09`, not a hash. */
function slug(overrides: PricingOverride[], extra: string[]): string {
  const parts = [...extra, ...overrides.map(o => `${o.path}=${o.raw}`)]
    .join('_').replace(/[^A-Za-z0-9._=-]+/g, '-');
  return parts.length === 0 ? '' : `--${parts.slice(0, 120)}`;
}

/**
 * Start teeing stdout to runlogs/<name><slug>.log. Returns the path so the
 * tool can print it at the end.
 */
export function startRunLog(name: string, overrides: PricingOverride[], extra: string[] = []): string {
  const dir = path.join(REPO, 'runlogs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}${slug(overrides, extra)}.log`);
  const fd = fs.openSync(file, 'w');

  for (const stream of ['log', 'error'] as const) {
    const original = console[stream].bind(console);
    console[stream] = (...args: unknown[]) => {
      original(...args);
      try {
        fs.writeSync(fd, `${args.map(a => (typeof a === 'string' ? a : String(a))).join(' ')}\n`);
      } catch {
        // A failed log write must never take the run down with it — the
        // reading on the terminal is the deliverable, the file is a copy.
      }
    };
  }
  return file;
}
