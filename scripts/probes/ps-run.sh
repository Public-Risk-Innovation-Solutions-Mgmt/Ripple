#!/bin/bash
# usage: ps-run.sh TAG "ENV ASSIGNMENTS" ...  — runs each job in parallel, logs exit codes
S=/tmp/claude-0/-home-user-insurance-game-testingv2/3bcca396-e501-5c12-a1a1-1e635345383a/scratchpad
cd $S/wt-ps
while [ $# -gt 0 ]; do
  tag=$1; envs=$2; shift 2
  ( env WT=$S/wt-ps COPIES=$S/ps-copies TAG=$tag $envs npx tsx $S/${PROBE:-ri-ps-probe.mts} > $S/ps-$tag.json 2> $S/runlogs/ps-$tag.log; echo "$tag exit=$?" >> $S/runlogs/ps-exits.log ) &
done
wait
