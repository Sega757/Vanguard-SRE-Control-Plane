import React, { useState } from 'react';
import { ShieldAlert, KeyRound, LogOut, AlertCircle } from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export function TwoFactorGate() {
  const { profile, security, markTwoFactorVerified, logout } = useAuth();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !security) return;

    setError(null);
    setVerifying(true);
    try {
      const resp = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          secret: security.totpSecret,
          code: code.trim(),
          backupCodes: security.backupCodes || [],
        }),
      });
      const data = await resp.json();

      if (!data.valid) {
        setError(data.error || 'Неверный код подтверждения.');
        return;
      }

      // If a backup recovery code was used, remove it from remaining codes
      if (data.method === 'backup' && data.consumedCode) {
        const remaining = (security.backupCodes || []).filter((c) => c !== data.consumedCode);
        const secPath = `users/${profile.uid}/security/totp`;
        try {
          await updateDoc(doc(db, 'users', profile.uid, 'security', 'totp'), {
            totpSecret: security.totpSecret,
            enabled: security.enabled,
            backupCodes: remaining,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, secPath);
        }
      }

      markTwoFactorVerified(data.twoFactorToken || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка проверки 2FA');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 text-sky-600 dark:text-sky-400">
            <ShieldAlert className="w-5 h-5" />
            <span className="text-xs font-mono">Двухфакторная аутентификация</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Подтвердите вход в Vanguard SRE
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Введите 6-значный код из приложения-аутентификатора (Google Authenticator / Authy) или
            один из резервных кодов для аккаунта{' '}
            <span className="font-mono text-slate-900 dark:text-slate-200">{profile?.email}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="totp-code"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Код подтверждения (TOTP или XXXX-XXXX)
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="totp-code"
                type="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-full pl-10 pr-4 py-2.5 text-sm font-mono tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                required
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying || !code.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {verifying ? 'Проверка кода...' : 'Подтвердить и войти'}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>RFC 6238 HMAC-SHA1</span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти из аккаунта
          </button>
        </div>
      </div>
    </div>
  );
}
