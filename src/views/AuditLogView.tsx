import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type {
  AuditLogEvent,
  DecisionSource,
  HmacChainVerificationResult,
  Severity,
  TransponderEvent,
  UserProfile,
} from '../types';

interface AuditLogViewProps {
  profile: UserProfile;
  liveEvents: TransponderEvent[];
  persistedLogs: AuditLogEvent[];
}

interface UnifiedLogRow {
  id: string;
  seq: number;
  tsMs: number;
  tsLabel: string;
  eventType: string;
  severity: Severity;
  sessionId: string;
  sid: string;
  pid: string;
  source: DecisionSource | string;
  summary: string;
  payloadSummary: string;
  blobHash: string;
  prevHash: string;
  eventHash: string;
  latencyMs: number;
}

const SEVERITIES: Array<'ALL' | Severity> = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const TIME_WINDOWS = [
  { id: '15m', label: '15 мин', ms: 15 * 60_000 },
  { id: '1h', label: '1 час', ms: 60 * 60_000 },
  { id: '24h', label: '24 часа', ms: 24 * 60 * 60_000 },
  { id: 'all', label: 'Всё время', ms: Infinity },
] as const;

export function AuditLogView({ profile, liveEvents, persistedLogs }: AuditLogViewProps) {
  const [severityFilter, setSeverityFilter] = useState<'ALL' | Severity>('ALL');
  const [timeWindow, setTimeWindow] = useState<'15m' | '1h' | '24h' | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [verifyingChain, setVerifyingChain] = useState(false);
  const [chainReport, setChainReport] = useState<HmacChainVerificationResult | null>(null);

  const mergedRows = useMemo<UnifiedLogRow[]>(() => {
    const map = new Map<string, UnifiedLogRow>();

    for (const ev of liveEvents) {
      const tsMs = Date.parse(ev.ts) || Date.now();
      map.set(ev.id, {
        id: ev.id,
        seq: ev.seq,
        tsMs,
        tsLabel: new Date(tsMs).toLocaleString('ru-RU'),
        eventType: ev.type,
        severity: ev.severity,
        sessionId: ev.sessionId,
        sid: ev.sid,
        pid: ev.pid || 'genesis',
        source: ev.source || 'system',
        summary: ev.summary,
        payloadSummary: JSON.stringify(ev.payload, null, 2),
        blobHash: ev.blobs?.[0] || '—',
        prevHash: ev.prev,
        eventHash: ev.hash,
        latencyMs: ev.latencyMs,
      });
    }

    for (const log of persistedLogs) {
      if (map.has(log.id)) continue;
      const dateObj =
        log.createdAt && typeof log.createdAt.toDate === 'function'
          ? log.createdAt.toDate()
          : log.ts
            ? new Date(log.ts)
            : new Date();
      map.set(log.id, {
        id: log.id,
        seq: log.seq,
        tsMs: dateObj.getTime(),
        tsLabel: dateObj.toLocaleString('ru-RU'),
        eventType: log.eventType,
        severity: log.severity,
        sessionId: log.sessionId,
        sid: log.sid,
        pid: log.pid || 'genesis',
        source: log.source || 'system',
        summary: log.summary,
        payloadSummary: log.payloadSummary,
        blobHash: log.blobHash || '—',
        prevHash: log.prevHash || '—',
        eventHash: log.eventHash || '—',
        latencyMs: log.latencyMs,
      });
    }

    return Array.from(map.values()).sort((a, b) => b.tsMs - a.tsMs || b.seq - a.seq);
  }, [liveEvents, persistedLogs]);

  const availableTypes = useMemo(() => {
    const s = new Set<string>();
    mergedRows.forEach((r) => s.add(r.eventType));
    return ['ALL', ...Array.from(s).sort()];
  }, [mergedRows]);

  const filteredRows = useMemo(() => {
    const now = Date.now();
    const maxAge = TIME_WINDOWS.find((w) => w.id === timeWindow)?.ms ?? Infinity;
    const q = query.trim().toLowerCase();

    return mergedRows.filter((row) => {
      if (severityFilter !== 'ALL' && row.severity !== severityFilter) return false;
      if (typeFilter !== 'ALL' && row.eventType !== typeFilter) return false;
      if (maxAge !== Infinity && now - row.tsMs > maxAge) return false;
      if (
        q &&
        !row.summary.toLowerCase().includes(q) &&
        !row.eventType.toLowerCase().includes(q) &&
        !row.sid.toLowerCase().includes(q) &&
        !row.sessionId.toLowerCase().includes(q) &&
        !String(row.source).toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [mergedRows, severityFilter, timeWindow, typeFilter, query]);

  const handleVerifyHmacChain = async () => {
    setVerifyingChain(true);
    try {
      const resp = await fetch('/api/audit/verify-chain', { method: 'POST' });
      const data = (await resp.json()) as HmacChainVerificationResult;
      setChainReport(data);
      if (data.brokenEventId) {
        setExpandedId(data.brokenEventId);
      }
    } catch (err) {
      setChainReport({
        valid: false,
        checkedCount: 0,
        brokenIndex: null,
        brokenEventId: null,
        reason: err instanceof Error ? err.message : 'Ошибка связи с сервером верификации',
        verifiedAt: new Date().toISOString(),
      });
    } finally {
      setVerifyingChain(false);
    }
  };

  const handleExportCsv = () => {
    if (!profile.canExportAuditLogs) return;
    const header = [
      'seq',
      'timestamp',
      'severity',
      'eventType',
      'source',
      'sessionId',
      'sid',
      'latencyMs',
      'summary',
      'prevHash',
      'eventHash',
    ];
    const lines = filteredRows.map((r) =>
      [
        r.seq,
        `"${r.tsLabel}"`,
        r.severity,
        r.eventType,
        r.source,
        r.sessionId,
        r.sid,
        r.latencyMs,
        `"${r.summary.replace(/"/g, '""')}"`,
        r.prevHash,
        r.eventHash,
      ].join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vanguard-sre-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!profile.canExportAuditLogs) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: profile.email,
      filters: { severityFilter, timeWindow, typeFilter, query },
      hmacChainVerification: chainReport,
      totalRecords: filteredRows.length,
      records: filteredRows.map((r) => ({
        id: r.id,
        seq: r.seq,
        timestamp: new Date(r.tsMs).toISOString(),
        severity: r.severity,
        eventType: r.eventType,
        source: r.source,
        sessionId: r.sessionId,
        sid: r.sid,
        pid: r.pid,
        latencyMs: r.latencyMs,
        summary: r.summary,
        blobHash: r.blobHash,
        prevHash: r.prevHash,
        eventHash: r.eventHash,
        payloadSummary: r.payloadSummary,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vanguard-sre-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const severityColor = (sev: Severity) => {
    switch (sev) {
      case 'CRITICAL':
        return 'text-rose-600 dark:text-rose-400 font-semibold';
      case 'HIGH':
        return 'text-amber-600 dark:text-amber-400 font-semibold';
      case 'MEDIUM':
        return 'text-sky-600 dark:text-sky-400 font-medium';
      case 'LOW':
        return 'text-slate-600 dark:text-slate-400';
      default:
        return 'text-emerald-600 dark:text-emerald-400';
    }
  };

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Журнал событий и шагов выполнения (Transponder)
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Потоковая телеметрия шагов агента, откатов и событий безопасности с append-only
            HMAC-SHA256 цепочкой.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={verifyingChain}
            onClick={handleVerifyHmacChain}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            {verifyingChain ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            Проверить целостность HMAC-цепочки
          </button>

          <button
            type="button"
            disabled={!profile.canExportAuditLogs || filteredRows.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            CSV ({filteredRows.length})
          </button>

          <button
            type="button"
            disabled={!profile.canExportAuditLogs || filteredRows.length === 0}
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileJson className="w-3.5 h-3.5" />
            JSON ({filteredRows.length})
          </button>
        </div>
      </div>

      {/* HMAC Verification Result Banner */}
      {chainReport && (
        <div
          className={`p-4 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
            chainReport.valid
              ? 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
              : 'border-rose-400 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {chainReport.valid ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            )}
            <div className="space-y-0.5">
              <p className="font-semibold">
                {chainReport.valid
                  ? `Целостность HMAC-цепочки подтверждена (${chainReport.checkedCount} событий)`
                  : `ОБНАРУЖЕНО НАРУШЕНИЕ ЦЕЛОСТНОСТИ HMAC (звено #${chainReport.brokenIndex ?? '?'})`}
              </p>
              <p className="font-mono text-[11px]">{chainReport.reason}</p>
            </div>
          </div>
          <span className="font-mono text-[11px] opacity-80">
            Проверено: {new Date(chainReport.verifiedAt).toLocaleTimeString('ru-RU')}
          </span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по описанию, типу события, источнику, sid или сессии..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80">
          {TIME_WINDOWS.map((tw) => (
            <button
              key={tw.id}
              type="button"
              onClick={() => setTimeWindow(tw.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                timeWindow === tw.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tw.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 overflow-x-auto">
          {SEVERITIES.map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFilter(sev)}
              className={`px-2.5 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                severityFilter === sev
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {sev === 'ALL' ? 'Все' : sev}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Фильтр по типу события"
          className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {t === 'ALL' ? 'Все типы событий' : t}
            </option>
          ))}
        </select>
      </div>

      {/* Log Data Grid */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Записи журнала не найдены
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Запустите задачу в чате агента или ослабьте фильтры по времени и приоритету.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0F172A]">
                  <th className="py-2.5 px-4 w-8" />
                  <th className="py-2.5 px-3 font-medium">Время</th>
                  <th className="py-2.5 px-3 font-medium">Приоритет</th>
                  <th className="py-2.5 px-3 font-medium">Тип события</th>
                  <th className="py-2.5 px-3 font-medium">Источник</th>
                  <th className="py-2.5 px-3 font-medium">Описание шага</th>
                  <th className="py-2.5 px-3 font-medium font-mono">SID</th>
                  <th className="py-2.5 px-4 font-medium text-right">Время вып.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filteredRows.map((row) => {
                  const isExpanded = expandedId === row.id;
                  const isBroken = Boolean(
                    chainReport && !chainReport.valid && chainReport.brokenEventId === row.id
                  );
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                        className={`cursor-pointer transition-colors ${
                          isBroken
                            ? 'bg-rose-100/80 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-950/70'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-4 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {row.tsLabel}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-mono whitespace-nowrap ${severityColor(row.severity)}`}
                        >
                          {row.severity}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {row.eventType}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {row.source}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 max-w-md truncate">
                          {isBroken ? '[БИТОЕ ЗВЕНО HMAC] ' : ''}
                          {row.summary}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                          {row.sid}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {row.latencyMs} мс
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/90 dark:bg-[#0B1120]">
                          <td colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 font-mono text-[11px]">
                              <div className="space-y-1.5">
                                <p className="text-slate-500 font-sans font-medium text-xs">
                                  Криптографическая цепочка Transponder (schema 1.1)
                                </p>
                                <div className="grid grid-cols-[110px_1fr] gap-y-1">
                                  <span className="text-slate-500">Сессия:</span>
                                  <span className="text-slate-800 dark:text-slate-200 break-all">
                                    {row.sessionId}
                                  </span>
                                  <span className="text-slate-500">Источник:</span>
                                  <span className="text-sky-600 dark:text-sky-400 break-all">
                                    {row.source}
                                  </span>
                                  <span className="text-slate-500">Родитель (pid):</span>
                                  <span className="text-slate-800 dark:text-slate-200 break-all">
                                    {row.pid}
                                  </span>
                                  <span className="text-slate-500">CAS Blob:</span>
                                  <span className="text-slate-800 dark:text-slate-200 break-all">
                                    {row.blobHash}
                                  </span>
                                  <span className="text-slate-500">Prev HMAC:</span>
                                  <span className="text-slate-500 break-all">{row.prevHash}</span>
                                  <span className="text-slate-500">Event HMAC:</span>
                                  <span
                                    className={`break-all ${
                                      isBroken
                                        ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                    }`}
                                  >
                                    {row.eventHash}
                                  </span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-slate-500 font-sans font-medium text-xs">
                                  Payload события
                                </p>
                                <pre className="p-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 overflow-x-auto max-h-40">
                                  {row.payloadSummary}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
