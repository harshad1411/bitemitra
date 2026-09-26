'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionExpired, setAccessToken } from './api';

const AuthContext = createContext(null);

/** Session bootstrap: a silent cookie refresh on load, then /v1/me. */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null });

  const loadMe = useCallback(async () => {
    const me = await api.get('/v1/me');
    setState({ status: 'authenticated', me });
    return me;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await api.refreshSession();
      if (cancelled) return;
      if (!ok) return setState({ status: 'anonymous', me: null });
      try {
        await loadMe();
      } catch {
        if (!cancelled) setState({ status: 'anonymous', me: null });
      }
    })();
    const off = onSessionExpired(() => setState({ status: 'anonymous', me: null }));
    return () => {
      cancelled = true;
      off();
    };
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const res = await api.post(
      '/v1/admin/auth/login',
      { email, password },
      { auth: false, idempotencyKey: false },
    );
    // Two-step sign-in (D-106): the caller asks for the code, then calls verifyCode.
    if (res.twoFactor) return { twoFactor: res.twoFactor };
    setAccessToken(res.accessToken);
    setState({ status: 'authenticated', me: res.me });
    return { me: res.me };
  }, []);

  const verifyCode = useCallback(async (challengeId, code) => {
    const res = await api.post(
      '/v1/admin/auth/verify',
      { challengeId, code },
      { auth: false, idempotencyKey: false },
    );
    setAccessToken(res.accessToken);
    setState({ status: 'authenticated', me: res.me });
    return { me: res.me };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/v1/auth/logout', {}, { idempotencyKey: false });
    } finally {
      setAccessToken(null);
      setState({ status: 'anonymous', me: null });
    }
  }, []);

  const value = useMemo(() => {
    const perms = new Set(state.me?.admin?.permissions ?? []);
    return {
      ...state,
      login,
      verifyCode,
      logout,
      reload: loadMe,
      /** UI convenience only — the API enforces every permission (RBAC.md §1). */
      can: (p) => perms.has(p),
    };
  }, [state, login, verifyCode, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
