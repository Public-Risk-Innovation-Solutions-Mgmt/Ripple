import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type TabId =
  | 'setup'
  | 'introduction'
  | 'investments'
  | 'rateIndication'
  | 'model'
  | 'departments'
  | 'history'
  | 'statement'
  | 'dashboard'
  | 'decisions'
  | 'decisionHistory'
  | 'marketSurvey'
  | 'financials'
  | 'results'
  | 'spreadsheet'
  | 'audit'
  | 'membership';

export interface Tab<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface TabNavProps<T extends string> {
  tabs: Tab<T>[];
  activeTab: T;
  onSelect: (tab: T) => void;
  stickyTop?: number; // px offset from viewport top when stacking multiple nav bars
  zIndex?: number;
  /**
   * Prev/Next chevrons flanking the tab list, stepping through `tabs` in
   * order (skipping a disabled one) and disabled at the ends rather than
   * wrapping. ⚠ OPT-IN, DEFAULT FALSE: every existing bar — the eleven-tab
   * top nav included — keeps today's click-only behavior unless a caller
   * asks for this.
   */
  showArrows?: boolean;
  /** Rendered after the tab list and before the Next arrow — e.g. a progress badge. */
  trailing?: React.ReactNode;
}

export default function TabNav<T extends string>({ tabs, activeTab, onSelect, stickyTop = 60, zIndex = 30, showArrows = false, trailing }: TabNavProps<T>) {
  const index = tabs.findIndex(t => t.id === activeTab);
  const step = (delta: number) => {
    const tab = tabs[index + delta];
    if (tab && !tab.disabled) onSelect(tab.id);
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky shadow-sm" style={{ top: stickyTop, zIndex }}>
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center gap-1">
          {showArrows && (
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={index <= 0}
              aria-label="Previous"
              className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                disabled={tab.disabled}
                onClick={() => !tab.disabled && onSelect(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : tab.disabled
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50'
                  }`}
              >
                <span className={activeTab === tab.id ? 'text-blue-600' : 'text-gray-600'}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
          {trailing}
          {showArrows && (
            <button
              type="button"
              onClick={() => step(1)}
              disabled={index < 0 || index >= tabs.length - 1}
              aria-label="Next"
              className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
