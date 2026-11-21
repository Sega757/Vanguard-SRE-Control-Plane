import { useState } from 'react';
import { ShieldCheck, Lock, GitBranch, Activity, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function AuthGate() {
  const { signInWithGoogle, authError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleLogin = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl overflow-hidden">
        {/* Left: Visual & Architecture Context */}
        <div className="lg:col-span-7 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-900">
            {!imgError ? (
              <img
                src="/assets/aistudio/Vanguard_SRE_95fcb176.png"
                alt="Vanguard SRE State & Rollback Engine"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-900 via-[#0F172A] to-sky-950 flex flex-col items-center justify-center p-8 text-center">
                <ShieldCheck className="w-12 h-12 text-sky-400 mb-3" />
                <p className="text-lg font-semibold text-white">Vanguard SRE</p>
                <p className="text-xs text-slate-400">State &amp; Rollback Engine</p>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
          </div>

          <div className="p-8 space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-mono text-sky-400">
                Vanguard SRE · State &amp; Rollback Engine
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Центр управления автономным SRE-агентом
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
                Потоковый обмен задачами по WebSockets, детерминированный трёхслойный откат
                (контекст, git-воркспейс, внешние эффекты), контроль доступа RBAC и аудит событий с
                HMAC-цепочкой.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <GitBranch className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>DAG и якоря</span>
                </div>
                <p className="text-xs text-slate-400">
                  Отсечение сбойных веток и сохранение успешных коммитов.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>WebSockets</span>
                </div>
                <p className="text-xs text-slate-400">
                  Живая трансляция шагов Арбитра, верификатора и метрик.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Google + 2FA</span>
                </div>
                <p className="text-xs text-slate-400">
                  Поддержка TOTP-аутентификации и ролевого доступа к данным.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Authentication Action */}
        <div className="lg:col-span-5 p-8 sm:p-10 flex flex-col justify-center space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Вход в систему
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Используйте корпоративный или личный аккаунт Google для доступа к активным сессиям,
              журналу телеметрии и настройкам интеграций.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{authError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={signingIn}
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.72 4.34-5.27 4.34-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.17 14.69 3.25 12.17 3.25 7.21 3.25 3.2 7.26 3.2 12.22s4.01 8.97 8.97 8.97c5.18 0 8.61-3.64 8.61-8.77 0-.59-.07-1.04-.15-1.32z"
              />
            </svg>
            <span>{signingIn ? 'Подключение к Google...' : 'Войти через Google'}</span>
          </button>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <p>
              После входа аккаунт синхронизируется с Firestore. При активной двухфакторной
              аутентификации (TOTP) потребуется 6-значный код подтверждения.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
