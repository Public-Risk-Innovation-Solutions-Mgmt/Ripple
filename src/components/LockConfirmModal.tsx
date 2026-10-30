import { useEffect } from 'react';
import { Lock } from 'lucide-react';
import type { LockSummary } from '../utils/lockSummary';

interface LockConfirmModalProps {
  /** The program year the lock button names. */
  year: number | string;
  summary: LockSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

// THE LOCK CONFIRMATION (GameShell): the lock button opens this before anything
// happens — single player, Test player and hosted alike. Only "Lock decisions"
// locks the year (and, hosted, sends the decisions); "Go back", Escape or a
// click outside the box closes it and changes nothing.
export default function LockConfirmModal({ year, summary, onConfirm, onCancel }: LockConfirmModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const rows: [string, (l: LockSummary['lines'][number]) => string][] = [
    ['Funding', l => l.funding],
    ['Underwriting', l => l.underwriting],
    ['Covers', l => l.covers],
    ['Risk control', l => l.riskControl],
    ['Dividend / assessment', l => l.dividendAssessment],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      {/* ⚠ SCROLLS WHEN TALLER THAN THE WINDOW, as the loan prompt does. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-confirm-title"
        data-testid="lock-confirm"
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-blue-50">
          <Lock size={18} className="text-blue-600" />
          <h3 id="lock-confirm-title" className="font-bold text-gray-900">Lock your {year} decisions?</h3>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Once locked, they can't be changed this year.</p>

          <div className="space-y-3" data-testid="lock-confirm-summary">
            {summary.lines.map(l => (
              <div key={l.line} className="border border-gray-200 rounded-lg p-3" data-testid={`lock-confirm-line-${l.line}`}>
                <div className="font-semibold text-gray-900 mb-1.5">{l.name}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="text-gray-900">{value(l)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <div className="border border-gray-200 rounded-lg p-3 text-xs" data-testid="lock-confirm-assets">
              <span className="text-gray-500 mr-3">Asset mix (all lines)</span>
              <span className="text-gray-900">{summary.assetMix}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-gray-400"
            >
              Go back
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              Lock decisions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
