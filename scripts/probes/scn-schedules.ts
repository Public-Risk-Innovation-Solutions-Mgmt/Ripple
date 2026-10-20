import './flat-setup';
import { drawShockSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { seedFromInstanceId } from '../../src/seedHash';
import { SHOCK_EVENTS } from '../../src/utils/shockLosses';
(globalThis as any).__SHOCK_COUNT = (seed: string) => 2 + (seedFromInstanceId(seed) % 3);
let total = 0;
for (let n = 1; n <= 20; n++) { const s = drawShockSchedule(`SCENARIO-${n}`, 10, SOLO_SHOCK_STREAM); total += s.length;
  console.log(`${n}: ${s.map(x => `y${x.yearNumber} ${SHOCK_EVENTS.find(e => e.id === x.shockId)!.name}`).join(', ')}`); }
console.log(`mean shocks per game ${(total / 20).toFixed(2)}`);
