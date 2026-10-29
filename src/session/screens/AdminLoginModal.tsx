// ============================================================================
// ADMIN LOGIN. Creating an admin account is no longer reachable from here —
// it moved behind the gate, into AdminScreen's management list, now that a
// seeded DEFAULT_ADMIN (adminAuth.ts) is the guaranteed way in on any browser.
//
// ⚠ WHAT HAPPENS AFTER A SUCCESSFUL LOGIN IS THE CALLER'S CALL, NOT THIS
// MODAL'S. The lobby's header link wants /admin; HostScreen's own gate is
// already sitting at /host and just needs its local admin state refreshed in
// place, not a navigation. `onSuccess` is where each caller decides that;
// `onClose` is only ever "the user dismissed this without logging in."
// ============================================================================

import { useState } from 'react';
import { X } from 'lucide-react';
import { adminLogin } from '../../admin/client/adminAuth';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AdminLoginModal({ onClose, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await adminLogin(username, password);
      if (!result.ok) { setError(result.error); return; }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Admin login</h2>
          <button type="button" onClick={onClose} className="text-slate-600 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          disabled={submitting}
          onClick={() => { void submit(); }}
          className="mt-4 w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
        >
          {submitting ? 'Working…' : 'Log in'}
        </button>
      </div>
    </div>
  );
}
