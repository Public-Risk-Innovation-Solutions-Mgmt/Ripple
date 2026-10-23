import json, sys
S='/tmp/claude-0/-home-user-insurance-game-testingv2/3bcca396-e501-5c12-a1a1-1e635345383a/scratchpad/'
mean=lambda a:sum(a)/len(a)
M=lambda x:x/1e6
LINES=['WC','GL','Property']
for tag in sys.argv[1:]:
  d=json.load(open(S+'ps-'+tag+'.json')); sc=d['scenarios']; ns=sorted(sc,key=int)
  print(f"#### {tag} growth {d.get('growth',0)} cap {({k:v/1e6 for k,v in d['capital'].items()})} ranges {d['ranges']}")
  for l in LINES:
    L=[sc[n][l] for n in ns]
    m=[x['margin'] for x in L]; dr=[x['designedRaw'] for x in L]; ps=[x['ps0'] for x in L]
    g={k:sum(x['guard']==k for x in L) for k in ('thin','rich')}
    print(f"  {l:8} designed {min(dr)*100:+.2f}..{max(dr)*100:+.2f}% | charged {min(m)*100:.2f}..{max(m)*100:.2f}% floor {sum(abs(x-d['floor'])<1e-12 for x in m)} | open P/S {min(ps):.2f}..{max(ps):.2f} hits thin {g['thin']} rich {g['rich']} | surplus0 {M(min(x['surplus0'] for x in L)):.1f}..{M(max(x['surplus0'] for x in L)):.1f} | reserve0 mean {M(mean([x['reserve0'] for x in L])):.1f} ({M(min(x['reserve0'] for x in L)):.1f}..{M(max(x['reserve0'] for x in L)):.1f})")
    pre=[r for x in L for r in x['prePath']]
    exp0=[x['prePath'][0][5] for x in L]; expN=[x['prePath'][-1][5] for x in L]
    lr=[r[4]/r[2] for r in pre]
    lrByYear={}
    for r in pre: lrByYear.setdefault(r[0],[]).append(r[4]/r[2])
    print(f"           exposure first pre-game yr {mean(exp0):.1f} last {mean(expN):.1f} | pre-game LR {min(lr)*100:.0f}..{max(lr)*100:.0f}% (by year mean " + ' '.join(f"{y}:{mean(v)*100:.0f}" for y,v in sorted(lrByYear.items())) + f") | pre-game low surplus {M(min(x['preMin'] for x in L)):.1f} | pre-game status {dict((s,sum(r[3]==s for r in pre)) for s in set(r[3] for r in pre))}")
    if 'rate1' not in L[0]: continue
    ch=[x['rate1']/x['rate0']-1 for x in L]
    neg=sum(any(v<0 for v in x['surplusPath']) for x in L)
    defic=sum(s=='Deficient' for x in L for s in x['status']); thin=sum(s=='Thin' for x in L for s in x['status'])
    # lowest surplus at any point (pre-game + played), with that year's premium
    pts=[(r[1],r[2],f"sc{n} {2026+r[0]}") for n,x in zip(ns,L) for r in x['prePath']]+[(v,p,f"sc{n} {2026+i+1}") for n,x in zip(ns,L) for i,(v,p) in enumerate(zip(x['surplusPath'],x['premiumPath']))]
    lo=min(pts)
    print(f"           2027 chg {min(ch)*100:+.1f}..{max(ch)*100:+.1f}% drops {sum(c<0 for c in ch)} | S5 {M(mean([x['surplus5'] for x in L])):.1f} ({M(min(x['surplus5'] for x in L)):.1f}) S10 {M(mean([x['surplus10'] for x in L])):.1f} ({M(min(x['surplus10'] for x in L)):.1f})"
          f" | ever<0 {neg} | Deficient yrs {defic} Thin {thin} | CCR10 {mean([x['ccr10'] for x in L])*100:.1f}% | lowest any point {M(lo[0]):.1f}M at {lo[2]}, premium {M(lo[1]):.1f}M, P/S {lo[1]/lo[0] if lo[0]>0 else float('inf'):.2f}")
  if 'rate1' in sc[ns[0]]['WC']:
    p5=[sum(sc[n][l]['surplus5'] for l in LINES) for n in ns]; p10=[sum(sc[n][l]['surplus10'] for l in LINES) for n in ns]
    pneg=sum(any(sum(sc[n][l]['surplusPath'][i] for l in LINES)<0 for i in range(10)) for n in ns)
    print(f"  POOL     S5 {M(mean(p5)):.1f} ({M(min(p5)):.1f}) S10 {M(mean(p10)):.1f} ({M(min(p10)):.1f}) ever<0 {pneg}")
    for b in LINES:
      offers=[o for n in ns for o in sc[n].get('loans',[]) if o['line']==b]
      sy=len({(n,o['year']) for n in ns for o in sc[n].get('loans',[]) if o['line']==b})
      wy=sum(o['needing'] for o in offers); tot=len(ns)*10*(offers[0]['of'] if offers else 100)
      lend={}
      for o in offers:
        for a,sh in o['lenders'].items(): lend[a]=lend.get(a,0)+sh*o['needing']
      scs=len({n for n in ns for o in sc[n].get('loans',[]) if o['line']==b})
      print(f"  LOANS to {b:8} scenario-years with an offer {sy} (in {scs} scenarios) | world-years needing {wy}/{tot} ({wy/tot*100:.1f}%) | lent by " + ', '.join(f"{a} {v/max(wy,1)*100:.0f}%" for a,v in lend.items()))
