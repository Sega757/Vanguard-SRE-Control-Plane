import React, { useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  Cpu,
  FlaskConical,
  Loader2,
  Plus,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import type {
  AgentSession,
  ApprovalConflictNotice,
  ApprovalDecisionPayload,
  ApprovalPrompt,
  BridgeStatus,
  ChatStreamError,
  ExecutionMode,
  LlmProviderStatus,
  SessionMessage,
  SessionRuntimeState,
  UserProfile,
} from '../types';
import { DagVisualizer } from '../components/DagVisualizer';

interface ChatWorkspaceViewProps {
  profile: UserProfile;
  activeSession: AgentSession | null;
  messages: SessionMessage[];
  sessionState: SessionRuntimeState | null;
  streamingText: string;
  isStreaming: boolean;
  pendingApproval: ApprovalPrompt | null;
  approvalConflict: ApprovalConflictNotice | null;
  streamError: ChatStreamError | null;
  wsConnected: boolean;
  executionMode: ExecutionMode;
  bridgeStatus: BridgeStatus | null;
  llmProviders: LlmProviderStatus[];
  selectedProvider: string;
  selectedModel: string;
  onChangeLlm: (provider: string, model: string) => void;
  onSwitchMode: (mode: ExecutionMode) => void;
  onSendMessage: (prompt: string) => Promise<void>;
  onRetryPrompt: (prompt: string) => Promise<void>;
  onSwitchToMockDemoAndRetry: (prompt?: string) => Promise<void>;
  onCreateSession: () => Promise<void>;
  onRespondApproval: (decision: ApprovalDecisionPayload) => void;
  onEmergencyAbort: (reason: string) => Promise<void>;
  onClearApprovalConflict: () => void;
}

const QUICK_SCENARIOS = [
  {
    title: 'Патч с 3-слойным откатом',
    prompt:
      'Исправь утечку файловых дескрипторов в модуле worker_pool.py, примени патч с верификацией инвариантов и при сбое выполни откат к якорю с инъекцией ограничения.',
  },
  {
    title: 'Необратимый релиз (Approval)',
    prompt:
      'Подготовь и выполни канареечный деплой микросервиса billing-api в production с проверкой телеметрии и запросом подтверждения оператора перед необратимым эффектом.',
  },
  {
    title: 'Аудит воркспейса и якоря',
    prompt:
      'Проведи диагностику состояния git-воркспейса, проверь целостность HMAC-цепочки Transponder и зафиксируй новый проверенный якорь.',
  },
];

export function ChatWorkspaceView({
  profile,
  activeSession,
  messages,
  sessionState,
  streamingText,
  isStreaming,
  pendingApproval,
  approvalConflict,
  streamError,
  wsConnected,
  executionMode,
  bridgeStatus,
  llmProviders,
  selectedProvider,
  selectedModel,
  onChangeLlm,
  onSwitchMode,
  onSendMessage,
  onRetryPrompt,
  onSwitchToMockDemoAndRetry,
  onCreateSession,
  onRespondApproval,
  onEmergencyAbort,
  onClearApprovalConflict,
}: ChatWorkspaceViewProps) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [abortModalOpen, setAbortModalOpen] = useState(false);
  const [abortReason, setAbortReason] = useState('Аварийная остановка оператором (Web UI)');
  const [aborting, setAborting] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, pendingApproval, approvalConflict, streamError]);

  const canRun = profile.status === 'active' && profile.canRunAgent;
  const configuredProviders = llmProviders.filter((p) => p.configured);
  const visibleProviders = configuredProviders.length > 0 ? configuredProviders : llmProviders.filter((p) => p.tier === 'primary');
  const activeProviderObj = llmProviders.find((p) => p.id === selectedProvider);
  const availableModels =
    selectedProvider === 'mock_demo'
      ? ['deterministic-offline']
      : activeProviderObj?.models || ['gemini-3.1-flash-lite'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting || isStreaming || !canRun) return;
    setInput('');
    setSubmitting(true);
    try {
      await onSendMessage(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (submitting || isStreaming || !canRun) return;
    setSubmitting(true);
    try {
      await onSendMessage(prompt);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAbort = async () => {
    setAborting(true);
    try {
      await onEmergencyAbort(abortReason.trim() || 'Аварийная остановка оператором');
      setAbortModalOpen(false);
    } finally {
      setAborting(false);
    }
  };

  const formatTime = (msg: SessionMessage) => {
    if (msg.createdAt && typeof msg.createdAt.toDate === 'function') {
      return msg.createdAt.toDate().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return msg.localTs || '';
  };

  const modeColor =
    executionMode === 'LIVE_BRIDGE'
      ? 'text-emerald-600 dark:text-emerald-400'
      : executionMode === 'AI_SANDBOX'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-amber-600 dark:text-amber-400';

  const modeSubtitle =
    executionMode === 'LIVE_BRIDGE'
      ? 'Боевой контур Python Execution Plane'
      : executionMode === 'AI_SANDBOX'
        ? 'Анализ в песочнице (файлы не изменены · dry_run: true)'
        : 'Офлайн-сценарий без вызовов LLM';

  return (
    <div className="h-[calc(100vh-4rem)] grid grid-cols-1 xl:grid-cols-12 relative">
      {/* Left 7 cols: Streaming WebSocket Chat */}
      <div className="xl:col-span-7 flex flex-col min-h-0 border-b xl:border-b-0 xl:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1120]">
        {/* Session & Execution Plane Control Strip */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0F172A] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {activeSession?.title || 'Новая сессия Vanguard SRE'}
              </h2>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                {activeSession ? `${activeSession.id} · ${activeSession.status}` : 'Инициализация...'}
                {sessionState ? ` · Шагов ${sessionState.totalSteps}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!activeSession || !wsConnected}
                onClick={() => setAbortModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                EMERGENCY ABORT / ROLLBACK
              </button>

              <button
                type="button"
                onClick={onCreateSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Новая
              </button>
            </div>
          </div>

          {/* 3-Mode Execution Plane Selector & LLM Router Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-800/80 text-xs">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800/90 font-mono text-[11px]">
                {(['AI_SANDBOX', 'MOCK_DEMO', 'LIVE_BRIDGE'] as const).map((m) => {
                  const disabled = m === 'LIVE_BRIDGE' && !bridgeStatus?.canSwitchToLive;
                  const active = executionMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled || isStreaming}
                      title={
                        disabled
                          ? 'Подключите vanguard_bridge_agent.py в Настройках для активации LIVE_BRIDGE'
                          : undefined
                      }
                      onClick={() => onSwitchMode(m)}
                      className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>

              <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${modeColor}`}>
                {executionMode === 'AI_SANDBOX' ? (
                  <FlaskConical className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Radio className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{modeSubtitle}</span>
              </span>
            </div>

            {/* Active LLM Selector (Clean — only configured providers + offline mock when in MOCK_DEMO) */}
            {executionMode !== 'MOCK_DEMO' && (
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    const nextProv = e.target.value;
                    const found = llmProviders.find((p) => p.id === nextProv);
                    onChangeLlm(nextProv, found?.defaultModel || 'gemini-3.1-flash-lite');
                  }}
                  aria-label="Провайдер LLM"
                  className="px-2 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                >
                  {visibleProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} {p.configured ? '(ENV)' : ''}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedModel}
                  onChange={(e) => onChangeLlm(selectedProvider, e.target.value)}
                  aria-label="Модель LLM"
                  className="px-2 py-1 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 max-w-[180px]"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {messages.length === 0 && !isStreaming && (
            <div className="py-8 max-w-xl mx-auto space-y-6">
              <div className="space-y-2">
                <div className={`flex items-center gap-2 text-xs font-mono ${modeColor}`}>
                  <Terminal className="w-4 h-4" />
                  <span>Arbiter Protocol · {executionMode}</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Поставьте инженерную задачу агенту Vanguard SRE
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {executionMode === 'AI_SANDBOX'
                    ? 'В режиме AI_SANDBOX активная модель LLM разобьёт вашу задачу на шаги DAG с гипотезой патча, оценкой рисков и флагом dry_run: true (файлы на диске не изменяются).'
                    : executionMode === 'MOCK_DEMO'
                      ? 'В режиме MOCK_DEMO выполняются детерминированные офлайн-сценарии 3-слойного отката и Approval Gate без обращения к внешним LLM.'
                      : 'В режиме LIVE_BRIDGE команды с подписью HMAC-SHA256 отправляются напрямую в локальный Python Execution Plane.'}
                </p>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Готовые сценарии проверки протокола:
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  {QUICK_SCENARIOS.map((sc) => (
                    <button
                      key={sc.title}
                      type="button"
                      disabled={!canRun || !wsConnected}
                      onClick={() => handleQuickPrompt(sc.prompt)}
                      className="text-left p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#111827] hover:border-sky-500/60 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {sc.title}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                        {sc.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isConstraint = msg.role === 'constraint';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-1">
                  <span>
                    {isUser
                      ? profile.displayName
                      : isConstraint
                        ? 'Ограничение Арбитра'
                        : 'Vanguard SRE'}
                  </span>
                  {msg.stepSid && <span>· {msg.stepSid}</span>}
                  {formatTime(msg) && <span className="tabular-nums">· {formatTime(msg)}</span>}
                </div>
                <div
                  className={`max-w-[90%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isUser
                      ? 'bg-sky-600 text-white'
                      : isConstraint
                        ? 'border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-mono text-xs'
                        : 'border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111827] text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            );
          })}

          {/* TOCTOU 409 Conflict Banner */}
          {approvalConflict && (
            <div className="p-4 rounded-xl border border-rose-400 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <div className="space-y-0.5">
                  <p className="font-semibold font-mono">
                    HTTP {approvalConflict.statusCode} · Защита TOCTOU / Идемпотентность ({approvalConflict.at})
                  </p>
                  <p>{approvalConflict.error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClearApprovalConflict}
                className="text-rose-600 dark:text-rose-300 hover:underline shrink-0 cursor-pointer"
              >
                Скрыть
              </button>
            </div>
          )}

          {/* Interactive TOCTOU-Protected Approval Gate */}
          {pendingApproval && (
            <div className="p-4 rounded-xl border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Требуется подтверждение необратимого эффекта (TOCTOU Gate)
                  </p>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    {pendingApproval.summary}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                    effect_id: {pendingApproval.effectId} · tool: {pendingApproval.tool} · key:{' '}
                    {pendingApproval.idempotencyKey}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                    expected_anchor_hash: {pendingApproval.expectedAnchorHash}
                  </p>
                </div>
              </div>

              {profile.canApproveIrreversible ? (
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onRespondApproval({
                        effectId: pendingApproval.effectId || pendingApproval.approvalId,
                        idempotencyKey: pendingApproval.idempotencyKey,
                        expectedAnchorHash: pendingApproval.expectedAnchorHash,
                        decision: 'APPROVE',
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Одобрить выполнение
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onRespondApproval({
                        effectId: pendingApproval.effectId || pendingApproval.approvalId,
                        idempotencyKey: pendingApproval.idempotencyKey,
                        expectedAnchorHash: pendingApproval.expectedAnchorHash,
                        decision: 'REJECT',
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Отклонить и эскалировать
                  </button>
                </div>
              ) : (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                  У вашей учётной записи нет права canApproveIrreversible. Обратитесь к
                  администратору или подтвердите эффект через Telegram-пульт.
                </p>
              )}
            </div>
          )}

          {/* Live Streaming Assistant Response */}
          {isStreaming && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 text-[11px] font-mono text-sky-600 dark:text-sky-400 mb-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Vanguard SRE · {executionMode}
                  {executionMode === 'AI_SANDBOX' ? ' (dry_run: true)' : ''}
                </span>
              </div>
              <div className="max-w-[90%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-[#111827] text-slate-800 dark:text-slate-200">
                {streamingText || 'Выполняются шаги Арбитра и ExternalVerifier...'}
              </div>
            </div>
          )}

          {/* Honest AI_SANDBOX Error & Recovery Panel (no silent fake fallback) */}
          {streamError && (
            <div className="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/35 text-rose-800 dark:text-rose-200 text-xs space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold font-mono">
                    Ошибка выполнения{streamError.code ? ` · ${streamError.code}` : ''}
                  </p>
                  <p className="leading-relaxed">{streamError.message}</p>
                </div>
              </div>

              {(streamError.retryPrompt || streamError.canSwitchToMockDemo) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {streamError.retryPrompt && (
                    <button
                      type="button"
                      disabled={submitting || isStreaming || !wsConnected}
                      onClick={() => void onRetryPrompt(streamError.retryPrompt!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 hover:bg-rose-100/60 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-200 text-xs font-medium cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Повторить запрос
                    </button>
                  )}
                  {streamError.canSwitchToMockDemo && (
                    <button
                      type="button"
                      disabled={submitting || isStreaming || !wsConnected}
                      onClick={() => void onSwitchToMockDemoAndRetry(streamError.retryPrompt)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      Переключиться в MOCK_DEMO
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0F172A]"
        >
          {!canRun ? (
            <div className="text-xs text-amber-600 dark:text-amber-400 py-2">
              Запуск задач агента отключён для вашей роли ({profile.role}) или аккаунт приостановлен.
            </div>
          ) : (
            <div className="flex items-end gap-2.5">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit(e);
                  }
                }}
                placeholder={
                  wsConnected
                    ? 'Опишите задачу для агента Vanguard SRE (Enter — отправить, Shift+Enter — перенос)...'
                    : 'Ожидание подключения WebSocket...'
                }
                disabled={!wsConnected || isStreaming}
                className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!wsConnected || isStreaming || submitting || !input.trim()}
                className="h-11 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span>Запустить</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Right 5 cols: Live DAG & Constraint Visualizer */}
      <div className="xl:col-span-5 min-h-[360px] xl:min-h-0 bg-slate-50/40 dark:bg-[#0F172A]/70 overflow-hidden">
        <DagVisualizer sessionState={sessionState} />
      </div>

      {/* Emergency Abort Confirmation Modal */}
      {abortModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="emergency-abort-title"
        >
          <div className="w-full max-w-md rounded-xl border border-rose-500/50 bg-white dark:bg-[#111827] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertOctagon className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3
                  id="emergency-abort-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  Подтвердите EMERGENCY ABORT / ROLLBACK
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Будет немедленно отправлен сигнал <span className="font-mono">SIGKILL</span>{' '}
                  активным подпроцессам, отклонены ожидающие эффекты и выполнен 3-слойный откат к
                  последнему проверенному якорю{' '}
                  <span className="font-mono text-slate-900 dark:text-slate-200">
                    {sessionState?.anchorSid || activeSession?.anchorSid || 'bootstrap'}
                  </span>
                  .
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="abort-reason"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Причина аварийной остановки (запишется в HMAC-аудит)
              </label>
              <input
                id="abort-reason"
                type="text"
                maxLength={240}
                value={abortReason}
                onChange={(e) => setAbortReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={aborting}
                onClick={() => setAbortModalOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={aborting}
                onClick={handleConfirmAbort}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                {aborting ? 'Откат...' : 'Остановить и откатить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
