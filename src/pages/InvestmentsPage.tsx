// THE INVESTMENTS TAB — HIDDEN (src/game/tabs.tsx): the Investment memorandum
// now sits in the Introduction tab. The same memo, built the same way, on its
// own page, should the tab be restored.
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';
import type { GameState } from '../types/simulation';
import { buildInvestmentMemo, currentAllocation } from '../utils/investmentMemo';
import { renderMarkdown } from '../utils/renderMarkdown';

export default function InvestmentsPage({ gameState }: { gameState: GameState }) {
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      <div data-testid="document-body" className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 min-h-[400px]">
        <div
          className="prose prose-sm sm:prose-base prose-slate max-w-none prose-headings:font-bold prose-a:text-blue-600"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(buildInvestmentMemo(investmentMemoRaw, currentAllocation(gameState))) }}
        />
      </div>
    </div>
  );
}
