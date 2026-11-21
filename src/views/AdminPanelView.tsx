import { useEffect, useState } from 'react';
import { Shield, Search, AlertCircle } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { UserProfile, UserRole, UserStatus } from '../types';

interface AdminPanelViewProps {
  onLogAuditEvent: (eventType: string, severity: 'INFO' | 'MEDIUM' | 'HIGH', summary: string) => Promise<void>;
}

export function AdminPanelView({ onLogAuditEvent }: AdminPanelViewProps) {
  const { profile, getAuthHeaders, requireTwoFactorReauth } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rbacError, setRbacError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || profile.role !== 'admin') return;
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserProfile);
        list.sort((a, b) => a.email.localeCompare(b.email));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );
    return () => unsub();
  }, [profile]);

  if (!profile || profile.role !== 'admin') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="p-5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 flex items-center gap-3 text-sm text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Доступ к панели администратора разрешён только пользователям с ролью admin.</span>
        </div>
      </div>
    );
  }

  const updateUserAccess = async (
    target: UserProfile,
    changes: Partial<
      Pick<
        UserProfile,
        | 'role'
        | 'status'
        | 'canRunAgent'
        | 'canApproveIrreversible'
        | 'canManageIntegrations'
        | 'canExportAuditLogs'
      >
    >
  ) => {
    setBusyUid(target.uid);
    setNotice(null);
    setRbacError(null);
    const nextRole: UserRole = changes.role ?? target.role;
    const nextStatus: UserStatus = changes.status ?? target.status;

    try {
      // Server-side 2FA CISO gate before mutating RBAC roles/permissions
      const authResp = await fetch('/api/rbac/authorize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          targetEmail: target.email,
          action: `role=${nextRole},status=${nextStatus}`,
        }),
      });
      if (authResp.status === 403) {
        const errData = await authResp.json().catch(() => ({}));
        const reason = errData.error || 'Требуется подтверждённый серверный 2FA-токен.';
        setRbacError(reason);
        requireTwoFactorReauth(reason);
        return;
      }

      const payload = {
        role: nextRole,
        status: nextStatus,
        canRunAgent: changes.canRunAgent ?? target.canRunAgent,
        canApproveIrreversible: changes.canApproveIrreversible ?? target.canApproveIrreversible,
        canManageIntegrations: changes.canManageIntegrations ?? target.canManageIntegrations,
        canExportAuditLogs: changes.canExportAuditLogs ?? target.canExportAuditLogs,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'users', target.uid), payload);

      // Sync trusted admins registry when role changes
      if (changes.role && changes.role !== target.role) {
        if (changes.role === 'admin') {
          await setDoc(doc(db, 'admins', target.uid), {
            uid: target.uid,
            email: target.email,
            grantedBy: profile.uid,
            createdAt: serverTimestamp(),
          });
        } else if (target.uid !== profile.uid) {
          await deleteDoc(doc(db, 'admins', target.uid));
        }
      }

      setNotice(`Права доступа обновлены для ${target.email}.`);
      await onLogAuditEvent(
        'RBAC_POLICY_UPDATED',
        'HIGH',
        `Администратор ${profile.email} изменил доступ для ${target.email} (role=${nextRole}, status=${nextStatus})`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
    } finally {
      setBusyUid(null);
    }
  };

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-500" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Панель администратора — управление доступом (RBAC)
            </h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Назначение ролей, блокировка аккаунтов и гранулярные права доступа к данным и эффектам
            агента.
          </p>
        </div>

        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Пользователей: {users.length}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по email, имени или роли..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100"
          />
        </div>
        {notice && <span className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</span>}
        {rbacError && (
          <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">{rbacError}</span>
        )}
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Загрузка реестра пользователей...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0F172A]">
                  <th className="py-3 px-5 font-medium">Пользователь</th>
                  <th className="py-3 px-3 font-medium">Роль</th>
                  <th className="py-3 px-3 font-medium">Статус</th>
                  <th className="py-3 px-3 font-medium text-center">2FA</th>
                  <th className="py-3 px-3 font-medium text-center">Запуск агента</th>
                  <th className="py-3 px-3 font-medium text-center">Approval</th>
                  <th className="py-3 px-3 font-medium text-center">Внешние API</th>
                  <th className="py-3 px-4 font-medium text-center">Экспорт логов</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filtered.map((u) => {
                  const isSelf = u.uid === profile.uid;
                  const disabled = busyUid === u.uid;

                  return (
                    <tr key={u.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-5">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {u.displayName} {isSelf ? '(Вы)' : ''}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500">{u.email}</p>
                      </td>

                      <td className="py-3 px-3">
                        <select
                          value={u.role}
                          disabled={disabled || isSelf}
                          onChange={(e) =>
                            updateUserAccess(u, { role: e.target.value as UserRole })
                          }
                          aria-label={`Роль для ${u.email}`}
                          className="px-2.5 py-1.5 font-mono text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 disabled:opacity-60"
                        >
                          <option value="admin">admin</option>
                          <option value="operator">operator</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>

                      <td className="py-3 px-3">
                        <select
                          value={u.status}
                          disabled={disabled || isSelf}
                          onChange={(e) =>
                            updateUserAccess(u, { status: e.target.value as UserStatus })
                          }
                          aria-label={`Статус для ${u.email}`}
                          className={`px-2.5 py-1.5 font-mono text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 disabled:opacity-60 ${
                            u.status === 'active'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 text-center font-mono">
                        <span
                          className={
                            u.twoFactorEnabled
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400'
                          }
                        >
                          {u.twoFactorEnabled ? 'ON' : 'OFF'}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={u.canRunAgent}
                          disabled={disabled}
                          onChange={(e) =>
                            updateUserAccess(u, { canRunAgent: e.target.checked })
                          }
                          aria-label="Право запуска агента"
                          className="w-4 h-4 accent-sky-600 cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={u.canApproveIrreversible}
                          disabled={disabled}
                          onChange={(e) =>
                            updateUserAccess(u, { canApproveIrreversible: e.target.checked })
                          }
                          aria-label="Право подтверждения необратимых эффектов"
                          className="w-4 h-4 accent-sky-600 cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={u.canManageIntegrations}
                          disabled={disabled}
                          onChange={(e) =>
                            updateUserAccess(u, { canManageIntegrations: e.target.checked })
                          }
                          aria-label="Право управления интеграциями"
                          className="w-4 h-4 accent-sky-600 cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={u.canExportAuditLogs}
                          disabled={disabled}
                          onChange={(e) =>
                            updateUserAccess(u, { canExportAuditLogs: e.target.checked })
                          }
                          aria-label="Право экспорта журналов"
                          className="w-4 h-4 accent-sky-600 cursor-pointer"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
