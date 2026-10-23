import json, sys
S='/tmp/claude-0/-home-user-insurance-game-testingv2/3bcca396-e501-5c12-a1a1-1e635345383a/scratchpad/'
mean=lambda a:sum(a)/len(a)
for tag in sys.argv[1:]:
  d=json.load(open(S+'ps-'+tag+'.json')); sc=d['scenarios']; ns=sorted(sc,key=int)
  print(f"#### {tag}  cap {({k:v/1e6 for k,v in d['capital'].items()})} range {d['range']} expBase {d['expBase']} ny {d['ny']} pc {d['pc']}")
  for l in ['WC','GL','Property']:
    L=[sc[n][l] for n in ns]
    m=[x['margin'] for x in L]; dr=[x['designedRaw'] for x in L]; ps=[x['ps0'] for x in L]
    g={k:sum(x['guard']==k for x in L) for k in ('thin','rich')}
    st={}
    for x in L: st[x['status0']]=st.get(x['status0'],0)+1
    line=(f"  {l:8} designed {min(dr)*100:+.2f}..{max(dr)*100:+.2f}% | margin {min(m)*100:.2f}..{max(m)*100:.2f}% floor {sum(abs(x-d['floor'])<1e-12 for x in m):2}"
          f" | open P/S {min(ps):.2f}..{max(ps):.2f} guard thin {g['thin']} rich {g['rich']} | surplus0 {min(x['surplus0'] for x in L)/1e6:.1f}..{max(x['surplus0'] for x in L)/1e6:.1f}M"
          f" | pre-game min surplus {min(x['preMin'] for x in L)/1e6:.1f}M | status0 {st} ECR0 {min(x['ecr0'] for x in L):.2f}..{max(x['ecr0'] for x in L):.2f}")
    print(line)
    if 'rate1' in L[0]:
      ch=[x['rate1']/x['rate0']-1 for x in L]
      neg=sum(any(v<0 for v in x['surplusPath']) for x in L)
      stp={}
      for x in L:
        for s in x['status']: stp[s]=stp.get(s,0)+1
      print(f"           rate27 {mean([x['rate1'] for x in L]):.4f} chg {min(ch)*100:+.1f}..{max(ch)*100:+.1f}% drops {sum(c<0 for c in ch)} | CCR10 {mean([x['ccr10'] for x in L])*100:.1f}%"
            f" | S5 {mean([x['surplus5'] for x in L])/1e6:.1f} ({min(x['surplus5'] for x in L)/1e6:.1f}) | S10 {mean([x['surplus10'] for x in L])/1e6:.1f} ({min(x['surplus10'] for x in L)/1e6:.1f})"
            f" | ever<0 {neg} (lowest {min(min(x['surplusPath']) for x in L)/1e6:.1f}M) | played status {stp}")
      u=sc['1'][l].get('ay2027')
      if u: print("           AY2027 sc1: "+' '.join(f"{v/1e6:.2f}" for v in u[:10]))
