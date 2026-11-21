import {
  Activity,
  History,
  LogOut,
  MessageSquareCode,
  Moon,
  ScrollText,
  Settings,
  Shield,
  Sun,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { NavSection } from '../types';
import type { WsConnectionStatus } from '../hooks/useWebSocket';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  wsStatus: WsConnectionStatus;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  activeSessionsCount: number;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  operator: 'Оператор SRE',
  viewer: 'Наблюдатель',
};

export function Sidebar({
  activeSection,
  onSelectSection,
  wsStatus,
  mobileOpen,
  onCloseMobile,
  activeSessionsCount,
}: SidebarProps) {
  const { profile, theme, setTheme, logout } = useAuth();

  const navItems: { id: NavSection; label: string; icon: typeof Activity; meta?: string }[] = [
    { id: 'chat', label: 'Чат и DAG агента', icon: MessageSquareCode },
    { id: 'dashboard', label: 'Дашборд и метрики', icon: Activity },
    { id: 'logs', label: 'Журнал событий', icon: ScrollText },
    {
      id: 'sessions',
      label: 'Сессии агента',
      icon: History,
      meta: activeSessionsCount > 0 ? String(activeSessionsCount) : undefined,
    },
    { id: 'settings', label: 'Настройки и API', icon: Settings },
    { id: 'profile', label: 'Профиль и 2FA', icon: User },
  ];

  if (profile?.role === 'admin') {
    navItems.push({ id: 'admin', label: 'Панель администратора', icon: Shield });
  }

  const wsLabel =
    wsStatus === 'connected'
      ? 'WebSocket подключён'
      : wsStatus === 'reconnecting'
        ? 'Переподключение WS'
        : wsStatus === 'connecting'
          ? 'Подключение WS'
          : 'WS отключён';

  const wsDotColor =
    wsStatus === 'connected'
      ? 'bg-emerald-500'
      : wsStatus === 'reconnecting' || wsStatus === 'connecting'
        ? 'bg-amber-500'
        : 'bg-rose-500';

  const content = (
    <aside className="w-64 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shrink-0">
      {/* Brand */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-sky-600 text-white flex items-center justify-center font-mono text-xs font-bold shrink-0">
            VS
          </div>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
            Vanguard SRE
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Закрыть меню"
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-sky-600/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </span>
              {item.meta && (
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {item.meta}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Real WebSocket Streaming Telemetry Status & Theme */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0 text-slate-600 dark:text-slate-300">
            <span className={`w-2 h-2 rounded-full shrink-0 ${wsDotColor}`} aria-hidden="true" />
            <span className="truncate font-mono">{wsLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Переключить тему"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* User Footer */}
        {profile && (
          <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {profile.photoURL ? (
                <img
                  src={profile.photoURL}
                  alt={profile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">
                  {profile.displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {profile.displayName}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {ROLE_LABELS[profile.role] || profile.role}
                  {profile.twoFactorEnabled ? ' · 2FA' : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Выйти"
              aria-label="Выйти из аккаунта"
              className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
