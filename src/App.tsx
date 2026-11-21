import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Plus, Radio } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, testConnection } from './firebase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useWebSocket } from './hooks/useWebSocket';
import { sendBrowserNotification } from './utils/notifications';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { TwoFactorGate } from './components/TwoFactorGate';
import { Sidebar } from './components/Sidebar';
import { ChatWorkspaceView } from './views/ChatWorkspaceView';
import { DashboardView } from './views/DashboardView';
import { AuditLogView } from './views/AuditLogView';
import { SessionsView } from './views/SessionsView';
import { SettingsView } from './views/SettingsView';
import { ProfileView } from './views/ProfileView';
import { AdminPanelView } from './views/AdminPanelView';
import type {
  AgentSession,
  ApiIntegration,
  ApprovalPrompt,
  AuditLogEvent,
  ExecutionMode,
  NavSection,
  SessionMessage,
  SystemIntegrationsStatus,
  TransponderEvent,
} from './types';

const SECTION_TITLES: Record<NavSection, string> = {
  chat: 'Рабочий чат и DAG',
  dashboard: 'Дашборд и метрики',
  logs: 'Журнал событий Transponder',
  sessions: 'Сессии агента',
  settings: 'Настройки и внешние API',
  profile: 'Профиль и 2FA',
  admin: 'Панель администратора',
};

function VanguardShell() {
  const {
    firebaseUser,
    profile,
    loading,
    isAuthReady,
    twoFactorVerified,
    twoFactorToken,
    settings,
    getAuthHeaders,
    requireTwoFactorReauth,
  } = useAuth();
  const [activeSection, setActiveSection] = useState<NavSection>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [firestoreOnline, setFirestoreOnline] = useState(true);

  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [persistedLogs, setPersistedLogs] = useState<AuditLogEvent[]>([]);
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);

  const [integrationsStatus, setIntegrationsStatus] = useState<SystemIntegrationsStatus | null>(
    null
  );
  const [selectedProvider, setSelectedProvider] = useState<string>('gemini');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.1-flash-lite');

  const statusAbortRef = useRef<AbortController | null>(null);
  const userPickedModelRef = useRef(false);
  const isUnlocked = Boolean(isAuthReady && firebaseUser && profile && twoFactorVerified);

  // Only probe Firestore connectivity AFTER Firebase Auth is initialized and unlocked
  useEffect(() => {
    if (!isUnlocked) return;
    let active = true;
    void testConnection().then((res) => {
      if (active) setFirestoreOnline(res === 'online');
    });
    return () => {
      active = false;
    };
  }, [isUnlocked]);

  const refreshIntegrationsStatus = useCallback(async () => {
    if (statusAbortRef.current) {
      statusAbortRef.current.abort();
    }
    const controller = new AbortController();
    statusAbortRef.current = controller;

    try {
      const resp = await fetch('/api/system/integrations-status', {
        signal: controller.signal,
      });
      if (!resp.ok || controller.signal.aborted) return;
      const data = (await resp.json()) as SystemIntegrationsStatus;
      if (controller.signal.aborted) return;
      setIntegrationsStatus(data);

      // Auto-select configured LLM provider & sync server defaultModel unless user changed manually
      setSelectedProvider((prev) => {
        const currentOk = data.llmProviders.find((p) => p.id === prev && p.configured);
        if (currentOk) {
          if (!userPickedModelRef.current) {
            setSelectedModel(currentOk.defaultModel);
          }
          return prev;
        }
        const firstConfigured = data.llmProviders.find((p) => p.configured);
        if (firstConfigured) {
          setSelectedModel(firstConfigured.defaultModel);
          return firstConfigured.id;
        }
        const primary = data.llmProviders.find((p) => p.tier === 'primary');
        if (!userPickedModelRef.current) {
          setSelectedModel(primary?.defaultModel || 'gemini-3.1-flash-lite');
        }
        return primary?.id || 'gemini';
      });
    } catch {
      // Aborted or transient network issue — ignore cleanly without console noise
    }
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;
    void refreshIntegrationsStatus();
    return () => {
      if (statusAbortRef.current) {
        statusAbortRef.current.abort();
      }
    };
  }, [isUnlocked, refreshIntegrationsStatus]);

  // Persist an audit log event to Firestore (strictly append-only)
  const logAuditEvent = useCallback(
    async (
      eventType: string,
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
      summary: string,
      extra?: Partial<{
        seq: number;
        sessionId: string;
        sid: string;
        pid: string;
        payloadSummary: string;
        blobHash: string;
        prevHash: string;
        eventHash: string;
        latencyMs: number;
      }>
    ) => {
      if (!firebaseUser) return;
      const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      try {
        await setDoc(doc(db, 'auditLogs', id), {
          id,
          seq: extra?.seq ?? 0,
          ownerId: firebaseUser.uid,
          sessionId: (extra?.sessionId ?? activeSessionId ?? 'system').slice(0, 128),
          eventType: eventType.slice(0, 64),
          severity,
          sid: (extra?.sid ?? 'sys').slice(0, 128),
          pid: (extra?.pid ?? 'genesis').slice(0, 128),
          summary: summary.slice(0, 500),
          payloadSummary: (extra?.payloadSummary ?? '{}').slice(0, 4000),
          blobHash: (extra?.blobHash ?? '—').slice(0, 128),
          prevHash: (extra?.prevHash ?? '—').slice(0, 128),
          eventHash: (extra?.eventHash ?? '—').slice(0, 128),
          latencyMs: extra?.latencyMs ?? 0,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking audit persistence
      }
    },
    [firebaseUser, activeSessionId]
  );

  const handleCreateSession = useCallback(async () => {
    if (!firebaseUser || !profile) return;
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const docPath = `sessions/${id}`;
    try {
      await setDoc(doc(db, 'sessions', id), {
        id,
        ownerId: firebaseUser.uid,
        ownerEmail: profile.email,
        title: `Сессия SRE #${sessions.length + 1}`,
        status: 'ACTIVE',
        anchorSid: 'bootstrap',
        totalSteps: 1,
        totalRollbacks: 0,
        constraintsCount: 0,
        lastMessagePreview: 'Ожидание постановки задачи',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveSessionId(id);
      setActiveSection('chat');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }
  }, [firebaseUser, profile, sessions.length]);

  // Real-time Firestore subscriptions (only after full Auth + 2FA unlock)
  useEffect(() => {
    if (!isUnlocked || !firebaseUser) return;

    const toMillis = (ts: { toMillis?: () => number } | null | undefined) =>
      ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now();

    const sessionsQ = query(
      collection(db, 'sessions'),
      where('ownerId', '==', firebaseUser.uid),
      limit(100)
    );
    const unsubSessions = onSnapshot(
      sessionsQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as AgentSession)
          .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
        setSessions(list);
        if (list.length > 0) {
          setActiveSessionId((prev) => prev || list[0].id);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'sessions')
    );

    const logsQ = query(
      collection(db, 'auditLogs'),
      where('ownerId', '==', firebaseUser.uid),
      limit(200)
    );
    const unsubLogs = onSnapshot(
      logsQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as AuditLogEvent)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setPersistedLogs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    const intgQ = query(
      collection(db, 'integrations'),
      where('ownerId', '==', firebaseUser.uid),
      limit(50)
    );
    const unsubIntg = onSnapshot(
      intgQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as ApiIntegration)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setIntegrations(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'integrations')
    );

    return () => {
      unsubSessions();
      unsubLogs();
      unsubIntg();
    };
  }, [isUnlocked, firebaseUser]);

  // Auto-create initial session if user has none
  useEffect(() => {
    if (!isUnlocked || !firebaseUser || !profile) return;
    if (sessions.length === 0 && !activeSessionId) {
      const timer = window.setTimeout(() => {
        if (sessions.length === 0) {
          void handleCreateSession();
        }
      }, 600);
      return () => window.clearTimeout(timer);
    }
  }, [isUnlocked, firebaseUser, profile, sessions.length, activeSessionId, handleCreateSession]);

  // Subscribe to messages for the active session
  useEffect(() => {
    if (!isUnlocked || !firebaseUser || !activeSessionId) {
      setMessages([]);
      return;
    }

    const toMillis = (ts: { toMillis?: () => number } | null | undefined) =>
      ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now();

    const msgQ = query(
      collection(db, 'sessions', activeSessionId, 'messages'),
      where('ownerId', '==', firebaseUser.uid),
      limit(200)
    );
    const unsub = onSnapshot(
      msgQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as SessionMessage)
          .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setMessages(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `sessions/${activeSessionId}/messages`)
    );
    return () => unsub();
  }, [isUnlocked, firebaseUser, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // Handle incoming live Transponder events -> persist to Firestore + Web Notifications API
  const handleWsTransponderEvent = useCallback(
    (ev: TransponderEvent) => {
      void logAuditEvent(ev.type, ev.severity, ev.summary, {
        seq: ev.seq,
        sessionId: ev.sessionId,
        sid: ev.sid,
        pid: ev.pid || 'genesis',
        payloadSummary: JSON.stringify(ev.payload),
        blobHash: ev.blobs?.[0] || '—',
        prevHash: ev.prev,
        eventHash: ev.hash,
        latencyMs: ev.latencyMs,
      });

      if (
        ev.type === 'ROLLBACK_TRIGGERED' ||
        ev.type === 'ESCALATED' ||
        ev.type === 'EMERGENCY_ABORT' ||
        ev.type === 'SESSION_COMPLETED' ||
        ev.type === 'APPROVAL_CONFLICT_409'
      ) {
        sendBrowserNotification(`Vanguard SRE · ${ev.type}`, ev.summary, { tag: ev.type });
      }
    },
    [logAuditEvent]
  );

  const handleWsApprovalRequired = useCallback((prompt: ApprovalPrompt) => {
    sendBrowserNotification(
      'Vanguard SRE · Требуется Approval Gate',
      `${prompt.tool}: ${prompt.summary}`,
      { tag: prompt.effectId }
    );
  }, []);

  const handleWsChatComplete = useCallback(
    async (payload: { sessionId: string; runId: string; content: string; anchorSid: string }) => {
      if (!firebaseUser) return;
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        await setDoc(doc(db, 'sessions', payload.sessionId, 'messages', msgId), {
          id: msgId,
          sessionId: payload.sessionId,
          ownerId: firebaseUser.uid,
          role: 'assistant',
          content: payload.content.slice(0, 20000),
          stepSid: (payload.anchorSid || 'anchor').slice(0, 128),
          createdAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking message persistence
      }
    },
    [firebaseUser]
  );

  const ws = useWebSocket({
    enabled: isUnlocked,
    sessionId: activeSessionId,
    userId: firebaseUser?.uid || null,
    twoFactorRequired: Boolean(profile?.twoFactorEnabled),
    twoFactorToken,
    onTransponderEvent: handleWsTransponderEvent,
    onApprovalRequired: handleWsApprovalRequired,
    onChatComplete: handleWsChatComplete,
    onTwoFactorRejected: requireTwoFactorReauth,
  });

  // Sync live runtime counters back into active Firestore session doc
  useEffect(() => {
    if (!ws.sessionState || !activeSession || !firebaseUser) return;
    if (ws.sessionState.sessionId !== activeSession.id) return;
    if (activeSession.status === 'COMPLETED') return;

    const changed =
      activeSession.anchorSid !== ws.sessionState.anchorSid ||
      activeSession.totalSteps !== ws.sessionState.totalSteps ||
      activeSession.totalRollbacks !== ws.sessionState.totalRollbacks ||
      activeSession.constraintsCount !== ws.sessionState.constraints.length ||
      activeSession.status !== ws.sessionState.status;

    if (!changed) return;

    void updateDoc(doc(db, 'sessions', activeSession.id), {
      title: activeSession.title,
      status: ws.sessionState.status,
      anchorSid: ws.sessionState.anchorSid.slice(0, 128),
      totalSteps: ws.sessionState.totalSteps,
      totalRollbacks: ws.sessionState.totalRollbacks,
      constraintsCount: ws.sessionState.constraints.length,
      lastMessagePreview: activeSession.lastMessagePreview.slice(0, 300),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }, [ws.sessionState, activeSession, firebaseUser]);

  useEffect(() => {
    if (ws.status === 'connected' && settings) {
      ws.syncArbiterConfig(settings);
    }
  }, [ws.status, settings, ws.syncArbiterConfig]);

  const handleSendMessage = async (prompt: string) => {
    if (!firebaseUser || !activeSessionId) return;

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'sessions', activeSessionId, 'messages', msgId), {
        id: msgId,
        sessionId: activeSessionId,
        ownerId: firebaseUser.uid,
        role: 'user',
        content: prompt.slice(0, 20000),
        stepSid: 'prompt',
        createdAt: serverTimestamp(),
      });

      if (activeSession && activeSession.status !== 'COMPLETED') {
        const nextTitle = activeSession.title.startsWith('Сессия SRE #')
          ? prompt.slice(0, 64)
          : activeSession.title;
        await updateDoc(doc(db, 'sessions', activeSessionId), {
          title: nextTitle,
          status: activeSession.status,
          anchorSid: activeSession.anchorSid,
          totalSteps: activeSession.totalSteps,
          totalRollbacks: activeSession.totalRollbacks,
          constraintsCount: activeSession.constraintsCount,
          lastMessagePreview: prompt.slice(0, 280),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `sessions/${activeSessionId}/messages`);
    }

    ws.sendTask(activeSessionId, prompt, {
      provider: selectedProvider,
      model: selectedModel,
    });
  };

  const handleRetryPrompt = async (prompt: string) => {
    if (!activeSessionId || !prompt.trim()) return;
    ws.clearStreamError();
    ws.sendTask(activeSessionId, prompt, {
      provider: selectedProvider,
      model: selectedModel,
    });
  };

  const handleSwitchMode = (nextMode: ExecutionMode) => {
    ws.switchMode(nextMode);
    ws.clearStreamError();
    void refreshIntegrationsStatus();
  };

  const handleSwitchToMockDemoAndRetry = async (prompt?: string) => {
    ws.switchMode('MOCK_DEMO');
    ws.clearStreamError();
    void refreshIntegrationsStatus();
    if (prompt && activeSessionId) {
      window.setTimeout(() => {
        ws.sendTask(activeSessionId, prompt, { provider: 'mock_demo', model: 'deterministic-offline' });
      }, 150);
    }
  };

  const handleEmergencyAbort = async (reason: string) => {
    if (!activeSessionId) return;
    if (ws.status === 'connected') {
      ws.sendEmergencyAbort(activeSessionId, reason);
    } else {
      const resp = await fetch('/api/emergency-abort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          sessionId: activeSessionId,
          reason,
          source: 'web_ui',
        }),
      });
      if (resp.status === 403) {
        const errData = await resp.json().catch(() => ({}));
        requireTwoFactorReauth(errData.error || 'Требуется серверный маркер 2FA.');
      }
    }
  };

  const handleCompleteSession = async (session: AgentSession) => {
    try {
      await updateDoc(doc(db, 'sessions', session.id), {
        title: session.title,
        status: 'COMPLETED',
        anchorSid: session.anchorSid,
        totalSteps: session.totalSteps,
        totalRollbacks: session.totalRollbacks,
        constraintsCount: session.constraintsCount,
        lastMessagePreview: session.lastMessagePreview,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${session.id}`);
    }
  };

  const handleDeleteSession = async (session: AgentSession) => {
    try {
      await deleteDoc(doc(db, 'sessions', session.id));
      if (activeSessionId === session.id) {
        const remaining = sessions.filter((s) => s.id !== session.id);
        setActiveSessionId(remaining[0]?.id || null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sessions/${session.id}`);
    }
  };

  const handleProbeIntegration = async (item: ApiIntegration) => {
    try {
      const resp = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          baseUrl: item.baseUrl,
          healthPath: item.healthPath,
          authType: item.authType,
          authHeaderName: item.authHeaderName,
          timeoutMs: item.timeoutMs,
        }),
      });
      if (resp.status === 403) {
        const errData = await resp.json().catch(() => ({}));
        requireTwoFactorReauth(errData.error || 'Требуется подтверждённый серверный 2FA-токен.');
        return;
      }
      const data = await resp.json();
      const status: ApiIntegration['lastStatus'] =
        data.status === 'online' || data.status === 'degraded' || data.status === 'offline'
          ? data.status
          : 'offline';
      const latencyMs = Math.min(120000, Math.max(0, Number(data.latencyMs || 0)));

      await updateDoc(doc(db, 'integrations', item.id), {
        name: item.name,
        baseUrl: item.baseUrl,
        healthPath: item.healthPath,
        authType: item.authType,
        authHeaderName: item.authHeaderName,
        effectClass: item.effectClass,
        timeoutMs: item.timeoutMs,
        enabled: item.enabled,
        lastStatus: status,
        lastLatencyMs: latencyMs,
        updatedAt: serverTimestamp(),
      });

      await logAuditEvent(
        'API_HEALTH_CHECK',
        status === 'online' ? 'INFO' : 'HIGH',
        `Проверка сервиса "${item.name}": ${status.toUpperCase()} (${latencyMs} мс)`
      );
    } catch {
      // Non-fatal probe error handled silently
    }
  };

  if (loading || !isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex items-center justify-center text-sm text-slate-500 font-mono">
        Инициализация Vanguard SRE Control Plane...
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <AuthGate />;
  }

  if (profile.twoFactorEnabled && !twoFactorVerified) {
    return <TwoFactorGate />;
  }

  const activeSessionsCount = sessions.filter((s) => s.status === 'ACTIVE').length;
  const effectiveBridgeStatus = ws.bridgeStatus || integrationsStatus?.bridge || null;
  const topModeClass =
    ws.mode === 'LIVE_BRIDGE'
      ? 'text-emerald-600 dark:text-emerald-400'
      : ws.mode === 'AI_SANDBOX'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        wsStatus={ws.status}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activeSessionsCount={activeSessionsCount}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Contextual Top Bar */}
        <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Открыть меню"
              className="lg:hidden p-2 -ml-2 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Vanguard SRE
              </span>
              <span className="text-slate-400" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {SECTION_TITLES[activeSection]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-mono font-semibold whitespace-nowrap ${topModeClass}`}
            >
              <Radio className="w-3.5 h-3.5" />
              {ws.mode}
            </span>

            <button
              type="button"
              onClick={handleCreateSession}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Новая сессия
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 overflow-y-auto">
          {activeSection === 'chat' && (
            <ChatWorkspaceView
              profile={profile}
              activeSession={activeSession}
              messages={messages}
              sessionState={ws.sessionState}
              streamingText={ws.streamingText}
              isStreaming={ws.isStreaming}
              pendingApproval={ws.pendingApproval}
              approvalConflict={ws.approvalConflict}
              streamError={ws.streamError}
              wsConnected={ws.status === 'connected'}
              executionMode={ws.mode}
              bridgeStatus={effectiveBridgeStatus}
              llmProviders={integrationsStatus?.llmProviders || []}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onChangeLlm={(prov, mod) => {
                userPickedModelRef.current = true;
                setSelectedProvider(prov);
                setSelectedModel(mod);
              }}
              onSwitchMode={handleSwitchMode}
              onSendMessage={handleSendMessage}
              onRetryPrompt={handleRetryPrompt}
              onSwitchToMockDemoAndRetry={handleSwitchToMockDemoAndRetry}
              onCreateSession={handleCreateSession}
              onRespondApproval={ws.respondToApproval}
              onEmergencyAbort={handleEmergencyAbort}
              onClearApprovalConflict={ws.clearApprovalConflict}
            />
          )}

          {activeSection === 'dashboard' && (
            <DashboardView
              metrics={ws.metrics}
              integrations={integrations}
              firestoreOnline={firestoreOnline}
              executionMode={ws.mode}
              onProbeIntegration={handleProbeIntegration}
            />
          )}

          {activeSection === 'logs' && (
            <AuditLogView
              profile={profile}
              liveEvents={ws.liveEvents}
              persistedLogs={persistedLogs}
            />
          )}

          {activeSection === 'sessions' && (
            <SessionsView
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={(s) => {
                setActiveSessionId(s.id);
                setActiveSection('chat');
              }}
              onCreateSession={handleCreateSession}
              onCompleteSession={handleCompleteSession}
              onDeleteSession={handleDeleteSession}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              integrations={integrations}
              integrationsStatus={integrationsStatus}
              liveBridgeStatus={effectiveBridgeStatus}
              executionMode={ws.mode}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onChangeLlm={(prov, mod) => {
                userPickedModelRef.current = true;
                setSelectedProvider(prov);
                setSelectedModel(mod);
              }}
              onRefreshIntegrationsStatus={refreshIntegrationsStatus}
              onSwitchMode={handleSwitchMode}
              onSyncArbiterConfig={ws.syncArbiterConfig}
              onProbeIntegration={handleProbeIntegration}
              onLogAuditEvent={logAuditEvent}
            />
          )}

          {activeSection === 'profile' && <ProfileView onLogAuditEvent={logAuditEvent} />}

          {activeSection === 'admin' && <AdminPanelView onLogAuditEvent={logAuditEvent} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <VanguardShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
