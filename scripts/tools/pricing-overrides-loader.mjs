// ============================================================================
// THE LOADER THAT APPLIES `--set` — pricingParameters.ts, rewritten on its way
// into the process, for one run and never on disk.
//
// Registered by pricing-overrides-register.mjs, which the tools pass to node's
// `--import` when they re-exec themselves (see pricing-overrides-install.ts).
// The overrides arrive as JSON in RIPPLE_PRICING_OVERRIDES.
//
// ============================================================================
// ⚠ WHY A LOADER AND NOT A MUTATION, AND WHY NOT A REQUIRE HOOK.
//
// Most of these parameters are exported consts holding NUMBERS —
// PROFIT_AND_CONTINGENCY_OF_RATE, PRICING_WINDOW_YEARS_NEW, PRIOR_HISTORY_YEARS
// — and a number cannot be reassigned from outside the module that declares
// it. The gates that flip NEW_RATE_STACK.enabled get away with it only because
// that one happens to be an object. So the value is replaced in the module's
// SOURCE, after tsx has transpiled it to JS and before node compiles it.
//
// ⚠ IT WAS WRITTEN AS A CommonJS `Module.prototype._compile` WRAPPER FIRST AND
// THAT WAS WRONG, SILENTLY. The repo's package.json says "type": "module", so
// every .ts under it loads through the ESM pipeline and _compile is never
// called for it — the hook fired happily for a scratch file outside the repo,
// which is exactly the kind of evidence that proves nothing. Worse, the ESM
// pipeline LINKS the whole module graph before evaluating any of it, so a hook
// installed from the first import statement of a tool is already too late:
// pricingParameters has been fetched by then. Hence `--import` and a re-exec,
// which is the only point early enough.
//
// TWO SHAPES OF OVERRIDE, and the second is not a workaround for the first:
//
//   WHOLE EXPORT   `PROFIT_AND_CONTINGENCY_OF_RATE=0.07` rewrites the
//                  declaration's initialiser. The only thing that works on a
//                  scalar const.
//   DOTTED MEMBER  `SEVERITY_TREND_PER_YEAR.WC=0.09` appends an assignment
//                  INSIDE the module, after every declaration. Nothing in
//                  pricingParameters.ts freezes these objects, so this mutates
//                  the very object every consumer holds a reference to.
// ============================================================================

const OVERRIDES = JSON.parse(process.env.RIPPLE_PRICING_OVERRIDES ?? '[]');

/** Where the value of `NAME=` ends, respecting nesting and strings. */
function endOfInitialiser(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; continue; }
    if (c === '}' || c === ']' || c === ')') {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (depth === 0 && (c === ',' || c === ';')) return i;
  }
  return src.length;
}

export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (OVERRIDES.length === 0 || !url.endsWith('src/data/pricingParameters.ts')) return r;

  let src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
  const seen = new Set();
  const mutations = [];

  for (const { path, value } of OVERRIDES) {
    const [name, ...rest] = path.split('.');
    // `NAME=` as a declaration, not `NAME:()=>NAME` in the export table or
    // `NAME` in the re-export list at the foot.
    const m = new RegExp(`\\b${name}\\s*=(?!=)`).exec(src);
    if (m === null) continue;
    seen.add(name);
    if (rest.length === 0) {
      const start = m.index + m[0].length;
      src = src.slice(0, start) + JSON.stringify(value) + src.slice(endOfInitialiser(src, start));
    } else {
      const walk = rest.slice(0, -1).map(k => `o=o[${JSON.stringify(k)}];`).join('');
      mutations.push(`try{let o=${name};${walk}o[${JSON.stringify(rest[rest.length - 1])}]=`
        + `${JSON.stringify(value)};}catch(e){throw new Error("override ${path}: "+e.message);}`);
    }
  }

  // ⚠ AN OVERRIDE THAT MATCHES NOTHING STOPS THE RUN. A tuning instrument whose
  // knob is not connected reports the unchanged model as though it were the
  // changed one, and the reader cannot tell. A misspelled name is a hard stop.
  const missing = [...new Set(OVERRIDES.map(o => o.path.split('.')[0]))].filter(n => !seen.has(n));
  if (missing.length > 0) {
    throw new Error(`--set names no such export in pricingParameters.ts: ${missing.join(', ')}`);
  }

  if (mutations.length > 0) {
    // ⚠ WHERE THE MUTATIONS GO DEPENDS ON WHICH SHAPE tsx EMITTED, AND BOTH
    // SHAPES ARE REAL. Under the ESM pipeline — which is what this repo uses,
    // being "type": "module" — the output is a genuine module whose consts are
    // top-level, so the mutations simply go at the end. Under the CommonJS
    // pipeline tsx wraps the body in an arrow IIFE closed by `})()` with no
    // semicolon, and the consts are scoped to it; appending at the end of the
    // file then puts every mutation OUTSIDE that scope, where each one dies on
    // "SEVERITY_TREND_PER_YEAR is not defined". That was measured, not
    // imagined. So the wrapper is detected and spliced into when present.
    //
    // Anything else is neither, and stops the run rather than producing a
    // report that quietly used the committed value.
    const mapAt = src.lastIndexOf('\n//# sourceMappingURL=');
    const code = mapAt === -1 ? src : src.slice(0, mapAt);
    const sourceMap = mapAt === -1 ? '' : src.slice(mapAt);
    const body = `\n;${mutations.join('\n')}\n`;
    const trimmed = code.trimEnd();

    if (trimmed.endsWith('})()')) {
      const close = code.lastIndexOf('})()');
      src = code.slice(0, close) + body + code.slice(close) + sourceMap;
    } else if (r.format === 'module' || r.format === undefined) {
      src = code + body + sourceMap;
    } else {
      throw new Error('pricing-overrides: pricingParameters.ts arrived in a module shape this '
        + `loader does not recognise (format ${String(r.format)}). A dotted --set cannot be applied `
        + 'safely; stopping rather than reporting the committed value as the overridden one.');
    }
  }

  return { ...r, source: src };
}
