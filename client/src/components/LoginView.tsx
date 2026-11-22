import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { api } from '../api/client';
import type { AuthSessionInfo } from '../../../shared/types';

export function LoginView({ onSuccess }: { onSuccess: (session: AuthSessionInfo) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await api.login(username, password);
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={(e) => void handleSubmit(e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/icon.svg" alt="" className="brand-icon" width={38} height={38} aria-hidden="true" />
          <div>
            <h1 className="brand-title">MCServerManager</h1>
            <div className="brand-subtitle">Local Minecraft Panel</div>
          </div>
        </div>

        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
          Sign in to continue.
        </p>

        {error && (
          <div className="banner banner-danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            name="username"
            type="text"
            className="input"
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              id="login-password"
              name="password"
              type={showPw ? 'text' : 'password'}
              className="input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              aria-pressed={showPw}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          <Lock size={16} aria-hidden="true" />
          {busy ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </main>
  );
}
