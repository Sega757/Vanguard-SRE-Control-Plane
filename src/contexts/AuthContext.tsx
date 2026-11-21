import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import type { ArbiterSettings, UserProfile, UserSecurity } from '../types';

const BOOTSTRAPPED_ADMIN_EMAIL = 'segamega757575@gmail.com';

export const DEFAULT_SETTINGS: Omit<ArbiterSettings, 'ownerId' | 'updatedAt'> = {
  maxRetriesPerAnchor: 3,
  maxTotalRollbacks: 8,
  maxConstraints: 5,
  maxRepeatRejects: 3,
  replanSteps: 2,
  controlRunEnabled: true,
  autoApproveIdempotent: true,
  theme: 'dark',
};

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  security: UserSecurity | null;
  settings: ArbiterSettings | null;
  loading: boolean;
  isAuthReady: boolean;
  authError: string | null;
  twoFactorVerified: boolean;
  twoFactorToken: string | null;
  theme: 'dark' | 'light';
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  markTwoFactorVerified: (serverToken?: string | null) => void;
  requireTwoFactorReauth: (reason?: string) => void;
  getAuthHeaders: () => Record<string, string>;
  setTheme: (next: 'dark' | 'light') => Promise<void>;
  updateSettings: (partial: Partial<Omit<ArbiterSettings, 'ownerId' | 'updatedAt'>>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [security, setSecurity] = useState<UserSecurity | null>(null);
  const [settings, setSettings] = useState<ArbiterSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [twoFactorVerified, setTwoFactorVerified] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');

  const lastSynced2faRef = useRef<string | null>(null);

  const applyThemeDom = useCallback((next: 'dark' | 'light') => {
    setThemeState(next);
    const root = document.documentElement;
    if (next === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    applyThemeDom('dark');
  }, [applyThemeDom]);

  useEffect(() => {
    let unmounted = false;
    let activeRunToken = 0;
    let unsubProfile: (() => void) | null = null;
    let unsubSecurity: (() => void) | null = null;
    let unsubSettings: (() => void) | null = null;
    let syncAbort: AbortController | null = null;

    const cleanupSubListeners = () => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubSecurity) {
        unsubSecurity();
        unsubSecurity = null;
      }
      if (unsubSettings) {
        unsubSettings();
        unsubSettings = null;
      }
      if (syncAbort) {
        syncAbort.abort();
        syncAbort = null;
      }
    };

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      const runToken = ++activeRunToken;
      cleanupSubListeners();

      if (unmounted) return;
      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        lastSynced2faRef.current = null;
        setProfile(null);
        setSecurity(null);
        setSettings(null);
        setTwoFactorVerified(false);
        setTwoFactorToken(null);
        setLoading(false);
        setIsAuthReady(true);
        return;
      }

      setLoading(true);
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, 'users', user.uid);

      try {
        const snap = await getDoc(userRef);
        if (unmounted || runToken !== activeRunToken) return;

        if (!snap.exists()) {
          const isAdminEmail =
            user.emailVerified && user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
          const newProfile = {
            uid: user.uid,
            email: (user.email || 'user@example.com').slice(0, 254),
            displayName: (user.displayName || user.email?.split('@')[0] || 'Оператор').slice(0, 120),
            photoURL: (user.photoURL || '').slice(0, 500),
            role: isAdminEmail ? 'admin' : 'operator',
            status: 'active',
            twoFactorEnabled: false,
            canRunAgent: true,
            canApproveIrreversible: isAdminEmail,
            canManageIntegrations: isAdminEmail,
            canExportAuditLogs: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userRef, newProfile);
          if (unmounted || runToken !== activeRunToken) return;
        }
      } catch (err) {
        if (unmounted || runToken !== activeRunToken) return;
        try {
          handleFirestoreError(err, OperationType.WRITE, userPath);
        } catch (wrapped) {
          setAuthError(wrapped instanceof Error ? wrapped.message : String(wrapped));
          setLoading(false);
          setIsAuthReady(true);
          return;
        }
      }

      // Bootstrap user settings document if missing
      const settingsPath = `settings/${user.uid}`;
      const settingsRef = doc(db, 'settings', user.uid);
      try {
        const sSnap = await getDoc(settingsRef);
        if (unmounted || runToken !== activeRunToken) return;
        if (!sSnap.exists()) {
          await setDoc(settingsRef, {
            ownerId: user.uid,
            ...DEFAULT_SETTINGS,
            updatedAt: serverTimestamp(),
          });
          if (unmounted || runToken !== activeRunToken) return;
        }
      } catch {
        // Non-blocking settings bootstrap fallback
      }

      unsubProfile = onSnapshot(
        userRef,
        (docSnap) => {
          if (unmounted || runToken !== activeRunToken) return;
          if (docSnap.exists()) {
            const p = docSnap.data() as UserProfile;
            setProfile(p);

            // Deduplicated server-side 2FA enforcement sync with AbortController
            const syncKey = `${user.uid}:${Boolean(p.twoFactorEnabled)}`;
            if (lastSynced2faRef.current !== syncKey) {
              lastSynced2faRef.current = syncKey;
              if (syncAbort) syncAbort.abort();
              syncAbort = new AbortController();
              void fetch('/api/2fa/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: user.uid, enabled: Boolean(p.twoFactorEnabled) }),
                signal: syncAbort.signal,
              }).catch(() => {});
            }

            if (!p.twoFactorEnabled) {
              setTwoFactorVerified(true);
              setTwoFactorToken(null);
            } else {
              const storedOk = sessionStorage.getItem(`vanguard_2fa_ok_${user.uid}`) === '1';
              const storedToken = sessionStorage.getItem(`vanguard_2fa_token_${user.uid}`);
              if (storedOk && storedToken) {
                setTwoFactorToken(storedToken);
                setTwoFactorVerified(true);
              } else {
                setTwoFactorToken(null);
                setTwoFactorVerified(false);
              }
            }
          }
          setLoading(false);
          setIsAuthReady(true);
        },
        (err) => {
          if (unmounted || runToken !== activeRunToken) return;
          try {
            handleFirestoreError(err, OperationType.GET, userPath);
          } catch (wrapped) {
            setAuthError(wrapped instanceof Error ? wrapped.message : String(wrapped));
            setLoading(false);
            setIsAuthReady(true);
          }
        }
      );

      const secRef = doc(db, 'users', user.uid, 'security', 'totp');
      unsubSecurity = onSnapshot(
        secRef,
        (docSnap) => {
          if (unmounted || runToken !== activeRunToken) return;
          if (docSnap.exists()) {
            setSecurity(docSnap.data() as UserSecurity);
          } else {
            setSecurity(null);
          }
        },
        () => {
          if (!unmounted && runToken === activeRunToken) {
            setSecurity(null);
          }
        }
      );

      unsubSettings = onSnapshot(
        settingsRef,
        (docSnap) => {
          if (unmounted || runToken !== activeRunToken) return;
          if (docSnap.exists()) {
            const s = docSnap.data() as ArbiterSettings;
            setSettings(s);
            if (s.theme === 'dark' || s.theme === 'light') {
              applyThemeDom(s.theme);
            }
          }
        },
        () => {
          // Safely ignore transient settings listener errors on sign-out
        }
      );
    });

    return () => {
      unmounted = true;
      activeRunToken += 1;
      unsubAuth();
      cleanupSubListeners();
    };
  }, [applyThemeDom]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка входа через Google';
      setAuthError(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    if (twoFactorToken) {
      void fetch('/api/2fa/logout', {
        method: 'POST',
        headers: { 'x-vanguard-2fa-token': twoFactorToken },
      }).catch(() => {});
    }
    if (firebaseUser) {
      sessionStorage.removeItem(`vanguard_2fa_ok_${firebaseUser.uid}`);
      sessionStorage.removeItem(`vanguard_2fa_token_${firebaseUser.uid}`);
    }
    lastSynced2faRef.current = null;
    setTwoFactorVerified(false);
    setTwoFactorToken(null);
    await signOut(auth);
  }, [firebaseUser, twoFactorToken]);

  const markTwoFactorVerified = useCallback(
    (serverToken?: string | null) => {
      if (firebaseUser) {
        sessionStorage.setItem(`vanguard_2fa_ok_${firebaseUser.uid}`, '1');
        if (serverToken) {
          sessionStorage.setItem(`vanguard_2fa_token_${firebaseUser.uid}`, serverToken);
          setTwoFactorToken(serverToken);
        }
      }
      setTwoFactorVerified(true);
    },
    [firebaseUser]
  );

  const requireTwoFactorReauth = useCallback(
    (reason?: string) => {
      if (firebaseUser) {
        sessionStorage.removeItem(`vanguard_2fa_ok_${firebaseUser.uid}`);
        sessionStorage.removeItem(`vanguard_2fa_token_${firebaseUser.uid}`);
      }
      setTwoFactorToken(null);
      if (profile?.twoFactorEnabled) {
        setTwoFactorVerified(false);
      }
      if (reason) {
        setAuthError(reason);
      }
    },
    [firebaseUser, profile?.twoFactorEnabled]
  );

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (firebaseUser?.uid) {
      headers['x-vanguard-uid'] = firebaseUser.uid;
    }
    if (profile?.role) {
      headers['x-vanguard-role'] = profile.role;
    }
    if (profile?.twoFactorEnabled) {
      headers['x-vanguard-2fa-required'] = 'true';
    }
    if (twoFactorToken) {
      headers['x-vanguard-2fa-token'] = twoFactorToken;
    }
    return headers;
  }, [firebaseUser?.uid, profile?.role, profile?.twoFactorEnabled, twoFactorToken]);

  const updateSettings = useCallback(
    async (partial: Partial<Omit<ArbiterSettings, 'ownerId' | 'updatedAt'>>) => {
      if (!firebaseUser) return;
      const settingsPath = `settings/${firebaseUser.uid}`;
      const settingsRef = doc(db, 'settings', firebaseUser.uid);
      try {
        const merged = {
          maxRetriesPerAnchor: settings?.maxRetriesPerAnchor ?? DEFAULT_SETTINGS.maxRetriesPerAnchor,
          maxTotalRollbacks: settings?.maxTotalRollbacks ?? DEFAULT_SETTINGS.maxTotalRollbacks,
          maxConstraints: settings?.maxConstraints ?? DEFAULT_SETTINGS.maxConstraints,
          maxRepeatRejects: settings?.maxRepeatRejects ?? DEFAULT_SETTINGS.maxRepeatRejects,
          replanSteps: settings?.replanSteps ?? DEFAULT_SETTINGS.replanSteps,
          controlRunEnabled: settings?.controlRunEnabled ?? DEFAULT_SETTINGS.controlRunEnabled,
          autoApproveIdempotent: settings?.autoApproveIdempotent ?? DEFAULT_SETTINGS.autoApproveIdempotent,
          theme: settings?.theme ?? theme,
          ...partial,
          updatedAt: serverTimestamp(),
        };
        if (partial.theme) {
          applyThemeDom(partial.theme);
        }
        await updateDoc(settingsRef, merged);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, settingsPath);
      }
    },
    [firebaseUser, settings, theme, applyThemeDom]
  );

  const setTheme = useCallback(
    async (next: 'dark' | 'light') => {
      applyThemeDom(next);
      if (firebaseUser && settings) {
        await updateSettings({ theme: next });
      }
    },
    [applyThemeDom, firebaseUser, settings, updateSettings]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        security,
        settings,
        loading,
        isAuthReady,
        authError,
        twoFactorVerified,
        twoFactorToken,
        theme,
        signInWithGoogle,
        logout,
        markTwoFactorVerified,
        requireTwoFactorReauth,
        getAuthHeaders,
        setTheme,
        updateSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
