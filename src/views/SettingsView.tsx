import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  GitBranch,
  Globe,
  KeyRound,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Sliders,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  getNotificationPermission,
  getNotificationsPreference,
  requestNotificationPermission,
  sendBrowserNotification,
  setNotificationsPreference,
  type BrowserNotificationPermission,
} from '../utils/notifications';
import type {
  ApiIntegration,
  ArbiterSettings,
  BridgeStatus,
  EffectClass,
  ExecutionMode,
  Severity,
  SystemIntegrationsStatus,
} from '../types';

interface SettingsViewProps {
  integrations: ApiIntegration[];
  integrationsStatus: SystemIntegrationsStatus | null;
  liveBridgeStatus: BridgeStatus | null;
  executionMode: ExecutionMode;
  selectedProvider: string;
  selectedModel: string;
  onChangeLlm: (provider: string, model: string) => void;
  onRefreshIntegrationsStatus: () => Promise<void>;
  onSwitchMode: (mode: ExecutionMode) => void;
  onSyncArbiterConfig: (cfg: Partial<ArbiterSettings>) => void;
  onProbeIntegration: (integration: ApiIntegration) => Promise<void>;
  onLogAuditEvent: (
    eventType: string,
    severity: 'INFO' | 'MEDIUM' | 'HIGH',
    summary: string
  ) => Promise<void>;
}

interface TestResultState {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function SettingsView({
  integrations,
  integrationsStatus,
  liveBridgeStatus,
  executionMode,
  selectedProvider,
  selectedModel,
  onChangeLlm,
  onRefreshIntegrationsStatus,
  onSwitchMode,
  onSyncArbiterConfig,
  onProbeIntegration,
  onLogAuditEvent,
}: SettingsViewProps) {
  const { profile, settings, theme, setTheme, updateSettings, getAuthHeaders, requireTwoFactorReauth } =
    useAuth();

  const [maxRetries, setMaxRetries] = useState(settings?.maxRetriesPerAnchor ?? 3);
  const [maxRollbacks, setMaxRollbacks] = useState(settings?.maxTotalRollbacks ?? 8);
  const [maxConstraints, setMaxConstraints] = useState(settings?.maxConstraints ?? 5);
  const [maxRepeatRejects, setMaxRepeatRejects] = useState(settings?.maxRepeatRejects ?? 3);
  const [replanSteps, setReplanSteps] = useState(settings?.replanSteps ?? 2);
  const [controlRun, setControlRun] = useState(settings?.controlRunEnabled ?? true);
  const [autoApproveIdemp, setAutoApproveIdemp] = useState(settings?.autoApproveIdempotent ?? true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);

  // Server Integration Tests
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResultState>>({});
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  // Zero-Clutter Spoilers (collapsed by default!)
  const [showOptionalLlms, setShowOptionalLlms] = useState(false);
  const [showPythonWizard, setShowPythonWizard] = useState(false);
  const [downloadingAgent, setDownloadingAgent] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Telegram filter
  const [tgMinSeverity, setTgMinSeverity] = useState<Severity>(
    integrationsStatus?.telegram.minSeverity || 'HIGH'
  );
  const [tgEnabled, setTgEnabled] = useState<boolean>(
    integrationsStatus?.telegram.enabledNotifications ?? true
  );
  const [savingTg, setSavingTg] = useState(false);

  // Web Notifications API state
  const [notifPermission, setNotifPermission] = useState<BrowserNotificationPermission>(
    getNotificationPermission()
  );
  const [notifEnabled, setNotifEnabled] = useState<boolean>(getNotificationsPreference());

  // Custom REST API form (Zero client API key inputs!)
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [healthPath, setHealthPath] = useState('/health');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'api_key'>('none');
  const [authHeaderName, setAuthHeaderName] = useState('X-API-Key');
  const [effectClass, setEffectClass] = useState<EffectClass>('read_only');
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [addingApi, setAddingApi] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setMaxRetries(settings.maxRetriesPerAnchor);
    setMaxRollbacks(settings.maxTotalRollbacks);
    setMaxConstraints(settings.maxConstraints);
    setMaxRepeatRejects(settings.maxRepeatRejects);
    setReplanSteps(settings.replanSteps);
    setControlRun(settings.controlRunEnabled);
    setAutoApproveIdemp(settings.autoApproveIdempotent);
  }, [settings]);

  useEffect(() => {
    if (!integrationsStatus) return;
    setTgMinSeverity(integrationsStatus.telegram.minSeverity);
    setTgEnabled(integrationsStatus.telegram.enabledNotifications);
  }, [integrationsStatus]);

  if (!profile) return null;

  const canManageApi = profile.role === 'admin' || profile.canManageIntegrations;
  const canDownloadBridge = profile.role === 'admin' || profile.role === 'operator';

  const llmProviders = integrationsStatus?.llmProviders || [];
  const primaryLlm =
    llmProviders.find((p) => p.id === 'gemini') || {
      id: 'gemini' as const,
      label: 'Google Gemini',
      configured: false,
      maskedKey: null,
      models: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
      defaultModel: 'gemini-3.1-flash-lite',
      envHint: 'GEMINI_API_KEY',
      tier: 'primary' as const,
    };
  const optionalLlms = llmProviders.filter((p) => p.id !== 'gemini');
  const configuredOptionalCount = optionalLlms.filter((p) => p.configured).length;

  const wsBridgeUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/bridge`
      : 'ws://localhost:3000/ws/bridge';
  const oneLineBridgeCmd = `VANGUARD_CONTROL_PLANE_WS="${wsBridgeUrl}" VANGUARD_BRIDGE_HMAC_SECRET="<ваш_секрет>" VANGUARD_WORKSPACE_DIR="./workspace" python3 vanguard_bridge_agent.py`;

  const runServerTest = async (
    key: string,
    endpoint: string,
    body?: Record<string, unknown>
  ) => {
    setTestingKey(key);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(body || {}),
      });
      if (resp.status === 403) {
        const errData = await resp.json().catch(() => ({}));
        requireTwoFactorReauth(errData.error || 'Требуется серверное подтверждение 2FA.');
        return;
      }
      const data = await resp.json();
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          ok: Boolean(data.ok),
          message: data.message || (data.ok ? 'Проверка успешна' : 'Ошибка проверки'),
          latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
        },
      }));
      await onRefreshIntegrationsStatus();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          ok: false,
          message: err instanceof Error ? err.message : 'Сетевая ошибка проверки',
        },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleDownloadBridgeScript = async () => {
    setDownloadingAgent(true);
    setDownloadError(null);
    try {
      const resp = await fetch('/api/bridge/agent-script', {
        method: 'GET',
        headers: getAuthHeaders(),
      });
      if (resp.status === 403) {
        const errData = await resp.json().catch(() => ({}));
        if (errData.code === 'TWO_FACTOR_REQUIRED') {
          requireTwoFactorReauth(errData.error || 'Требуется подтверждённая 2FA-сессия.');
        } else {
          setDownloadError(errData.error || 'Недостаточно прав для скачивания скрипта.');
        }
        return;
      }
      if (!resp.ok) {
        setDownloadError(`Ошибка скачивания (HTTP ${resp.status})`);
        return;
      }
      const text = await resp.text();
      const blob = new Blob([text], { type: 'text/x-python;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vanguard_bridge_agent.py';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await onLogAuditEvent(
        'BRIDGE_SCRIPT_DOWNLOADED',
        'INFO',
        'Скачан эталонный скрипт vanguard_bridge_agent.py для подключения локального Python-ядра'
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Сетевая ошибка скачивания');
    } finally {
      setDownloadingAgent(false);
    }
  };

  const handleCopyBridgeCmd = async () => {
    try {
      await navigator.clipboard.writeText(oneLineBridgeCmd);
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      // Clipboard API fallback ignored cleanly
    }
  };

  const handleSaveTelegramFilter = async () => {
    setSavingTg(true);
    try {
      const resp = await fetch('/api/system/telegram-filter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          minSeverity: tgMinSeverity,
          enabledNotifications: tgEnabled,
        }),
      });
      if (resp.status === 403) {
        const errData = await resp.json().catch(() => ({}));
        requireTwoFactorReauth(errData.error || 'Требуется серверное подтверждение 2FA.');
        return;
      }
      await onRefreshIntegrationsStatus();
      await onLogAuditEvent(
        'TELEGRAM_FILTER_UPDATED',
        'INFO',
        `Обновлён фильтр Telegram-уведомлений: minSeverity=${tgMinSeverity}, enabled=${tgEnabled}`
      );
    } finally {
      setSavingTg(false);
    }
  };

  const handleToggleBrowserNotifications = async () => {
    if (notifPermission !== 'granted') {
      const perm = await requestNotificationPermission();
      setNotifPermission(perm);
      if (perm === 'granted') {
        setNotificationsPreference(true);
        setNotifEnabled(true);
        sendBrowserNotification(
          'Vanguard SRE: уведомления включены',
          'Вы будете получать оповещения об Approval Gate, откатах и аварийных остановках.',
          { force: true }
        );
      }
      return;
    }
    const next = !notifEnabled;
    setNotificationsPreference(next);
    setNotifEnabled(next);
  };

  const handleSaveArbiter = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSaved(null);
    const next = {
      maxRetriesPerAnchor: Math.min(20, Math.max(1, Number(maxRetries))),
      maxTotalRollbacks: Math.min(50, Math.max(1, Number(maxRollbacks))),
      maxConstraints: Math.min(20, Math.max(1, Number(maxConstraints))),
      maxRepeatRejects: Math.min(20, Math.max(1, Number(maxRepeatRejects))),
      replanSteps: Math.min(10, Math.max(1, Number(replanSteps))),
      controlRunEnabled: controlRun,
      autoApproveIdempotent: autoApproveIdemp,
      theme,
    };
    try {
      await updateSettings(next);
      onSyncArbiterConfig(next);
      setSettingsSaved('Политика Арбитра сохранена и применена к WebSocket-рантайму.');
      await onLogAuditEvent(
        'ARBITER_POLICY_UPDATED',
        'INFO',
        `Обновлены лимиты Арбитра: retries=${next.maxRetriesPerAnchor}, rollbacks=${next.maxTotalRollbacks}`
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageApi) return;
    const cleanName = name.trim().slice(0, 100);
    const cleanUrl = baseUrl.trim().slice(0, 500);
    if (!cleanName || cleanUrl.length < 8) return;

    setAddingApi(true);
    const id = `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const docPath = `integrations/${id}`;
    try {
      await setDoc(doc(db, 'integrations', id), {
        id,
        ownerId: profile.uid,
        name: cleanName,
        baseUrl: cleanUrl,
        healthPath: healthPath.trim().slice(0, 200),
        authType,
        authHeaderName: authHeaderName.trim().slice(0, 64) || 'Authorization',
        effectClass,
        timeoutMs: Math.min(120000, Math.max(500, Number(timeoutMs))),
        enabled: true,
        lastStatus: 'unknown',
        lastLatencyMs: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setName('');
      setBaseUrl('');
      setHealthPath('/health');
      await onLogAuditEvent(
        'INTEGRATION_ADDED',
        'INFO',
        `Подключён внешний API "${cleanName}" (${effectClass})`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    } finally {
      setAddingApi(false);
    }
  };

  const handleDeleteIntegration = async (item: ApiIntegration) => {
    const docPath = `integrations/${item.id}`;
    try {
      await deleteDoc(doc(db, 'integrations', item.id));
      await onLogAuditEvent('INTEGRATION_REMOVED', 'MEDIUM', `Удалён внешний API "${item.name}"`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  };

  const handleProbe = async (item: ApiIntegration) => {
    setProbingId(item.id);
    try {
      await onProbeIntegration(item);
    } finally {
      setProbingId(null);
    }
  };

  const bridge = liveBridgeStatus || integrationsStatus?.bridge;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Настройки контура, Env-секреты и внешние интеграции
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Все ключи API и токены читаются строго из переменных окружения сервера (Zero Secrets in
          Firestore/Client).
        </p>
      </div>

      {/* Amber Ephemeral Secrets Notice (CISO Transparency) */}
      {integrationsStatus?.ephemeralSecrets && (
        <div className="p-4 rounded-xl border border-amber-400/70 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Используются временные ключи — после перезапуска сервера сессии 2FA и новая
              HMAC-цепочка сбросятся
            </p>
            <p className="font-mono text-[11px] text-amber-800/80 dark:text-amber-300/80">
              Для постоянной криптографической привязки задайте в окружении:{' '}
              {integrationsStatus.ephemeralSecretDetails?.transponder ? 'TRANSPONDER_SECRET' : ''}
              {integrationsStatus.ephemeralSecretDetails?.transponder &&
              integrationsStatus.ephemeralSecretDetails?.twoFactorSession
                ? ' · '
                : ''}
              {integrationsStatus.ephemeralSecretDetails?.twoFactorSession
                ? 'TWO_FACTOR_SESSION_SECRET'
                : ''}
            </p>
          </div>
        </div>
      )}

      {/* Zero-Clutter 4 Core Working Blocks */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Основные подключения контура (process.env)
            </h2>
          </div>

          <button
            type="button"
            disabled={refreshingStatus}
            onClick={async () => {
              setRefreshingStatus(true);
              try {
                await onRefreshIntegrationsStatus();
              } finally {
                setRefreshingStatus(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingStatus ? 'animate-spin' : ''}`} />
            Обновить статус
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Active LLM (Google Gemini from ENV) */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0F172A] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Cpu className="w-4 h-4 text-sky-500" />
                <span>Активный LLM · Google Gemini</span>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  primaryLlm.configured
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {primaryLlm.configured ? 'ENV ACTIVE' : 'NOT SET'}
              </span>
            </div>

            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
              <p>
                Ключ GEMINI_API_KEY:{' '}
                {primaryLlm.configured ? primaryLlm.maskedKey : 'не задан (доступен MOCK_DEMO)'}
              </p>
              <p>
                Выбрано: {selectedProvider === 'gemini' ? selectedModel : `${selectedProvider} / ${selectedModel}`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={selectedProvider === 'gemini' ? selectedModel : primaryLlm.defaultModel}
                onChange={(e) => onChangeLlm('gemini', e.target.value)}
                aria-label="Модель Google Gemini"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                {primaryLlm.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={testingKey === 'llm-gemini'}
                onClick={() => runServerTest('llm-gemini', '/api/system/test-llm', { provider: 'gemini' })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                {testingKey === 'llm-gemini' ? 'Проверка...' : 'Проверить Gemini'}
              </button>
            </div>

            {testResults['llm-gemini'] && (
              <p
                className={`text-xs font-mono ${
                  testResults['llm-gemini'].ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {testResults['llm-gemini'].message}
                {typeof testResults['llm-gemini'].latencyMs === 'number'
                  ? ` (${testResults['llm-gemini'].latencyMs} мс)`
                  : ''}
              </p>
            )}
          </div>

          {/* Card 2: Python Live Bridge + Quick-Connect Wizard */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0F172A] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Radio className="w-4 h-4 text-sky-500" />
                <span>Python Live Bridge</span>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  executionMode === 'LIVE_BRIDGE'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : executionMode === 'AI_SANDBOX'
                      ? 'text-sky-600 dark:text-sky-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {executionMode}
              </span>
            </div>

            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
              <p>
                WS-агент:{' '}
                {bridge?.wsAgentConnected
                  ? `подключён (v${bridge.agentVersion || '2.1'} · proto ${bridge.protocolVersion || '2.1'})`
                  : 'не подключён'}
              </p>
              <p>
                HMAC Secret:{' '}
                {bridge?.hmacConfigured ? `настроен (${bridge.hmacMasked})` : 'не задан (локальный тест)'}
              </p>
            </div>

            {/* 3-Mode Quick Switcher */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {(['AI_SANDBOX', 'MOCK_DEMO', 'LIVE_BRIDGE'] as const).map((m) => {
                const disabled = m === 'LIVE_BRIDGE' && !bridge?.canSwitchToLive;
                const active = executionMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSwitchMode(m)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                      active
                        ? 'bg-sky-600 text-white font-semibold'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {m}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={testingKey === 'bridge'}
                onClick={() => runServerTest('bridge', '/api/system/test-bridge')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Activity className="w-3 h-3" />
                {testingKey === 'bridge' ? 'Пинг...' : 'Пинг'}
              </button>
            </div>

            {testResults.bridge && (
              <p
                className={`text-xs font-mono ${
                  testResults.bridge.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {testResults.bridge.message}
              </p>
            )}

            {/* Live Bridge Telemetry Block */}
            <div className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 text-[11px] font-mono space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span>Последний HMAC heartbeat</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {bridge?.lastHeartbeatAt
                    ? new Date(bridge.lastHeartbeatAt).toLocaleTimeString('ru-RU')
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>Задержка / Протокол</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {typeof bridge?.lastLatencyMs === 'number' ? `${bridge.lastLatencyMs} мс` : '—'} ·{' '}
                  {bridge?.protocolVersion ? `v${bridge.protocolVersion}` : 'v2.1'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-slate-500">
                <span className="shrink-0">Локальные модули</span>
                <span className="text-slate-800 dark:text-slate-200 truncate text-right">
                  {bridge?.modules && bridge.modules.length > 0
                    ? bridge.modules.join(', ')
                    : 'не обнаружены'}
                </span>
              </div>
            </div>

            {/* Expandable Local Python Core Quick-Connect Wizard */}
            <div className="pt-1 border-t border-slate-200/80 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowPythonWizard((prev) => !prev)}
                className="w-full flex items-center justify-between text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer py-1"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  Подключить локальное Python-ядро
                </span>
                {showPythonWizard ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>

              {showPythonWizard && (
                <div className="mt-2.5 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={downloadingAgent || !canDownloadBridge}
                      onClick={handleDownloadBridgeScript}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {downloadingAgent ? 'Загрузка...' : 'Скачать vanguard_bridge_agent.py'}
                    </button>
                    {!canDownloadBridge && (
                      <span className="text-[11px] text-slate-500">
                        Доступно ролям admin и operator
                      </span>
                    )}
                  </div>

                  {downloadError && (
                    <p className="text-[11px] font-mono text-rose-600 dark:text-rose-400">
                      {downloadError}
                    </p>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Однострочная команда запуска (pip install websockets):</span>
                      <button
                        type="button"
                        onClick={handleCopyBridgeCmd}
                        className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {copiedCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedCmd ? 'Скопировано' : 'Копировать'}
                      </button>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                      {oneLineBridgeCmd}
                    </pre>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Поместите <span className="font-mono">vanguard_bridge_agent.py</span> рядом с
                    модулями <span className="font-mono">arbiter.py</span>,{' '}
                    <span className="font-mono">transponder.py</span>,{' '}
                    <span className="font-mono">workspace.py</span> и{' '}
                    <span className="font-mono">verifier.py</span> — агент автоматически обнаружит
                    их и передаст в Control Plane через подписанный HMAC-SHA256 канал.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Card 3: Two-Way Telegram Control Panel */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0F172A] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <MessageSquare className="w-4 h-4 text-sky-500" />
                <span>Telegram Control Panel</span>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  integrationsStatus?.telegram.configured
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {integrationsStatus?.telegram.configured
                  ? integrationsStatus.telegram.pollingActive
                    ? 'POLLING'
                    : 'CONFIGURED'
                  : 'NOT SET'}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
              <p>
                Bot Token:{' '}
                {integrationsStatus?.telegram.hasToken
                  ? integrationsStatus.telegram.maskedToken
                  : 'не задан'}{' '}
                · Allowlist: {integrationsStatus?.telegram.allowedChatsCount ?? 0} чат(ов)
              </p>
              <p className="text-[11px]">
                Webhook Secret:{' '}
                {integrationsStatus?.telegram.webhookConfigured
                  ? 'активен (HMAC/timingSafeEqual)'
                  : 'выключен (только long-polling)'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={tgMinSeverity}
                onChange={(e) => setTgMinSeverity(e.target.value as Severity)}
                aria-label="Минимальный приоритет уведомлений Telegram"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH+</option>
                <option value="MEDIUM">MEDIUM+</option>
                <option value="LOW">LOW+</option>
                <option value="INFO">INFO (все)</option>
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tgEnabled}
                  onChange={(e) => setTgEnabled(e.target.checked)}
                  className="w-3.5 h-3.5 accent-sky-600"
                />
                Уведомления
              </label>

              <button
                type="button"
                disabled={savingTg}
                onClick={handleSaveTelegramFilter}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-medium cursor-pointer"
              >
                {savingTg ? '...' : 'Применить'}
              </button>

              <button
                type="button"
                disabled={testingKey === 'telegram'}
                onClick={() => runServerTest('telegram', '/api/system/test-telegram')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                {testingKey === 'telegram' ? 'Тест...' : 'Тест Telegram'}
              </button>
            </div>
            {testResults.telegram && (
              <p
                className={`text-xs font-mono ${
                  testResults.telegram.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {testResults.telegram.message}
              </p>
            )}
          </div>

          {/* Card 4: GitHub Bridge */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0F172A] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <GitBranch className="w-4 h-4 text-sky-500" />
                <span>GitHub Bridge</span>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  integrationsStatus?.github.configured
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {integrationsStatus?.github.configured ? 'CONFIGURED' : 'NOT SET'}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1">
              <p>
                Токен:{' '}
                {integrationsStatus?.github.hasToken
                  ? integrationsStatus.github.maskedToken
                  : 'не задан'}
              </p>
              <p>Репозиторий: {integrationsStatus?.github.defaultRepo || 'не указан'}</p>
              <p className="text-[11px]">ENV: GITHUB_TOKEN · GITHUB_DEFAULT_REPO</p>
            </div>
            <div className="pt-1">
              <button
                type="button"
                disabled={testingKey === 'github'}
                onClick={() => runServerTest('github', '/api/system/test-github')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                {testingKey === 'github' ? 'Проверка...' : 'Проверить GitHub'}
              </button>
            </div>
            {testResults.github && (
              <p
                className={`text-xs font-mono ${
                  testResults.github.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {testResults.github.message}
              </p>
            )}
          </div>
        </div>

        {/* Collapsed-by-default Spoiler: Optional Paid LLM Providers */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowOptionalLlms((prev) => !prev)}
            className="w-full flex items-center justify-between py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              {showOptionalLlms ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span>Дополнительные LLM-провайдеры (опционально)</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              {configuredOptionalCount > 0
                ? `подключено: ${configuredOptionalCount}`
                : 'Anthropic · OpenAI · Custom API'}
            </span>
          </button>

          {showOptionalLlms && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              {optionalLlms.map((prov) => {
                const testKey = `llm-${prov.id}`;
                const res = testResults[testKey];
                return (
                  <div
                    key={prov.id}
                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#0F172A]/80 space-y-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {prov.label}
                      </span>
                      <span
                        className={`font-mono text-[11px] ${
                          prov.configured
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {prov.configured ? 'ENV' : 'опционально'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-500 truncate">
                      {prov.configured ? `Ключ: ${prov.maskedKey}` : `ENV: ${prov.envHint}`}
                    </p>
                    {prov.configured && (
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => onChangeLlm(prov.id, prov.defaultModel)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                            selectedProvider === prov.id
                              ? 'bg-sky-600 text-white'
                              : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {selectedProvider === prov.id ? 'Активен' : 'Выбрать'}
                        </button>
                        <button
                          type="button"
                          disabled={testingKey === testKey}
                          onClick={() =>
                            runServerTest(testKey, '/api/system/test-llm', { provider: prov.id })
                          }
                          className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          {testingKey === testKey ? '...' : 'Тест'}
                        </button>
                      </div>
                    )}
                    {res && (
                      <p
                        className={`text-[11px] font-mono ${
                          res.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {res.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Web Notifications API Toggle */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <Bell className="w-4 h-4 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                Браузерные уведомления (Web Notifications API)
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Мгновенные оповещения о запросах Approval Gate, 3-слойных откатах, эскалациях и
                завершении задач · Статус: <span className="font-mono">{notifPermission}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={notifPermission === 'unsupported' || notifPermission === 'denied'}
              onClick={handleToggleBrowserNotifications}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                notifPermission === 'granted' && notifEnabled
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              {notifPermission !== 'granted'
                ? 'Разрешить уведомления'
                : notifEnabled
                  ? 'Уведомления активны'
                  : 'Включить уведомления'}
            </button>
          </div>
        </div>
      </div>

      {/* Arbiter Policy Form */}
      <form
        onSubmit={handleSaveArbiter}
        className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Параметры Arbiter и ExternalVerifier
            </h2>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                theme === 'dark'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              Тёмная тема
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                theme === 'light'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              Светлая тема
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Повторов на якорь (max_retries)
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Бюджет откатов (max_total_rollbacks)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxRollbacks}
              onChange={(e) => setMaxRollbacks(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Лимит ограничений (max_constraints)
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxConstraints}
              onChange={(e) => setMaxConstraints(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Порог повтора отпечатков (max_repeat)
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxRepeatRejects}
              onChange={(e) => setMaxRepeatRejects(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Шагов перепланирования (replan_steps)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={replanSteps}
              onChange={(e) => setReplanSteps(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                Контрольный прогон на чистом якоре (control_run)
              </p>
              <p className="text-[11px] text-slate-500">
                Различает сбои окружения (ENV) от ошибок патча (PATCH)
              </p>
            </div>
            <input
              type="checkbox"
              checked={controlRun}
              onChange={(e) => setControlRun(e.target.checked)}
              className="w-4 h-4 accent-sky-600"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                Авто-replay для idempotent_write
              </p>
              <p className="text-[11px] text-slate-500">
                Безопасный повтор эффектов с подтверждённым ключом идемпотентности
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoApproveIdemp}
              onChange={(e) => setAutoApproveIdemp(e.target.checked)}
              className="w-4 h-4 accent-sky-600"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 pt-2">
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {settingsSaved || ''}
          </span>
          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {savingSettings ? 'Сохранение...' : 'Сохранить политику'}
          </button>
        </div>
      </form>

      {/* External API Integrations (Zero Client Secrets) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-5">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
          <Globe className="w-4 h-4 text-sky-500" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Внешние REST-сервисы (ToolSchema / EffectLedger)
          </h2>
        </div>

        {canManageApi ? (
          <form onSubmit={handleAddIntegration} className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название сервиса (напр. Prometheus Health)"
              className="md:col-span-3 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <input
              type="url"
              required
              maxLength={500}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="md:col-span-4 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <input
              type="text"
              maxLength={200}
              value={healthPath}
              onChange={(e) => setHealthPath(e.target.value)}
              placeholder="/health"
              className="md:col-span-2 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <select
              value={effectClass}
              onChange={(e) => setEffectClass(e.target.value as EffectClass)}
              aria-label="Класс эффекта ToolSchema"
              className="md:col-span-3 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              <option value="read_only">read_only</option>
              <option value="idempotent_write">idempotent_write</option>
              <option value="irreversible">irreversible</option>
            </select>

            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as 'none' | 'bearer' | 'api_key')}
              aria-label="Тип авторизации API (из серверного env)"
              className="md:col-span-3 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              <option value="none">Без авторизации</option>
              <option value="bearer">Bearer (ENV: CUSTOM_API_BEARER_TOKEN)</option>
              <option value="api_key">Header Key (ENV: CUSTOM_API_KEY)</option>
            </select>

            <input
              type="text"
              maxLength={64}
              value={authHeaderName}
              onChange={(e) => setAuthHeaderName(e.target.value)}
              placeholder="Заголовок (X-API-Key)"
              disabled={authType === 'none'}
              className="md:col-span-3 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-50"
            />

            <input
              type="number"
              min={500}
              max={60000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              placeholder="Таймаут (мс)"
              className="md:col-span-3 px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
            />

            <button
              type="submit"
              disabled={addingApi}
              className="md:col-span-3 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Подключить API
            </button>
          </form>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            У вашей учётной записи нет права canManageIntegrations для добавления новых внешних
            сервисов.
          </p>
        )}

        <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {integrations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Дополнительные REST-сервисы ещё не добавлены. Укажите URL (например,
              https://httpbin.org) и проверьте доступность через серверный прокси.
            </div>
          ) : (
            integrations.map((item) => (
              <div
                key={item.id}
                className="p-4 flex flex-wrap items-center justify-between gap-4 bg-slate-50/40 dark:bg-[#0F172A]/60"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {item.name}
                  </p>
                  <p className="text-xs font-mono text-slate-500 truncate">
                    {item.baseUrl}
                    {item.healthPath} · {item.effectClass} · auth:{item.authType} ·{' '}
                    {item.timeoutMs}мс
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono tabular-nums inline-flex items-center gap-1.5">
                    {item.lastStatus === 'online' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : item.lastStatus === 'degraded' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    ) : item.lastStatus === 'offline' ? (
                      <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    ) : null}
                    <span className="text-slate-600 dark:text-slate-300">
                      {item.lastStatus.toUpperCase()} · {item.lastLatencyMs} мс
                    </span>
                  </span>

                  <button
                    type="button"
                    disabled={probingId === item.id}
                    onClick={() => handleProbe(item)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <Activity className={`w-3.5 h-3.5 ${probingId === item.id ? 'animate-pulse' : ''}`} />
                    Проверить
                  </button>

                  {canManageApi && (
                    <button
                      type="button"
                      onClick={() => handleDeleteIntegration(item)}
                      aria-label={`Удалить ${item.name}`}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
