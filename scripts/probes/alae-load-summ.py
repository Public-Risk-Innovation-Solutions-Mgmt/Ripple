# Prints the before/after report from alae-load-probe.mts's JSON, by line.
#   python3 scripts/probes/alae-load-summ.py before-single.json after-single.json
import json, sys
B, A = (json.load(open(f)) for f in sys.argv[1:3])
LINES = ['WC', 'GL', 'Property']
ns = sorted(A['scenarios'], key=int)
def col(d, l, k): return [d['scenarios'][n][l][k] for n in ns]
def mean(x): return sum(x) / len(x)
M = 1e6
print(f"{A['mode']} — {len(ns)} scenarios, 5 played years, default decisions; before -> after")
for l in LINES:
    print(f"\n{l}")
    # The history years' rates: each pre-game year's rate, paired by scenario.
    years = [y for y, _, _ in B['scenarios'][ns[0]][l]['preRates']]
    moves = {y: [] for y in years}
    for n in ns:
        for (y, rb, _), (_, ra, _) in zip(B['scenarios'][n][l]['preRates'], A['scenarios'][n][l]['preRates']):
            moves[y].append(ra / rb - 1)
    print('  history rates (mean change, range), by year: ' + '; '.join(
        f"{2026 + y}: {100*mean(m):+.2f}% ({100*min(m):+.2f} to {100*max(m):+.2f})" for y, m in moves.items()))
    sb, sa = col(B, l, 'surplus0'), col(A, l, 'surplus0')
    pb, pa = col(B, l, 'ps0'), col(A, l, 'ps0')
    ds = [a / b - 1 for a, b in zip(sa, sb)]
    dp = [a - b for a, b in zip(pa, pb)]
    print(f"  openings: surplus moves {100*min(ds):+.2f}% to {100*max(ds):+.2f}% (mean {100*mean(ds):+.2f}%, {sum(abs(x) > 1e-12 for x in ds)} of {len(ds)} moved);"
          f" premium to surplus {min(pb):.2f}-{max(pb):.2f} -> {min(pa):.2f}-{max(pa):.2f} (moves {min(dp):+.3f} to {max(dp):+.3f})")
    for tag, d in (('before', B), ('after', A)):
        r1, r0 = col(d, l, 'rate1'), col(d, l, 'rate0')
        chg = [a / b - 1 for a, b in zip(r1, r0)]
        ld = col(d, l, 'alaeLoad1')
        cr, su = col(d, l, 'cr'), col(d, l, 'surplus')
        print(f"  {tag:6} 2027 rate ${mean(r1):.4f} ({min(r1):.4f}-{max(r1):.4f}), ALAE load {100*min(ld):.2f}-{100*max(ld):.2f}%"
              f" | vs 2026: {sum(c < 0 for c in chg)} drops, {sum(c < -0.02 for c in chg)} over 2% (worst {100*min(chg):+.2f}%)"
              f" | 5-yr CR {100*mean(cr):.1f}% | surplus Y5 ${mean(su)/M:.1f}M (lowest ${min(su)/M:.1f}M, {sum(s < 0 for s in su)} below zero)")
    r1b, r1a = col(B, l, 'rate1'), col(A, l, 'rate1')
    d1 = [a / b - 1 for a, b in zip(r1a, r1b)]
    print(f"  2027 rate, paired: mean {100*mean(d1):+.2f}% ({100*min(d1):+.2f} to {100*max(d1):+.2f})")
