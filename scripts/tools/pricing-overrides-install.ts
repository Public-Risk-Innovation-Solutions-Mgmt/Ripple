// ============================================================================
// `--set NAME=VALUE` — any value in pricingParameters.ts, for one run.
//
//   --set PROFIT_AND_CONTINGENCY_OF_RATE=0.07      a whole export
//   --set SEVERITY_TREND_PER_YEAR.WC=0.09          one member of one
//   --set REINSURANCE_LOAD_CLF_AT_70.Property=1.2
//   --set PRICING_WINDOW_YEARS_NEW=7
//   --set ADMIN_FIXED_PER_YEAR.GL=750000
//   --set 'ALAE_OF_LOSS_COST={"WC":0.1,"GL":0.1,"Property":0.1}'
//
// NOTHING IS WRITTEN TO A FILE. The flow the tuning tools exist for is: try a
// value, read the outcome, and only then commit the chosen value to the
// parameters file by hand. An override that persisted would corrupt the next
// run's reading; one that silently did nothing would corrupt this one's. Both
// are closed — the second by the loader, which stops the run on a name that
// matches no export.
//
// The name is the EXPORT NAME, exactly as pricingParameters.ts spells it, and
// a dot addresses into it. There are no friendly aliases on purpose: "trend"
// would have to choose between SEVERITY_TREND_PER_YEAR and
// FREQUENCY_TREND_PER_YEAR, and a tuning run that silently moved the one the
// reader did not mean is worse than one that asks them to name it.
//
// ============================================================================
// ⚠ THE RE-EXEC, AND WHY THERE IS NO WAY AROUND IT.
//
// Overrides are applied by a module loader (pricing-overrides-loader.mjs), and
// a loader has to be registered before the module graph is linked. This repo
// is "type": "module", so node LINKS every import in the graph before
// evaluating any of it — which means a tool cannot install the loader from its
// own first import statement, however early that statement sits.
//
// So when `--set` is present and the loader is not yet running, this re-runs
// the same script in a child process with the loader registered, forwards
// stdout and stderr untouched, and exits with the child's code. It is
// invisible from the outside: the caller sees one command and one output.
// Without `--set` there is no child and no loader.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface PricingOverride { path: string; raw: string; value: unknown }

/**
 * `--set a.b=1 --set c=2` out of argv, leaving everything else alone.
 *
 * ⚠ THE VALUE IS PARSED AS JSON, AND A BARE WORD IS KEPT AS A STRING. `0.07`
 * is a number, `false` is a boolean, `{"enabled":false}` is an object, and
 * `equal` — which PRICING_WINDOW_WEIGHTING_NEW takes — is the string "equal"
 * rather than a parse error.
 */
export function parseOverrides(argv: string[]): { overrides: PricingOverride[]; rest: string[] } {
  const overrides: PricingOverride[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--set') { rest.push(argv[i]); continue; }
    const pair = argv[++i];
    if (pair === undefined) throw new Error('--set needs NAME=VALUE');
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`--set expects NAME=VALUE, got "${pair}"`);
    const raw = pair.slice(eq + 1);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = raw; }
    overrides.push({ path: pair.slice(0, eq).trim(), raw, value });
  }
  return { overrides, rest };
}

/** The line every run prints, so a log says what produced it. */
export function describeOverrides(overrides: PricingOverride[]): string {
  return overrides.length === 0
    ? 'PARAMETER OVERRIDES: none — pricingParameters.ts as committed.'
    : `PARAMETER OVERRIDES (this run only, nothing written):\n${
      overrides.map(o => `  ${o.path} = ${JSON.stringify(o.value)}`).join('\n')}`;
}

const parsed = parseOverrides(process.argv.slice(2));

if (parsed.overrides.length > 0 && process.env.RIPPLE_PRICING_OVERRIDES === undefined) {
  const register = fileURLToPath(new URL('./pricing-overrides-register.mjs', import.meta.url));
  // process.execArgv already carries tsx's own loader; ours goes after it so
  // it wraps tsx's output rather than the raw TypeScript.
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, '--import', register, ...process.argv.slice(1)],
    {
      stdio: 'inherit',
      env: { ...process.env, RIPPLE_PRICING_OVERRIDES: JSON.stringify(parsed.overrides) },
    },
  );
  process.exit(child.status ?? 1);
}

/** argv with the `--set` pairs removed, for the tool's own flag parsing. */
export const argvWithoutOverrides: string[] = parsed.rest;
export const pricingOverrides: PricingOverride[] = parsed.overrides;
export const overridesBanner: string = describeOverrides(parsed.overrides);
