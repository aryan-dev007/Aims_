import React, { createContext, useCallback, useContext, useState } from 'react';
import { loginOwner } from '../api/client';

const OwnerAuthContext = createContext(null);

export function OwnerAuthProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const runOwnerAction = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (err.status !== 401) throw err;
      setPendingAction(() => action);
      setPassword('');
      setError('Sign in as the owner to continue.');
      setIsOpen(true);
      return undefined;
    }
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setPendingAction(null);
    setUsername('');
    setPassword('');
    setError('');
  }, []);

  const submitLogin = useCallback(async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await loginOwner(username, password);
      if (pendingAction) await pendingAction();
      closeDialog();
    } catch (err) {
      setError(err.message || 'Owner sign-in failed.');
    } finally {
      setBusy(false);
    }
  }, [closeDialog, password, pendingAction, username]);

  return (
    <OwnerAuthContext.Provider value={{ runOwnerAction }}>
      {children}
      {isOpen && (
        <div className="auth-backdrop">
          <section
            className="auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-auth-title"
          >
            <h2 id="owner-auth-title">Owner authentication</h2>
            <p>Enter the owner username and password to confirm this stock change.</p>
            {error && <p className="note note-error" role="alert">{error}</p>}
            <form onSubmit={submitLogin}>
              <label className="field">
                <span>Owner username</span>
                <input
                  className="input"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Owner password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="auth-actions">
                <button type="button" className="btn btn-ghost" onClick={closeDialog} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
                  {busy ? 'Verifying…' : 'Authenticate'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </OwnerAuthContext.Provider>
  );
}

export function useOwnerAuth() {
  const context = useContext(OwnerAuthContext);
  if (!context) throw new Error('useOwnerAuth must be used within OwnerAuthProvider');
  return context;
}
