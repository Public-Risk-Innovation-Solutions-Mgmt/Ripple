// ============================================================================
// THE TOP BAR — ITS ORDER AND ITS HIDDEN TABS, IN ONE PLACE.
//
// GameShell lists exactly what this file says, in this order. To move a tab,
// move its line in TAB_ORDER; to restore a hidden one, delete its line from
// HIDDEN_TABS (or MULTIPLAYER_HIDDEN_TABS). The pages, their routes and their
// data are untouched by either list: a hidden tab is neither listed nor
// rendered, and nothing else about it changes.
// ============================================================================
import type React from 'react';
import {
  LayoutDashboard, ClipboardList, FileText, Settings, BarChart2,
  Calculator, Table, History as HistoryIcon, ScrollText, BookOpen, Landmark,
  TrendingUp, Percent, Users, Sigma,
} from 'lucide-react';
import type { TabId } from '../components/TabNav';

export const TAB_DEFS: Record<TabId, { label: string; icon: React.ReactNode }> = {
  setup: { label: 'Game Setup', icon: <Settings size={16} /> },
  introduction: { label: 'Introduction', icon: <BookOpen size={16} /> },
  investments: { label: 'Investments', icon: <TrendingUp size={16} /> },
  rateIndication: { label: 'Rate Indication', icon: <Percent size={16} /> },
  model: { label: 'Model', icon: <Sigma size={16} /> },
  statement: { label: 'Annual Statement', icon: <HistoryIcon size={16} /> },
  departments: { label: 'Departments', icon: <Landmark size={16} /> },
  dashboard: { label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  decisions: { label: 'Decisions', icon: <ClipboardList size={16} /> },
  decisionHistory: { label: 'Decision History', icon: <ScrollText size={16} /> },
  financials: { label: 'Financial Statements', icon: <FileText size={16} /> },
  results: { label: 'Results', icon: <BarChart2 size={16} /> },
  spreadsheet: { label: 'Result Spreadsheet', icon: <Table size={16} /> },
  // The Year Walkthrough, in the slot the Calculation Audit held (the id stays 'audit').
  audit: { label: 'Year Walkthrough', icon: <Calculator size={16} /> },
  // Hidden by being absent from TAB_ORDER — see the note there.
  history: { label: 'Pool History', icon: <HistoryIcon size={16} /> },
  membership: { label: 'Membership', icon: <Users size={16} /> },
};

/** The top bar, left to right. Game Setup is listed only where there is a setup page (solo). */
export const TAB_ORDER: readonly TabId[] = [
  'setup',
  'introduction',
  'investments',
  'rateIndication',
  'model',
  'statement',
  'departments',
  'dashboard',
  'decisions',
  'decisionHistory',
  'financials',
  'results',
  'spreadsheet',
  'audit',
  // ⚠ NOT LISTED: 'membership' (the pool is shown in aggregate; MembershipPage
  // and its route are intact) and 'history' (the Annual Statement replaced Pool
  // History; HistoryPage is kept in the tree, unrouted).
];

/**
 * Hidden in solo and multiplayer alike. Game Setup is the page a solo game
 * starts from (and returns to on New Game); it is off the bar, not removed.
 * Dashboard and Departments are hidden while they are reworked. Investments is
 * hidden because its memorandum moved into the Introduction tab.
 */
export const HIDDEN_TABS: readonly TabId[] = [
  'setup',
  'investments',
  'dashboard',
  'departments',
];

/** Hidden in a hosted session (players and viewers) as well. Result Spreadsheet stays, for testing. */
export const MULTIPLAYER_HIDDEN_TABS: readonly TabId[] = [
  'results',
  'financials',
  // ⚠ 'audit' — THE YEAR WALKTHROUGH — IS SHOWN IN A HOSTED SESSION TOO.
  // ⚠ THE MODEL TAB IS SOLO ONLY, NEVER MULTIPLAYER: it shows every input to
  // the rate and every expectation against the simulation, for checking the
  // indication by hand. To hide it in solo as well, add 'model' to HIDDEN_TABS.
  'model',
];

/** Whether a tab is hidden on this screen. */
export function isHiddenTab(t: TabId, multiplayer: boolean): boolean {
  return HIDDEN_TABS.includes(t) || (multiplayer && MULTIPLAYER_HIDDEN_TABS.includes(t));
}

/** The top bar for this screen, in order. */
export function topBarTabs(opts: { multiplayer: boolean; hasSetup: boolean }): { id: TabId; label: string; icon: React.ReactNode }[] {
  return TAB_ORDER
    .filter(t => t !== 'setup' || opts.hasSetup)
    .filter(t => !isHiddenTab(t, opts.multiplayer))
    .map(id => ({ id, ...TAB_DEFS[id] }));
}
