// ============================================================================
// THE DECISIONS TAB — what every team chose, for a year that has been played.
//
// ⚠ TEAMS DOWN THE SIDE, DECISIONS ACROSS, which is the transpose of how a
// team sees its own. A team reads one column of its own choices over a year;
// the host is comparing the SAME choice across teams, and a column per
// decision is what makes "who declined reinsurance" a glance instead of a
// reading exercise.
//
// ⚠ COMPLETED YEARS ONLY, AND THAT IS NOT A SCREEN RULE. The year selector
// cannot offer the current year because there is nothing to offer: decisions
// ride in the record a team posts at year end, so a year in progress has no
// row to read. The screen is not hiding a value it holds — see
// TeamYearSummary.decisions. That is why there is no "live" mode here and no
// control that could produce one.
//
// ⚠ THE SAME THREE STATES THE TEAMS TAB DRAWS, for the same reason and with
// the same ordering of the checks:
//   ABSENT      the team does not write this line. One cell, not a row of
//               dashes, because dashes across a numeric row read as choices.
//   PENDING     the team writes it and has not posted this year.
//   NOT RECORDED the team posted the year, from a build before decisions were
//               carried. Distinct from PENDING: the year is in, the block is
//               not. Collapsing the two would tell a host to go chase a team
//               that has already reported.
//   REPORTED    the choices.
//
// ⚠ THE HIGHLIGHTS ARE THE POINT OF THE TAB. A host scanning ten teams by
// seven decisions is reading seventy cells; the three that matter are marked
// so the other sixty-seven can be skipped. What counts as unusual is defined
// in `flagsFor` and each flag says what it means on hover.
// ============================================================================

import { Fragment, useState } from 'react';
import { HardHat, Scale, Building2, AlertTriangle } from 'lucide-react';
import TabNav from '../../components/TabNav';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { formatPct } from '../../utils/formatters';
import { clfFor } from '../../utils/fundingConsequence';
import { REINSURANCE_TOWER } from '../../data/reinsuranceTower';
import type { CoverageLine } from '../../types/simulation';
import type { RoomView, TeamLineDecisions, TeamView, TeamYearSummary } from '../index';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

const LINE_VIEW_ICONS: Record<CoverageLine, React.ReactNode> = {
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

type CellState =
  | { kind: 'absent' }
  | { kind: 'pending' }
  | { kind: 'unrecorded' }
  | { kind: 'reported'; d: TeamLineDecisions };

/**
 * ⚠ THE ORDER OF THESE CHECKS IS THE WHOLE FUNCTION, exactly as it is in the
 * Teams tab's rowState. Absence before lateness: a team that does not write GL
 * is not late on GL and never will be. And POSTED-BUT-NO-BLOCK before
 * reported, so an old row reads "not recorded" rather than falling through to
 * a block of zeros that would look like a team funding at 0.00.
 */
function cellState(team: TeamView, line: CoverageLine, year: number): CellState {
  if (!team.lines.includes(line)) return { kind: 'absent' };
  const posted: TeamYearSummary | undefined = team.resultsByYear?.[String(year)];
  if (!posted) return { kind: 'pending' };
  const d = posted.decisions?.[line];
  if (!d) return { kind: 'unrecorded' };
  return { kind: 'reported', d };
}

interface Flag { key: string; label: string; title: string }

/**
 * WHAT COUNTS AS UNUSUAL. Three things, each a question a host would otherwise
 * have to ask every team in turn.
 *
 * ⚠ "BELOW EXPECTED" IS MEASURED AGAINST THE LINE'S OWN CROSSING, NOT A
 * NUMBER PICKED HERE. clfFor is the SAME dispatch the engine charges with, so
 * a load under 1.000 is funding below break-even by the engine's own
 * definition rather than by this screen's opinion. It also cannot drift: if
 * the tables move, this moves with them. Funding ABOVE expected is not flagged
 * — it is prudent, not unusual.
 *
 * ⚠ REINSURANCE: ANY BAND RETAINED, NOT ONLY A BARE TOWER. A corridor
 * retention — buying the top and keeping a middle band — is the choice most
 * worth a host's attention and the one a "declined everything" test would
 * miss entirely. The count says how exposed, the tooltip says which bands.
 */
function flagsFor(line: CoverageLine, d: TeamLineDecisions): Flag[] {
  const out: Flag[] = [];

  if (clfFor(line, d.confidenceLevel, d.atExpected) < 1) {
    out.push({
      key: 'funding',
      label: 'Funding below expected',
      title: `Funded at the ${formatPct(d.confidenceLevel, 0)} stop, which carries a loss load below `
        + '1.000 on this line\'s own curve — below break-even.',
    });
  }

  const declined = d.layersPlaced
    .map((placed, i) => (placed ? null : i))
    .filter((i): i is number => i !== null);
  if (declined.length > 0) {
    const bands = REINSURANCE_TOWER[line];
    const named = declined.map(i => bands[i]?.name ?? `band ${i + 1}`).join(', ');
    out.push({
      key: 'reinsurance',
      label: declined.length === d.layersPlaced.length
        ? 'Reinsurance declined'
        : `${declined.length} of ${d.layersPlaced.length} bands retained`,
      title: `Retained rather than placed: ${named}.`,
    });
  }

  if (d.dividendPct > 0) {
    out.push({
      key: 'dividend',
      label: `Dividend ${formatPct(d.dividendPct, 1)}`,
      title: 'A dividend returns surplus to members; flagged so the host sees it against the year\'s result.',
    });
  }
  if (d.assessmentPct > 0) {
    out.push({
      key: 'assessment',
      label: `Assessment ${formatPct(d.assessmentPct, 1)}`,
      title: 'An assessment calls surplus from members; flagged for the same reason as a dividend.',
    });
  }
  return out;
}

function fundingLabel(d: TeamLineDecisions): string {
  // "Expected" is a MODE, not a stop — see LineDecisionSet. Printing the
  // fallback percentile here would name a stop the team did not choose.
  return d.atExpected ? 'Expected' : formatPct(d.confidenceLevel, 0);
}

function reinsuranceLabel(d: TeamLineDecisions): string {
  const placed = d.layersPlaced.filter(Boolean).length;
  const total = d.layersPlaced.length;
  const agg = d.aggregateStopLevel >= 0 ? ' + agg' : '';
  return `${placed}/${total}${agg}`;
}

const SPAN_NOTE: Record<Exclude<CellState['kind'], 'reported'>, string> = {
  absent: 'Does not write this line',
  pending: 'Not reported yet',
  unrecorded: 'Decisions not recorded for this year',
};

interface Props { room: RoomView }

export default function HostDecisionsTab({ room }: Props) {
  const linesInPlay = LINE_ORDER.filter(l => room.teams.some(t => t.lines.includes(l)));
  const [line, setLine] = useState<CoverageLine>(linesInPlay[0] ?? 'WC');
  const effectiveLine = linesInPlay.includes(line) ? line : (linesInPlay[0] ?? 'WC');

  // ⚠ COMPLETED YEARS ONLY. The room is on currentYear, so the newest year
  // that has been played is currentYear - 1. Year 0 is the opening position
  // and carries no decisions by definition, so the list starts at 1.
  const latestCompleted = room.currentYear - 1;
  const years: number[] = [];
  for (let y = latestCompleted; y >= 1; y--) years.push(y);

  const [year, setYear] = useState<number | null>(null);
  const effectiveYear = year !== null && years.includes(year) ? year : (years[0] ?? null);

  const [openTeam, setOpenTeam] = useState<string | null>(null);

  if (room.teams.length === 0) {
    return (
      <p data-testid="decisions-empty" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        No teams have joined yet.
      </p>
    );
  }

  if (effectiveYear === null) {
    return (
      <p data-testid="decisions-no-year" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        No year has been completed yet. Each team's decisions appear here once the year they were made in has
        been advanced.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <TabNav<CoverageLine>
        tabs={linesInPlay.map(l => ({ id: l, label: LINE_FULL_NAME[l], icon: LINE_VIEW_ICONS[l] }))}
        activeTab={effectiveLine}
        onSelect={setLine}
        stickyTop={0}
        zIndex={10}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-medium text-slate-700">{LINE_FULL_NAME[effectiveLine]}</p>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Year
            <select
              data-testid="decisions-year"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              value={effectiveYear}
              onChange={e => setYear(Number(e.target.value))}
            >
              {years.map(y => (
                <option key={y} value={y}>{y}{y === latestCompleted ? ' (latest completed)' : ''}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table data-testid="decisions-table" className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Funding</th>
                <th className="px-3 py-2 font-medium">Reinsurance</th>
                <th className="px-3 py-2 font-medium">Renewal</th>
                <th className="px-3 py-2 font-medium">Intake</th>
                <th className="px-3 py-2 font-medium">Risk control</th>
                <th className="px-3 py-2 font-medium">Dividend / assessment</th>
                <th className="px-3 py-2 font-medium">Investments</th>
              </tr>
            </thead>
            <tbody>
              {room.teams.map(team => {
                const state = cellState(team, effectiveLine, effectiveYear);
                const open = openTeam === team.name;
                return (
                  <Fragment key={team.name}>
                    <tr
                      data-testid={`decisions-row-${team.name}`}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      onClick={() => setOpenTeam(open ? null : team.name)}
                    >
                      <td className="px-5 py-2 font-medium text-slate-700">{team.name}</td>
                      {state.kind !== 'reported' ? (
                        <td colSpan={7} className="px-3 py-2 text-xs italic text-slate-400">
                          {SPAN_NOTE[state.kind]}
                        </td>
                      ) : (
                        <DecisionCells line={effectiveLine} d={state.d} />
                      )}
                    </tr>
                    {open && (
                      <tr data-testid={`decisions-drill-${team.name}`}>
                        <td colSpan={8} className="bg-slate-50 px-5 py-3">
                          <TeamDrilldown team={team} line={effectiveLine} years={years} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DecisionCells({ line, d }: { line: CoverageLine; d: TeamLineDecisions }) {
  const flags = flagsFor(line, d);
  const flagged = (key: string) => flags.some(f => f.key === key);
  const mark = (key: string) =>
    flagged(key) ? 'rounded bg-amber-50 font-medium text-amber-700' : 'text-slate-600';
  const titleOf = (key: string) => flags.find(f => f.key === key)?.title;

  return (
    <>
      <td className="px-3 py-2">
        <span className={`px-1 ${mark('funding')}`} title={titleOf('funding')}>
          {fundingLabel(d)}
          {flagged('funding') && <AlertTriangle size={12} className="ml-1 inline align-[-1px]" />}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`px-1 ${mark('reinsurance')}`} title={titleOf('reinsurance')}>
          {reinsuranceLabel(d)}
          {flagged('reinsurance') && <AlertTriangle size={12} className="ml-1 inline align-[-1px]" />}
        </span>
      </td>
      <td className="px-3 py-2 text-slate-600">{formatPct(d.renewalCut, 0)}</td>
      <td className="px-3 py-2 text-slate-600">
        {d.intakeLevel === 0 ? 'None' : `Level ${d.intakeLevel}`}
      </td>
      <td className="px-3 py-2 text-slate-600">{formatPct(d.riskControlPct, 1)}</td>
      <td className="px-3 py-2">
        {d.dividendPct === 0 && d.assessmentPct === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span
            className={`px-1 ${flagged('dividend') || flagged('assessment') ? 'rounded bg-amber-50 font-medium text-amber-700' : ''}`}
            title={titleOf('dividend') ?? titleOf('assessment')}
          >
            {d.dividendPct > 0 ? `Div ${formatPct(d.dividendPct, 1)}` : ''}
            {d.dividendPct > 0 && d.assessmentPct > 0 ? ' / ' : ''}
            {d.assessmentPct > 0 ? `Assmt ${formatPct(d.assessmentPct, 1)}` : ''}
            <AlertTriangle size={12} className="ml-1 inline align-[-1px]" />
          </span>
        )}
      </td>
      {/* ⚠ 0-100, NOT A FRACTION — the one field on this row that is, and the
          driver caught it rendering as "1000% / 8000% / 1000%". Printed the way
          every other screen prints it (ResultsPage, DecisionHistoryPage): the
          number with a percent sign, never through formatPct. */}
      <td className="px-3 py-2 text-slate-600">
        {d.allocation.cashPct.toFixed(0)}% / {d.allocation.bondsPct.toFixed(0)}% / {d.allocation.equitiesPct.toFixed(0)}%
      </td>
    </>
  );
}

/**
 * THE DRILL-DOWN — one team, every completed year, decisions BESIDE that
 * year's results.
 *
 * ⚠ BESIDE, FROM THE SAME ROW. Both halves come out of the one
 * TeamYearSummary for that year, so a year's choices cannot be rendered
 * against another year's outcome. That pairing is the only reason the
 * drill-down is worth having over reading the two tabs side by side.
 */
function TeamDrilldown({ team, line, years }: { team: TeamView; line: CoverageLine; years: number[] }) {
  if (!team.lines.includes(line)) {
    return <p className="text-xs italic text-slate-400">{team.name} does not write {LINE_FULL_NAME[line]}.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left uppercase tracking-wide text-slate-400">
          <th className="py-1 font-medium">Year</th>
          <th className="py-1 font-medium">Funding</th>
          <th className="py-1 font-medium">Reinsurance</th>
          <th className="py-1 font-medium">Div / assmt</th>
          <th className="py-1 font-medium">Ending surplus</th>
          <th className="py-1 font-medium">Loss ratio</th>
        </tr>
      </thead>
      <tbody>
        {[...years].sort((a, b) => a - b).map(y => {
          const posted = team.resultsByYear?.[String(y)];
          const d = posted?.decisions?.[line];
          const f = posted?.byLine[line];
          return (
            <tr key={y} className="border-t border-slate-200/60">
              <td className="py-1 text-slate-600">{y}</td>
              <td className="py-1 text-slate-600">{d ? fundingLabel(d) : '—'}</td>
              <td className="py-1 text-slate-600">{d ? reinsuranceLabel(d) : '—'}</td>
              <td className="py-1 text-slate-600">
                {d ? (d.dividendPct > 0 || d.assessmentPct > 0
                  ? `${d.dividendPct > 0 ? formatPct(d.dividendPct, 1) : '—'} / ${d.assessmentPct > 0 ? formatPct(d.assessmentPct, 1) : '—'}`
                  : '—') : '—'}
              </td>
              <td className="py-1 text-slate-600">
                {f ? `$${(f.endingSurplus / 1e6).toFixed(2)}M` : '—'}
              </td>
              <td className="py-1 text-slate-600">
                {f ? formatPct(f.actualLossRatioPricingBasis, 1) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
