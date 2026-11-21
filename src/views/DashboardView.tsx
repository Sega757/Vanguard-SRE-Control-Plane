import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Radio,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';
import type {
  ApiIntegration,
  ExecutionMode,
  GithubOverview,
  ServerMetricsSnapshot,
} from '../types';

interface DashboardViewProps {
  metrics: ServerMetricsSnapshot | null;
  integrations: ApiIntegration[];
  firestoreOnline: boolean;
  executionMode: ExecutionMode;
  onProbeIntegration: (integration: ApiIntegration) => Promise<void>;
}

export function DashboardView({
  metrics,
  integrations,
  firestoreOnline,
  executionMode,
  onProbeIntegration,
}: DashboardViewProps) {
  const [range, setRange] = useState<'6' | '12' | 'all'>('12');
  const [probingAll, setProbingAll] = useState(false);
  const [githubData, setGithubData] = useState<GithubOverview | null>(null);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [chartsReady, setChartsReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Defer Recharts ResponsiveContainer mount by 1 animation frame so containers
  // always have positive measured width/height (prevents Recharts width(-1)/height(-1) warning)
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setChartsReady(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const loadGithubOverview = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingGithub(true);
    try {
      const resp = await fetch('/api/github/overview', { signal: controller.signal });
      if (resp.ok && !controller.signal.aborted) {
        const data = (await resp.json()) as GithubOverview;
        setGithubData(data);
      }
    } catch {
      // Ignored safely on abort or network glitch
    } finally {
      if (!controller.signal.aborted) {
        setLoadingGithub(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadGithubOverview();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [loadGithubOverview]);

  const buckets = metrics?.buckets || [];
  const filteredBuckets =
    range === '6' ? buckets.slice(-6) : range === '12' ? buckets.slice(-12) : buckets;

  const verificationData = metrics
    ? [
        { name: 'SUCCESS', count: metrics.verifications.SUCCESS },
        { name: 'OBSERVED', count: metrics.verifications.OBSERVED },
        { name: 'PATCH', count: metrics.verifications.PATCH },
        { name: 'TEST', count: metrics.verifications.TEST },
        { name: 'ENV', count: metrics.verifications.ENV },
      ]
    : [];

  const handleProbeAll = async () => {
    setProbingAll(true);
    try {
      await Promise.all(integrations.map((intg) => onProbeIntegration(intg)));
    } finally {
      setProbingAll(false);
    }
  };

  const renderStatus = (status: string) => {
    if (status === 'online') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          ONLINE
        </span>
      );
    }
    if (status === 'degraded') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          DEGRADED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-600 dark:text-rose-400">
        <XCircle className="w-3.5 h-3.5" />
        OFFLINE
      </span>
    );
  };

  const modeBadgeClass =
    executionMode === 'LIVE_BRIDGE'
      ? 'text-emerald-600 dark:text-emerald-400'
      : executionMode === 'AI_SANDBOX'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header & Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Дашборд производительности и мониторинга
            </h1>
            <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-semibold ${modeBadgeClass}`}>
              <Radio className="w-3.5 h-3.5" />
              {executionMode}
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Живые метрики Арбитра, нагрузка на рантайм, телеметрия GitHub и статус активных
            подключений.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/80">
          {(
            [
              { id: '6', label: '30 мин' },
              { id: '12', label: '1 час' },
              { id: 'all', label: 'Весь буфер' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                range === opt.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Активные WS-соединения</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.activeWsConnections ?? 0}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Сессий в рантайме: {metrics?.activeSessions ?? 0}
          </p>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Медианная задержка шага</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.medianLatencyMs ?? 0}{' '}
            <span className="text-sm font-normal text-slate-500">мс</span>
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Успешных верификаций: {metrics?.successRate ?? 100}%
          </p>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">События Transponder (HMAC)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.totalEvents ?? 0}
          </p>
          <p className="text-xs text-slate-500 font-mono truncate">
            CAS-блобов: {metrics?.blobCount ?? 0}
          </p>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Потребление памяти RSS</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics?.memoryMb ?? 0}{' '}
            <span className="text-sm font-normal text-slate-500">МБ</span>
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Heap: {metrics?.heapMb ?? 0} МБ · Uptime {metrics?.uptimeSec ?? 0}с
          </p>
        </div>
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 min-w-0 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Активность агента и срабатывания откатов
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Количество выполненных шагов Арбитра и 3-слойных откатов по временным интервалам
              </p>
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Шаги · Откаты
            </div>
          </div>

          <div className="h-64 w-full min-w-0">
            {chartsReady && (
              <ResponsiveContainer width="100%" height={256} minWidth={0}>
                <AreaChart data={filteredBuckets} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stepsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="rollbacksFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#f8fafc',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="steps"
                    name="Шаги агента"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fill="url(#stepsFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="rollbacks"
                    name="Откаты (PATCH)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#rollbacksFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 min-w-0 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Нагрузка на систему и задержка (мс)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Загрузка CPU (%) и средняя задержка шагов ExternalVerifier
            </p>
          </div>

          <div className="h-64 w-full min-w-0">
            {chartsReady && (
              <ResponsiveContainer width="100%" height={256} minWidth={0}>
                <ComposedChart
                  data={filteredBuckets}
                  margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#f8fafc',
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="cpuPercent"
                    name="CPU (%)"
                    fill="#38bdf8"
                    radius={[4, 4, 0, 0]}
                    barSize={16}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgLatencyMs"
                    name="Задержка (мс)"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* GitHub Server-Side Proxy Telemetry */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <GitBranch className="w-4 h-4 text-sky-500 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              GitHub Repository Bridge
              {githubData?.repo ? ` · ${githubData.repo}` : ''}
            </h2>
            {githubData?.defaultBranch && (
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                · {githubData.defaultBranch}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {githubData?.htmlUrl && (
              <a
                href={githubData.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                Открыть репозиторий
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              disabled={loadingGithub}
              onClick={loadGithubOverview}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingGithub ? 'animate-spin' : ''}`} />
              Обновить GitHub
            </button>
          </div>
        </div>

        {!githubData || !githubData.configured ? (
          <div className="p-5 text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center justify-between gap-3">
            <span>
              {githubData?.error ||
                'GitHub-мост не настроен. Задайте переменные окружения GITHUB_TOKEN и GITHUB_DEFAULT_REPO (owner/repo) на сервере для отображения веток, последних коммитов, Pull Requests и ссылок на якоря.'}
            </span>
            <span className="font-mono text-slate-500">
              ENV: GITHUB_TOKEN · GITHUB_DEFAULT_REPO
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
            {/* Recent Commits */}
            <div className="lg:col-span-6 p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                  <GitCommit className="w-3.5 h-3.5 text-emerald-500" />
                  Последние коммиты ({githubData.commits.length})
                </span>
                <span className="font-mono text-slate-500">
                  Веток: {githubData.branches.length}
                </span>
              </div>
              {githubData.commits.length === 0 ? (
                <p className="text-xs text-slate-500">Коммиты не найдены.</p>
              ) : (
                <div className="space-y-2">
                  {githubData.commits.slice(0, 5).map((c) => (
                    <a
                      key={c.sha}
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-500/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                          {c.message}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {c.author} · {new Date(c.date).toLocaleString('ru-RU')}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                        {c.shortSha}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Open Pull Requests & Branches */}
            <div className="lg:col-span-6 p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                  <GitPullRequest className="w-3.5 h-3.5 text-sky-500" />
                  Открытые Pull Requests ({githubData.pullRequests.length})
                </span>
                {githubData.branches.length > 0 && (
                  <span className="font-mono text-[11px] text-slate-500 truncate max-w-[220px]">
                    {githubData.branches.slice(0, 4).join(' · ')}
                  </span>
                )}
              </div>
              {githubData.pullRequests.length === 0 ? (
                <p className="text-xs text-slate-500">Открытых Pull Requests нет.</p>
              ) : (
                <div className="space-y-2">
                  {githubData.pullRequests.slice(0, 5).map((pr) => (
                    <a
                      key={pr.number}
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-500/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                          #{pr.number} {pr.title}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {pr.author} · {pr.headBranch}
                        </p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Row: Verification Breakdown & External Service Connections */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 min-w-0 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Классификация вердиктов верификатора
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Распределение по классам протокола audit.py (SUCCESS, OBSERVED, PATCH, TEST, ENV)
            </p>
          </div>
          <div className="h-56 w-full min-w-0">
            {chartsReady && (
              <ResponsiveContainer width="100%" height={224} minWidth={0}>
                <BarChart
                  data={verificationData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    width={76}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#f8fafc',
                    }}
                  />
                  <Bar dataKey="count" name="Количество" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="lg:col-span-7 min-w-0 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Статус соединений с внешними сервисами
              </h2>
            </div>
            {integrations.length > 0 && (
              <button
                type="button"
                disabled={probingAll}
                onClick={handleProbeAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${probingAll ? 'animate-spin' : ''}`} />
                Проверить внешние API
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-5 font-medium">Сервис</th>
                  <th className="py-2.5 px-4 font-medium">Эндпоинт / Класс</th>
                  <th className="py-2.5 px-4 font-medium text-right">Задержка</th>
                  <th className="py-2.5 px-5 font-medium text-right">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100">
                    Firebase Firestore &amp; Auth
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500">
                    cloud://firestore · persistent
                  </td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums text-right text-slate-600 dark:text-slate-300">
                    28 мс
                  </td>
                  <td className="py-3 px-5 text-right">
                    {renderStatus(firestoreOnline ? 'online' : 'offline')}
                  </td>
                </tr>

                {(metrics?.coreServices || []).map((svc) => (
                  <tr key={svc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100">
                      {svc.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">{svc.endpoint}</td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-right text-slate-600 dark:text-slate-300">
                      {svc.latencyMs} мс
                    </td>
                    <td className="py-3 px-5 text-right">{renderStatus(svc.status)}</td>
                  </tr>
                ))}

                {integrations.map((intg) => (
                  <tr key={intg.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100">
                      {intg.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 truncate max-w-[220px]">
                      {intg.baseUrl} · {intg.effectClass}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-right text-slate-600 dark:text-slate-300">
                      {intg.lastLatencyMs} мс
                    </td>
                    <td className="py-3 px-5 text-right">{renderStatus(intg.lastStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
