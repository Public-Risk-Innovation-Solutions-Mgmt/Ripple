#!/usr/bin/env python3
"""Run many sim-room games in parallel from a JSON job list, skipping any whose output already exists.

    python3 scripts/simulations/run_matrix.py JOBS.json OUT_DIR [--parallel 4] [--root CHECKOUT]

JOBS.json is a list of {"name": "...", "env": {...}}: each job's env is added to the environment of one
`npx tsx scripts/simulations/sim-room.mts` run (SCEN, DEV, SCHED, TEAMS, MARKET, and any switches the checkout
reads, e.g. EVENT_DESIGN). The output is OUT_DIR/<name>.json and the log OUT_DIR/logs/<name>.log. Prints one
line per job (ok / FAIL / skip) and a total.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    jobs_file, out_dir = args[0], os.path.abspath(args[1])
    par = int(args[args.index('--parallel') + 1]) if '--parallel' in args else 4
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(args[args.index('--root') + 1]) if '--root' in args else os.path.abspath(os.path.join(here, '..', '..'))
    os.makedirs(os.path.join(out_dir, 'logs'), exist_ok=True)
    jobs = json.load(open(jobs_file))

    def run(job):
        out = os.path.join(out_dir, f"{job['name']}.json")
        if os.path.exists(out):
            return f"skip {job['name']}"
        env = {**os.environ, 'ROOT': root, 'OUT': out, **{k: str(v) for k, v in job.get('env', {}).items()}}
        with open(os.path.join(out_dir, 'logs', f"{job['name']}.log"), 'w') as log:
            rc = subprocess.call(['npx', 'tsx', os.path.join(here, 'sim-room.mts')], cwd=root, env=env, stdout=log, stderr=log)
        return f"{'ok' if rc == 0 else 'FAIL'} {job['name']}"

    results = []
    with ThreadPoolExecutor(par) as ex:
        for line in ex.map(run, jobs):
            print(line, flush=True); results.append(line)
    print(f"ok {sum(r.startswith('ok') for r in results)} skip {sum(r.startswith('skip') for r in results)} "
          f"fail {sum(r.startswith('FAIL') for r in results)}")

if __name__ == '__main__':
    main()
