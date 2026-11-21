import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  ShieldOff,
  AlertCircle,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface ProfileViewProps {
  onLogAuditEvent: (eventType: string, severity: 'INFO' | 'MEDIUM' | 'HIGH', summary: string) => Promise<void>;
}

interface TotpSetupDraft {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  backupCodes: string[];
}

export function ProfileView({ onLogAuditEvent }: ProfileViewProps) {
  const { profile, security, markTwoFactorVerified } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState<TotpSetupDraft | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [busy2fa, setBusy2fa] = useState(false);
  const [error2fa, setError2fa] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  if (!profile) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = displayName.trim().slice(0, 120);
    if (!cleaned) return;
    setSavingProfile(true);
    setProfileNotice(null);
    const path = `users/${profile.uid}`;
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: cleaned,
        photoURL: profile.photoURL || '',
        twoFactorEnabled: profile.twoFactorEnabled,
        updatedAt: serverTimestamp(),
      });
      setProfileNotice('Профиль обновлён.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleStart2faSetup = async () => {
    setError2fa(null);
    setBusy2fa(true);
    try {
      const resp = await fetch('/api/2fa/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profile.email }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Не удалось сгенерировать TOTP-ключ');
      }
      setDraft(data);
    } catch (err) {
      setError2fa(err instanceof Error ? err.message : 'Ошибка инициализации 2FA');
    } finally {
      setBusy2fa(false);
    }
  };

  const handleActivate2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError2fa(null);
    setBusy2fa(true);
    try {
      const resp = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          secret: draft.secret,
          code: verifyCode.trim(),
          backupCodes: draft.backupCodes,
        }),
      });
      const data = await resp.json();
      if (!data.valid) {
        setError2fa(data.error || 'Неверный код подтверждения.');
        return;
      }

      const secPath = `users/${profile.uid}/security/totp`;
      try {
        await setDoc(doc(db, 'users', profile.uid, 'security', 'totp'), {
          uid: profile.uid,
          totpSecret: draft.secret,
          enabled: true,
          backupCodes: draft.backupCodes,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, secPath);
      }

      const userPath = `users/${profile.uid}`;
      try {
        await updateDoc(doc(db, 'users', profile.uid), {
          displayName: profile.displayName,
          photoURL: profile.photoURL || '',
          twoFactorEnabled: true,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, userPath);
      }

      markTwoFactorVerified(data.twoFactorToken || null);
      setDraft(null);
      setVerifyCode('');
      await onLogAuditEvent(
        'AUTH_2FA_ENABLED',
        'MEDIUM',
        `Включена двухфакторная аутентификация (TOTP) для ${profile.email}`
      );
    } catch (err) {
      setError2fa(err instanceof Error ? err.message : 'Ошибка активации 2FA');
    } finally {
      setBusy2fa(false);
    }
  };

  const handleDisable2fa = async () => {
    setBusy2fa(true);
    setError2fa(null);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: profile.displayName,
        photoURL: profile.photoURL || '',
        twoFactorEnabled: false,
        updatedAt: serverTimestamp(),
      });
      if (security) {
        await updateDoc(doc(db, 'users', profile.uid, 'security', 'totp'), {
          totpSecret: security.totpSecret,
          enabled: false,
          backupCodes: security.backupCodes || [],
          updatedAt: serverTimestamp(),
        });
      }
      await fetch('/api/2fa/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: profile.uid, enabled: false }),
      }).catch(() => {});
      await onLogAuditEvent(
        'AUTH_2FA_DISABLED',
        'HIGH',
        `Отключена двухфакторная аутентификация (TOTP) для ${profile.email}`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setBusy2fa(false);
    }
  };

  const copySecret = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1800);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Профиль оператора и безопасность (2FA)
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Управление данными аккаунта Google, матрицей прав доступа и двухфакторной защитой TOTP.
        </p>
      </div>

      {/* Account Card */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
          {profile.photoURL ? (
            <img
              src={profile.photoURL}
              alt={profile.displayName}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-full object-cover border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-sky-600 text-white flex items-center justify-center text-lg font-semibold">
              {profile.displayName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="space-y-0.5 min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
              {profile.displayName}
            </h2>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
              {profile.email} · Google OAuth · UID {profile.uid.slice(0, 12)}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Роль: <span className="font-mono font-medium">{profile.role}</span> · Статус:{' '}
              <span className="font-mono font-medium">{profile.status}</span>
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="profile-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Отображаемое имя
            </label>
            <input
              id="profile-name"
              type="text"
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Привязанный Google Email
            </label>
            <input
              type="text"
              value={profile.email}
              disabled
              className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 text-slate-500"
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-4 pt-2">
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {profileNotice || ''}
            </span>
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              {savingProfile ? 'Сохранение...' : 'Сохранить профиль'}
            </button>
          </div>
        </form>

        {/* RBAC Capabilities Summary */}
        <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Назначенные права доступа (RBAC)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {[
              { label: 'Запуск задач агента', allowed: profile.canRunAgent },
              { label: 'Подтверждение необратимых эффектов', allowed: profile.canApproveIrreversible },
              { label: 'Управление внешними API', allowed: profile.canManageIntegrations },
              { label: 'Экспорт журналов аудита', allowed: profile.canExportAuditLogs },
            ].map((perm) => (
              <div
                key={perm.label}
                className="flex items-center justify-between px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50"
              >
                <span className="text-slate-700 dark:text-slate-300">{perm.label}</span>
                <span
                  className={`font-mono font-medium ${
                    perm.allowed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {perm.allowed ? 'РАЗРЕШЕНО' : 'ЗАПРЕЩЕНО'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2FA Security Section */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-sky-500" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Двухфакторная аутентификация (TOTP RFC 6238)
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xl">
              Защитите доступ к агенту, откатам и административным функциям с помощью 6-значного
              одноразового кода из Google Authenticator, Authy или 1Password. Секрет хранится в
              изолированной подколлекции безопасности.
            </p>
          </div>

          <div className="text-xs font-mono">
            {profile.twoFactorEnabled ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                2FA АКТИВНА
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                <ShieldOff className="w-4 h-4" />
                2FA ОТКЛЮЧЕНА
              </span>
            )}
          </div>
        </div>

        {error2fa && (
          <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error2fa}</span>
          </div>
        )}

        {profile.twoFactorEnabled ? (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  Двухфакторная аутентификация активна. Осталось резервных кодов:{' '}
                  <strong className="font-mono tabular-nums">
                    {security?.backupCodes?.length ?? 0}
                  </strong>
                  .
                </span>
              </div>
              <button
                type="button"
                disabled={busy2fa}
                onClick={handleDisable2fa}
                className="px-3.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                Отключить 2FA
              </button>
            </div>
          </div>
        ) : !draft ? (
          <div>
            <button
              type="button"
              disabled={busy2fa}
              onClick={handleStart2faSetup}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              {busy2fa ? 'Генерация ключа...' : 'Настроить двухфакторную аутентификацию'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="md:col-span-5 flex flex-col items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
              <img
                src={draft.qrDataUrl}
                alt="QR-код для настройки 2FA TOTP"
                className="w-48 h-48 rounded-lg bg-white p-2"
              />
              <div className="w-full space-y-1">
                <p className="text-[11px] text-slate-500 text-center">Секретный ключ Base32</p>
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 font-mono text-xs">
                  <span className="truncate">{draft.secret}</span>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="text-sky-600 dark:text-sky-400 hover:underline shrink-0 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedSecret ? 'Ок' : 'Коп.'}
                  </button>
                </div>
              </div>
            </div>

            <div className="md:col-span-7 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  1. Сохраните резервные коды восстановления
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                  {draft.backupCodes.map((bc) => (
                    <div
                      key={bc}
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-center text-slate-700 dark:text-slate-300"
                    >
                      {bc}
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleActivate2fa} className="space-y-3 pt-2">
                <label
                  htmlFor="verify-totp-setup"
                  className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  2. Введите 6-значный код из приложения (или резервный код) для активации
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id="verify-totp-setup"
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder="000000"
                    className="flex-1 px-3.5 py-2 text-sm font-mono tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy2fa || !verifyCode.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Активировать 2FA
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
