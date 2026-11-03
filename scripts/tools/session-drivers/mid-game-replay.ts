// ============================================================================
// A TEAM'S GAME REBUILT FROM A STORED ROOM, OUT OF THE BROWSER — the helper the
// mid-game-edits driver checks a team's posted results against
// (wip/mid-game-edits). It builds and replays exactly as useSessionGame does
// (buildTeamGame + replayTeamYears, the team's own decisions by year) and
// prints what the team would post for each year, as JSON.
//
//   npx tsx scripts/tools/session-drivers/mid-game-replay.ts <room.json> <team> <throughYear> [unedited]
//
// `unedited` rebuilds with the room's edits taken back out (no levels by year,
// the schedule as it stood at setup is not recoverable here, so only the
// levels are undone) — the driver's control: the posted result must NOT match it.
// ============================================================================
import { readFileSync } from 'node:fs';
import { buildTeamGame, replayTeamYears } from '../../../src/session/client/buildGame';
import { summarize } from '../../../src/session/client/results';
import type { RoomView } from '../../../src/session/contract';

const [file, teamName, through, mode] = process.argv.slice(2);
const room = JSON.parse(readFileSync(file, 'utf8'));
const team = room.teams.find((t: { name: string }) => t.name === teamName);
if (!team) throw new Error(`no team ${teamName}`);
const view = {
  seed: room.seed, yearCount: room.yearCount, startingYear: room.startingYear, eventName: room.eventName,
  poolName: room.poolName || room.eventName, shocks: room.shocks, priorDevelopment: room.priorDevelopment ?? {},
  ...(room.developmentLevels ? { developmentLevels: room.developmentLevels } : {}),
  ...(room.developmentLevelsByYear && mode !== 'unedited' ? { developmentLevelsByYear: room.developmentLevelsByYear } : {}),
  ...(room.shocksOn !== undefined ? { shocksOn: room.shocksOn } : {}),
} as RoomView;
const built = buildTeamGame(view, team.lines);
const out: Record<string, unknown> = {};
const r = replayTeamYears(built.gameState, Number(through) + 1, team.decisionsByYear);
for (const p of r.produced) out[String(p.result.yearNumber)] = summarize(p.result, p.gameState, p.surplusRange);
console.log(JSON.stringify(out));
