import json, os
S='/tmp/claude-0/-home-user-insurance-game-testingv2/3bcca396-e501-5c12-a1a1-1e635345383a/scratchpad/'
runs=[('A','ri-A-0'),('C','ri-C-0')]+[(f"P{n}@{p}",f"ri-P{n}-{p}") for n in (2,3,5) for p in ('0','0.03','0.05')]
D={k: json.load(open(S+f+'.json')) for k,f in runs if os.path.exists(S+f+'.json')}
mean=lambda a:sum(a)/len(a)
for l in ['WC','GL','Property']:
  A=[D['A']['scenarios'][str(n)][l] for n in range(1,21)]
  print('==',l)
  for k,d in D.items():
    L=[d['scenarios'][str(n)][l] for n in range(1,21)]
    ch=[x['rate1']/x['rate0']-1 for x in L]; m=[x['margin'] for x in L]
    vsA=mean([x['rate1'] for x in L])/mean([x['rate1'] for x in A])-1
    print(f"  {k:8} mult {d['multiplier'][l] if k[0]=='P' else 0:.4f} rate27 {mean([x['rate1'] for x in L]):.4f} vsA {vsA*100:+.1f}% chg {min(ch)*100:+.1f}..{max(ch)*100:+.1f}% drops {sum(c<0 for c in ch):2} | margin {min(m)*100:.2f}..{max(m)*100:.2f}% floor {sum(abs(x-d['floor'])<1e-12 for x in m):2}"
          f" | CCR10 {mean([x['ccr10'] for x in L])*100:.1f}% | S5 {mean([x['surplus5'] for x in L])/1e6:.1f} ({min(x['surplus5'] for x in L)/1e6:.1f}) | S10 {mean([x['surplus10'] for x in L])/1e6:.1f} ({min(x['surplus10'] for x in L)/1e6:.1f})")
