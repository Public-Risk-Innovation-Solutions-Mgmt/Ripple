#!/usr/bin/env python3
"""The event-design test (Legislation Change / WC Reform): write its job list, and tabulate its results.

    python3 scripts/simulations/event_design_matrix.py jobs  JOBS.json
    python3 scripts/simulations/run_matrix.py JOBS.json OUT_DIR --root CHECKOUT_WITH_SWITCHES
    python3 scripts/simulations/event_design_matrix.py table OUT_DIR

The switches (EVENT_DESIGN today | today-r0 | new, EVENT_STEP points, EVENT_CAP 3 | none, EVENT_SI_STEP 1 = Social
Inflation steps GL too, DEV_RANGES JSON) are NOT on aws: apply event-design-switches.patch to a scratch checkout
first (see README). Scenario 6, five years, market Medium, development Low and Mid, the new ranges; schedules: no
events, Legislation Change (#4) in year 2 / 4, WC Reform (#5) in year 2 / 4, and #4 y2 + Social Inflation (#8) y3.
The table gives each team's combined ratio by year, year-5 and lowest surplus, and what each event cost against
the no-event game, split one-time vs continuous by counterfactual runs (today-r0 = today without its fading
reserve strengthening; new0 = the new design with no step).
"""
import json, os, sys

NEW_RANGES = json.dumps({'Low': [0, 0.05], 'Mid': [0.03, 0.08], 'High': [0.07, 0.15]})
SCHEDULES = {
    'none': [], 'LC2': [{'shockId': '#4', 'yearNumber': 2}], 'LC4': [{'shockId': '#4', 'yearNumber': 4}],
    'WR2': [{'shockId': '#5', 'yearNumber': 2}], 'WR4': [{'shockId': '#5', 'yearNumber': 4}],
    'CAP': [{'shockId': '#4', 'yearNumber': 2}, {'shockId': '#8', 'yearNumber': 3}],
}
DESIGNS = [('today', 'today', 0, '3'), ('todayR0', 'today-r0', 0, '3'), ('new0', 'new', 0, '3'), ('new2', 'new', 2, '3'), ('new3', 'new', 3, '3')]
TEAMS = ['Expected · none', 'Expected · covers', '65% · none', '65% · covers', '80% · none', '80% · covers']

def jobs(path):
    out = []
    for lvl in ('Low', 'Mid'):
        base = {'SCEN': 6, 'DEV': lvl, 'MARKET': 'medium', 'DEV_RANGES': NEW_RANGES}
        out.append({'name': f'none-{lvl}', 'env': {**base, 'SCHED': '[]'}})
        for sk in ('LC2', 'LC4', 'WR2', 'WR4', 'CAP'):
            for name, design, step, cap in DESIGNS:
                out.append({'name': f'{sk}_{name}-{lvl}', 'env': {**base, 'SCHED': json.dumps(SCHEDULES[sk]),
                            'EVENT_DESIGN': design, 'EVENT_STEP': step, 'EVENT_CAP': cap, 'EVENT_SI_STEP': 1}})
        for step in (2, 3):
            out.append({'name': f'CAP_new{step}nocap-{lvl}', 'env': {**base, 'SCHED': json.dumps(SCHEDULES['CAP']),
                        'EVENT_DESIGN': 'new', 'EVENT_STEP': step, 'EVENT_CAP': 'none', 'EVENT_SI_STEP': 1}})
    json.dump(out, open(path, 'w'), indent=1)
    print(f'{len(out)} jobs -> {path}')

def table(d):
    def team(name, t):
        g = json.load(open(os.path.join(d, f'{name}.json')))
        rows = [next(x for x in r['teams'] if x['team'] == t) for r in g['rows']]
        return [r['cr'] for r in rows], [r['surplus'] / 1e6 for r in rows]
    for lvl in ('Low', 'Mid'):
        print(f'\n######## development {lvl}')
        for sk in ('LC2', 'LC4', 'WR2', 'WR4', 'CAP'):
            print(f'\n== {sk}')
            names = ['today', 'todayR0', 'new0', 'new2', 'new3'] + (['new2nocap', 'new3nocap'] if sk == 'CAP' else [])
            for t in TEAMS:
                base = team(f'none-{lvl}', t)[1][-1]
                print(f'  {t}')
                y5 = {}
                for n in names:
                    cr, s = team(f'{sk}_{n}-{lvl}', t); y5[n] = s[-1]
                    print(f"    {n:10} CR {' / '.join(f'{100 * c:.0f}' for c in cr)}   y5 {s[-1]:6.1f}   lowest {min(s):6.1f}"
                          + ('   BELOW ZERO' if min(s) < 0 else ''))
                print(f"    cost vs no events: today {base - y5['today']:.1f} (one-time {base - y5['todayR0']:.1f} + strengthening {y5['todayR0'] - y5['today']:.1f})"
                      f" | new S2 {base - y5['new2']:.1f}, S3 {base - y5['new3']:.1f} (one-time {base - y5['new0']:.1f} + step {y5['new0'] - y5['new2']:.1f} / {y5['new0'] - y5['new3']:.1f})")

if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('jobs', 'table'):
        sys.exit(__doc__)
    (jobs if sys.argv[1] == 'jobs' else table)(sys.argv[2])
