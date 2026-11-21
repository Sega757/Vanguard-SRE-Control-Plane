import { useState } from 'react';
import {
  Anchor,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FlaskConical,
  GitBranch,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { ConstraintNotice, DagNode, SessionRuntimeState } from '../types';

interface DagVisualizerProps {
  sessionState: SessionRuntimeState | null;
}

export function DagVisualizer({ sessionState }: DagVisualizerProps) {
  const [selectedSid, setSelectedSid] = useState<string | null>(null);

  if (!sessionState) {
    return (
      <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Подключение к графу выполнения DAG...
      </div>
    );
  }

  const nodes = sessionState.nodes || [];
  const selectedNode: DagNode | undefined =
    nodes.find((n) => n.sid === selectedSid) || nodes[nodes.length - 1];
  const constraints: ConstraintNotice[] = sessionState.constraints || [];
  const isSandboxMode = sessionState.mode === 'AI_SANDBOX';
  const isMockDemo = sessionState.mode === 'MOCK_DEMO';

  const getStatusMeta = (node: DagNode) => {
    if (node.pruned) {
      return {
        label: 'ОТСЕЧЕНО / ОТКАТ',
        colorClass: 'text-amber-600 dark:text-amber-400',
        borderClass: 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20',
        Icon: RotateCcw,
      };
    }
    if (node.anchor) {
      return {
        label: 'ЯКОРЬ (ANCHOR)',
        colorClass: 'text-emerald-600 dark:text-emerald-400',
        borderClass: 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20',
        Icon: Anchor,
      };
    }
    if (node.verdict === 'FAILED') {
      return {
        label: `ОШИБКА (${node.failureClass})`,
        colorClass: 'text-rose-600 dark:text-rose-400',
        borderClass: 'border-rose-500/40 bg-rose-50/40 dark:bg-rose-950/20',
        Icon: XCircle,
      };
    }
    if (node.verdict === 'OBSERVED') {
      return {
        label: 'OBSERVED',
        colorClass: 'text-sky-600 dark:text-sky-400',
        borderClass: 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]',
        Icon: Eye,
      };
    }
    if (node.verdict === 'SUCCESS') {
      return {
        label: 'SUCCESS',
        colorClass: 'text-emerald-600 dark:text-emerald-400',
        borderClass: 'border-emerald-500/30 bg-white dark:bg-[#111827]',
        Icon: CheckCircle2,
      };
    }
    return {
      label: 'ВЫПОЛНЯЕТСЯ',
      colorClass: 'text-sky-600 dark:text-sky-400',
      borderClass: 'border-sky-500/50 bg-sky-50/30 dark:bg-sky-950/20',
      Icon: Clock,
    };
  };

  const getRiskTextClass = (risk?: string) => {
    if (risk === 'HIGH') return 'text-rose-600 dark:text-rose-400';
    if (risk === 'MEDIUM') return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-600 dark:text-emerald-400';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header Summary */}
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-sky-500 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
            Граф выполнения (DAG)
          </h3>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
          Якорь {sessionState.anchorSid.slice(0, 12)} · Откатов {sessionState.totalRollbacks}
        </div>
      </div>

      {/* Honest Dry-Run / Mode Banner */}
      {(isSandboxMode || isMockDemo) && (
        <div className="px-5 py-2 border-b border-slate-200 dark:border-slate-800 bg-sky-50/70 dark:bg-sky-950/25 flex items-center justify-between gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            {isSandboxMode
              ? 'Анализ в песочнице (файлы не изменены)'
              : 'Офлайн-демонстрация MOCK_DEMO (файлы не изменены)'}
          </span>
          <span className="font-mono text-sky-600 dark:text-sky-400 shrink-0">dry_run: true</span>
        </div>
      )}

      {/* Anchor Hash Strip */}
      {sessionState.anchorHash && (
        <div className="px-5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/60 flex items-center justify-between gap-3 text-[11px] font-mono">
          <span className="text-slate-500 dark:text-slate-400">TOCTOU Anchor Hash</span>
          <span className="text-emerald-600 dark:text-emerald-400 truncate">
            {sessionState.anchorHash}
          </span>
        </div>
      )}

      {/* Interactive Node Chain */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {nodes.map((node, index) => {
          const meta = getStatusMeta(node);
          const Icon = meta.Icon;
          const isSelected = selectedNode?.sid === node.sid;

          return (
            <div key={node.sid} className="relative">
              {index > 0 && (
                <div
                  className="ml-5 h-3 w-px bg-slate-300 dark:bg-slate-700"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => setSelectedSid(node.sid)}
                className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  meta.borderClass
                } ${isSelected ? 'ring-1 ring-sky-500' : 'hover:border-slate-400 dark:hover:border-slate-600'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.colorClass}`} />
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          node.pruned
                            ? 'line-through text-slate-500 dark:text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {node.label}
                      </p>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {node.tool} · {node.effectClass}
                        {node.dryRun ? ' · dry_run' : ''}
                        {node.riskLevel ? ` · risk:${node.riskLevel}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`block text-[11px] font-mono font-medium ${meta.colorClass}`}>
                      {meta.label}
                    </span>
                    <span className="block text-[11px] font-mono tabular-nums text-slate-500">
                      {node.latencyMs} мс
                    </span>
                  </div>
                </div>
              </button>
            </div>
          );
        })}

        {/* Active Injected Constraints */}
        {constraints.length > 0 && (
          <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Активные ограничения Арбитра ({constraints.length})</span>
            </div>
            {constraints.map((c) => (
              <div
                key={`${c.attempt}-${c.fingerprint}`}
                className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between font-mono text-amber-700 dark:text-amber-300">
                  <span>
                    Попытка #{c.attempt} · {c.caseId}
                  </span>
                  <span>{c.excType}</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300">{c.contract}</p>
                <p className="font-mono text-[11px] text-slate-500 truncate">
                  {c.scope} · fp:{c.fingerprint}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Node Inspector */}
      {selectedNode && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0B1120] space-y-2.5 text-xs">
          <div className="flex items-center justify-between font-medium text-slate-700 dark:text-slate-300">
            <span>Инспектор узла</span>
            <span className="font-mono text-slate-500">
              {selectedNode.sid}
              {selectedNode.dryRun ? ' · dry_run: true' : ''}
            </span>
          </div>

          {selectedNode.patchHypothesis && (
            <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
              <p className="text-[11px] font-mono text-slate-500">Гипотеза патча</p>
              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                {selectedNode.patchHypothesis}
              </p>
            </div>
          )}

          {selectedNode.riskAssessment && (
            <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-500">Оценка рисков</span>
                <span className={`font-semibold ${getRiskTextClass(selectedNode.riskLevel)}`}>
                  {selectedNode.riskLevel || 'MEDIUM'}
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {selectedNode.riskAssessment}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
            <div className="text-slate-500">Родитель (pid)</div>
            <div className="text-slate-800 dark:text-slate-200 truncate text-right">
              {selectedNode.pid || 'genesis'}
            </div>
            <div className="text-slate-500">AST / Fingerprint</div>
            <div className="text-slate-800 dark:text-slate-200 truncate text-right">
              {selectedNode.fingerprint}
            </div>
            <div className="text-slate-500">CAS Blob SHA-256</div>
            <div className="text-slate-800 dark:text-slate-200 truncate text-right">
              {selectedNode.blobHash.slice(0, 20)}...
            </div>
            {selectedNode.commitHash && (
              <>
                <div className="text-slate-500">Git Anchor Commit</div>
                <div className="text-emerald-600 dark:text-emerald-400 truncate text-right">
                  {selectedNode.commitUrl ? (
                    <a
                      href={selectedNode.commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <span>{selectedNode.commitHash}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    selectedNode.commitHash
                  )}
                </div>
              </>
            )}
            {selectedNode.errorSig && (
              <>
                <div className="text-slate-500">Сигнатура сбоя</div>
                <div className="text-rose-600 dark:text-rose-400 truncate text-right">
                  {selectedNode.errorSig}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
