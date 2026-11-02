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
  TrendingUp, Percent, Users, Sigma, Trophy,
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
  marketSurvey: { label: 'Market Survey', icon: <Trophy size={16} /> },
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
  'marketSurvey',
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
 *
 * ⚠ RESULTS, RESULT SPREADSHEET, FINANCIAL STATEMENTS AND MODEL ARE HIDDEN
 * EVERYWHERE — single player, Test player and a hosted session — since the tab
 * cleanup: the Annual Statement and the Year Walkthrough carry what players
 * need, each with its own download. Ruled acceptable to lose with them: the
 * Results (.xlsx) and Claims (.xlsx) downloads (Result Spreadsheet only), the
 * Results page's Reserve View, Financial Statements' Funding Target & Adequacy
 * in full, and the Model tab's step-by-step rate. The pages, their builders
 * and their gates are kept; delete a line here to bring one back.
 */
export const HIDDEN_TABS: readonly TabId[] = [
  'setup',
  'investments',
  'dashboard',
  'departments',
  'results',
  'spreadsheet',
  'financials',
  'model',
];

/**
 * Hidden in a hosted session (players and viewers) on top of HIDDEN_TABS.
 * ⚠ 'audit' — THE YEAR WALKTHROUGH — IS HIDDEN IN A HOSTED SESSION: where the
 * figures come from is not shown to a team. Single player and Test player keep
 * it. The page and its code are untouched (gates still read them).
 */
export const MULTIPLAYER_HIDDEN_TABS: readonly TabId[] = ['audit'];

/**
 * Hidden OUTSIDE a hosted session — single player and Test player — on top of
 * HIDDEN_TABS. The Market Survey is every team in the ROOM, and those games
 * have no room.
 */
export const SOLO_HIDDEN_TABS: readonly TabId[] = ['marketSurvey'];

/** Whether a tab is hidden on this screen. */
export function isHiddenTab(t: TabId, multiplayer: boolean): boolean {
  return HIDDEN_TABS.includes(t)
    || (multiplayer && MULTIPLAYER_HIDDEN_TABS.includes(t))
    || (!multiplayer && SOLO_HIDDEN_TABS.includes(t));
}

/** The top bar for this screen, in order. */
export function topBarTabs(opts: { multiplayer: boolean; hasSetup: boolean }): { id: TabId; label: string; icon: React.ReactNode }[] {
  return TAB_ORDER
    .filter(t => t !== 'setup' || opts.hasSetup)
    .filter(t => !isHiddenTab(t, opts.multiplayer))
    .map(id => ({ id, ...TAB_DEFS[id] }));
}
