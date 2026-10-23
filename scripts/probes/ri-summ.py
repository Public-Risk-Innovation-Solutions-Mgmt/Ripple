import json, os
S='/tmp/claude-0/-home-user-insurance-game-testingv2/3bcca396-e501-5c12-a1a1-1e635345383a/scratchpad/'
runs=[('A','0'),('B','0'),('C','0'),('B','0.03'),('C','0.03'),('B','0.05'),('C','0.05')]
D={f"{r}{'' if p=='0' else '@'+p}": json.load(open(S+f'ri-{r}-{p}.json')) for r,p in runs if os.path.exists(S+f'ri-{r}-{p}.json')}
mean=lambda a:sum(a)/len(a)
print('multipliers', {k: round(v,4) for k,v in D['B']['multiplier'].items()})
for l in ['WC','GL','Property']:
  print('==',l)
  for k in ['A','B']:
    u=D[k]['scenarios']['1'][l]['ay2027']; print(f"  AY2027 {k}: " + ' '.join(f"{x/1e6:.2f}" for x in u[:10]) + f"  (+{(u[min(9,len(u)-1)]/u[0]-1)*100:.1f}%)")
  for k,d in D.items():
    L=[d['scenarios'][str(n)][l] for n in range(1,21)]
    ch=[x['rate1']/x['rate0']-1 for x in L]; m=[x['margin'] for x in L]
    print(f"  {k:6} res/prem open {mean([x['reserve0'] for x in L])/1e6:.1f}M {mean([x['reserve0']/x['premium0'] for x in L]):.2f} | y5 {mean([x['reserve5'] for x in L])/1e6:.1f}M {mean([x['reserve5']/x['premium5'] for x in L]):.2f} | y10 {mean([x['reserve10'] for x in L])/1e6:.1f}M {mean([x['reserve10']/x['premium10'] for x in L]):.2f}"
          " | paid y1/5/10 " + ' '.join('%.1f' % (mean([x['paid'][i] for x in L])/1e6) for i in range(3)) + "M")
    print(f"         rate27 {mean([x['rate1'] for x in L]):.4f} chg {min(ch)*100:+.1f}..{max(ch)*100:+.1f}% drops {sum(c<0 for c in ch)} | margin {min(m)*100:.2f}..{max(m)*100:.2f}% floor {sum(abs(x-d['floor'])<1e-12 for x in m)}"
          f" | CCR10 {mean([x['ccr10'] for x in L])*100:.1f}% | S5 {mean([x['surplus5'] for x in L])/1e6:.1f}M (low {min(x['surplus5'] for x in L)/1e6:.1f}) | S10 {mean([x['surplus10'] for x in L])/1e6:.1f}M (low {min(x['surplus10'] for x in L)/1e6:.1f})")
