import { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Plus, Search, Trash2 } from 'lucide-react';
import type { AgentSession, SessionStatus } from '../types';

interface SessionsViewProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (session: AgentSession) => void;
  onCreateSession: () => Promise<void>;
  onCompleteSession: (session: AgentSession) => Promise<void>;
  onDeleteSession: (session: AgentSession) => Promise<void>;
}

export function SessionsView({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onCompleteSession,
  onDeleteSession,
}: SessionsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | SessionStatus>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (
        q &&
        !s.title.toLowerCase().includes(q) &&
        !s.id.toLowerCase().includes(q) &&
        !s.lastMessagePreview.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [sessions, statusFilter, query]);

  const statusColor = (status: SessionStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'COMPLETED':
        return 'text-sky-600 dark:text-sky-400';
      case 'ESCALATED':
        return 'text-amber-600 dark:text-amber-400';
      default:
        return 'text-rose-600 dark:text-rose-400';
    }
  };

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            История и активные сессии агента
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Все сессии Арбитра с привязкой к git-якорям, счётчикам откатов и ограничениям.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateSession}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Создать сессию
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, ID сессии или последнему сообщению..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/80">
          {(['ALL', 'ACTIVE', 'COMPLETED', 'ESCALATED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'Все' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Сессии агента не найдены
            </p>
            <button
              type="button"
              onClick={onCreateSession}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Запустить первую сессию
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0F172A]">
                  <th className="py-3 px-5 font-medium">Сессия / Задача</th>
                  <th className="py-3 px-4 font-medium">Статус</th>
                  <th className="py-3 px-4 font-medium">Якорь (Anchor)</th>
                  <th className="py-3 px-4 font-medium text-right">Шаги</th>
                  <th className="py-3 px-4 font-medium text-right">Откаты</th>
                  <th className="py-3 px-4 font-medium">Обновлена</th>
                  <th className="py-3 px-5 font-medium text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filtered.map((s) => {
                  const isCurrent = s.id === activeSessionId;
                  const updatedStr =
                    s.updatedAt && typeof s.updatedAt.toDate === 'function'
                      ? s.updatedAt.toDate().toLocaleString('ru-RU')
                      : 'Только что';

                  return (
                    <tr
                      key={s.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                        isCurrent ? 'bg-sky-50/40 dark:bg-sky-950/20' : ''
                      }`}
                    >
                      <td className="py-3.5 px-5 max-w-sm">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {s.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          <span className="font-mono">{s.id}</span>
                          {s.lastMessagePreview ? ` · ${s.lastMessagePreview}` : ''}
                        </p>
                      </td>
                      <td className={`py-3.5 px-4 font-mono text-xs font-medium ${statusColor(s.status)}`}>
                        {s.status}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {s.anchorSid || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-right text-slate-700 dark:text-slate-200">
                        {s.totalSteps}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-right text-slate-700 dark:text-slate-200">
                        {s.totalRollbacks}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                        {updatedStr}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectSession(s)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                          >
                            Открыть
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                          {s.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => onCompleteSession(s)}
                              title="Завершить сессию"
                              aria-label="Завершить сессию"
                              className="p-1.5 rounded-md text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteSession(s)}
                            title="Удалить сессию"
                            aria-label="Удалить сессию"
                            className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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
