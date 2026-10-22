// THE INVESTMENTS TAB — what the Departments tab's Investment document shows,
// on its own page: the same memo, built the same way (buildInvestmentMemo fills
// the asset table and the default allocation from the engine's constants).
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';
import { buildInvestmentMemo } from '../utils/investmentMemo';
import { renderMarkdown } from '../utils/renderMarkdown';

export default function InvestmentsPage() {
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      <div data-testid="document-body" className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 min-h-[400px]">
        <div
          className="prose prose-sm sm:prose-base prose-slate max-w-none prose-headings:font-bold prose-a:text-blue-600"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(buildInvestmentMemo(investmentMemoRaw)) }}
        />
      </div>
    </div>
  );
}
