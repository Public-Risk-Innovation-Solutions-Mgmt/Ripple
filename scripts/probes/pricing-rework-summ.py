# Prints the before/after report from pricing-rework-probe.mts's JSON, by line.
#   python3 scripts/probes/pricing-rework-summ.py before-single.json after-single.json
import json, sys
B, A = (json.load(open(f)) for f in sys.argv[1:3])
LINES = ['WC', 'GL', 'Property']
def col(d, l, k): return [d['scenarios'][n][l][k] for n in sorted(d['scenarios'], key=int)]
def mean(x): return sum(x) / len(x)
M = 1e6
print(f"{A['mode']} — {len(A['scenarios'])} scenarios, 5 played years, default decisions; before -> after")
for l in LINES:
    print(f"\n{l}")
    for tag, d in (('before', B), ('after', A)):
        r1, r0 = col(d, l, 'rate1'), col(d, l, 'rate0')
        chg = [a / b - 1 for a, b in zip(r1, r0)]
        raw, mg, ps, gd = col(d, l, 'designedRaw'), col(d, l, 'margin'), col(d, l, 'ps0'), col(d, l, 'guard')
        floor = d['floor']
        cr, su = col(d, l, 'cr'), col(d, l, 'surplus')
        drops = [c for c in chg if c < 0]
        print(f"  {tag:6} 2027 rate ${mean(r1):.4f} ({min(r1):.4f}-{max(r1):.4f}) | admin 2027 priced ${mean(col(d, l, 'admin1'))/M:.3f}M, booked ${mean(col(d, l, 'opex1'))/M:.3f}M"
              f" ({100*mean([a/c for a, c, re in zip(col(d, l, 'admin1'), col(d, l, 'charge1'), col(d, l, 'reins1'))]):.1f}% of charge)"
              f" | pure premium ${mean(col(d, l, 'pp1')):.4f}")
        print(f"         prior-board margin {100*min(mg):.2f}% to {100*max(mg):.2f}% (designed {100*min(raw):.2f}% to {100*max(raw):.2f}%, {sum(x < floor for x in raw)} at the floor)"
              f" | opening P/S {min(ps):.2f}-{max(ps):.2f}, guardrails: {sum(g == 'thin' for g in gd)} thin, {sum(g == 'rich' for g in gd)} rich")
        print(f"         2027 vs 2026 rate: {len(drops)} drops, {sum(c < -0.02 for c in chg)} over 2% (worst {100*min(chg):+.2f}%), mean {100*mean(chg):+.2f}%"
              f" | 5-yr CR {100*mean(cr):.1f}% ({100*min(cr):.1f}-{100*max(cr):.1f}) | surplus Y5 ${mean(su)/M:.1f}M (lowest ${min(su)/M:.1f}M, {sum(s < 0 for s in su)} below zero)")
    pb, pa = col(B, l, 'pp1'), col(A, l, 'pp1')
    print(f"  pure premium, paired by scenario: {sum(a != b for a, b in zip(pa, pb))} of {len(pa)} differ (max |diff| {max(abs(a-b) for a, b in zip(pa, pb)):.2e})")
