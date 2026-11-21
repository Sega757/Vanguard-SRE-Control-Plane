import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApprovalConflictNotice,
  ApprovalDecisionPayload,
  ApprovalPrompt,
  ArbiterSettings,
  BridgeStatus,
  ChatStreamError,
  ExecutionMode,
  ServerMetricsSnapshot,
  SessionRuntimeState,
  TransponderEvent,
} from '../types';

export type WsConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface UseWebSocketOptions {
  enabled: boolean;
  sessionId: string | null;
  userId: string | null;
  twoFactorRequired: boolean;
  twoFactorToken: string | null;
  onTransponderEvent?: (ev: TransponderEvent) => void;
  onApprovalRequired?: (prompt: ApprovalPrompt) => void;
  onChatComplete?: (payload: {
    sessionId: string;
    runId: string;
    content: string;
    anchorSid: string;
  }) => void;
  onChatError?: (payload: {
    sessionId: string;
    error: string;
    code?: string;
    canSwitchToMockDemo?: boolean;
    retryPrompt?: string;
  }) => void;
  onTwoFactorRejected?: (reason: string) => void;
}

export function useWebSocket({
  enabled,
  sessionId,
  userId,
  twoFactorRequired,
  twoFactorToken,
  onTransponderEvent,
  onApprovalRequired,
  onChatComplete,
  onChatError,
  onTwoFactorRejected,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<WsConnectionStatus>('disconnected');
  const [mode, setMode] = useState<ExecutionMode>('AI_SANDBOX');
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [sessionState, setSessionState] = useState<SessionRuntimeState | null>(null);
  const [liveEvents, setLiveEvents] = useState<TransponderEvent[]>([]);
  const [metrics, setMetrics] = useState<ServerMetricsSnapshot | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalPrompt | null>(null);
  const [approvalConflict, setApprovalConflict] = useState<ApprovalConflictNotice | null>(null);
  const [streamError, setStreamError] = useState<ChatStreamError | null>(null);

  const onEventRef = useRef(onTransponderEvent);
  const onApprovalRef = useRef(onApprovalRequired);
  const onCompleteRef = useRef(onChatComplete);
  const onErrorRef = useRef(onChatError);
  const onTwoFactorRejectedRef = useRef(onTwoFactorRejected);
  const activeSessionRef = useRef(sessionId);
  const authRef = useRef({ userId, twoFactorRequired, twoFactorToken });

  useEffect(() => {
    onEventRef.current = onTransponderEvent;
    onApprovalRef.current = onApprovalRequired;
    onCompleteRef.current = onChatComplete;
    onErrorRef.current = onChatError;
    onTwoFactorRejectedRef.current = onTwoFactorRejected;
  }, [
    onTransponderEvent,
    onApprovalRequired,
    onChatComplete,
    onChatError,
    onTwoFactorRejected,
  ]);

  useEffect(() => {
    authRef.current = { userId, twoFactorRequired, twoFactorToken };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'auth:handshake',
          payload: { userId, twoFactorRequired, twoFactorToken },
        })
      );
    }
  }, [userId, twoFactorRequired, twoFactorToken]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      wsRef.current.send(
        JSON.stringify({
          type: 'session:join',
          payload: {
            sessionId,
            userId: authRef.current.userId,
            twoFactorRequired: authRef.current.twoFactorRequired,
            twoFactorToken: authRef.current.twoFactorToken || undefined,
          },
        })
      );
      setStreamingText('');
      setIsStreaming(false);
      setPendingApproval(null);
      setApprovalConflict(null);
      setStreamError(null);
    }
  }, [sessionId]);

  const sendJson = useCallback((type: string, payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);

  const canConnect = enabled && Boolean(userId);

  useEffect(() => {
    if (!canConnect) {
      setStatus('disconnected');
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      setStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // If effect already cleaned up while socket was CONNECTING, close cleanly now
        // without triggering Chromium's "closed before connection is established" warning
        if (cancelled) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        setStatus('connected');

        ws.send(
          JSON.stringify({
            type: 'auth:handshake',
            payload: {
              userId: authRef.current.userId,
              twoFactorRequired: authRef.current.twoFactorRequired,
              twoFactorToken: authRef.current.twoFactorToken || undefined,
            },
          })
        );

        if (activeSessionRef.current) {
          ws.send(
            JSON.stringify({
              type: 'session:join',
              payload: {
                sessionId: activeSessionRef.current,
                userId: authRef.current.userId,
                twoFactorRequired: authRef.current.twoFactorRequired,
                twoFactorToken: authRef.current.twoFactorToken || undefined,
              },
            })
          );
        }
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: { type?: string; payload?: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'ws:connected': {
            const p = msg.payload as {
              mode?: ExecutionMode;
              bridge?: BridgeStatus;
              metrics?: ServerMetricsSnapshot;
              recentEvents?: TransponderEvent[];
            };
            if (p.mode) setMode(p.mode);
            if (p.bridge) setBridgeStatus(p.bridge);
            if (p.metrics) setMetrics(p.metrics);
            if (Array.isArray(p.recentEvents)) {
              const deduped: TransponderEvent[] = [];
              for (const ev of p.recentEvents) {
                if (!seenEventIdsRef.current.has(ev.id)) {
                  seenEventIdsRef.current.add(ev.id);
                  deduped.push(ev);
                }
              }
              if (deduped.length > 0) {
                setLiveEvents((prev) => [...deduped, ...prev].slice(0, 200));
              }
            }
            break;
          }
          case 'mode:updated': {
            const p = msg.payload as { mode: ExecutionMode; bridge?: BridgeStatus };
            if (p.mode) setMode(p.mode);
            if (p.bridge) setBridgeStatus(p.bridge);
            break;
          }
          case 'metrics:update': {
            setMetrics(msg.payload as ServerMetricsSnapshot);
            break;
          }
          case 'session:state': {
            const st = msg.payload as SessionRuntimeState;
            if (st.sessionId === activeSessionRef.current) {
              setSessionState(st);
              setPendingApproval(st.pendingApproval ?? null);
              if (st.mode) setMode(st.mode);
            }
            break;
          }
          case 'transponder:event': {
            const ev = msg.payload as TransponderEvent;
            if (!seenEventIdsRef.current.has(ev.id)) {
              seenEventIdsRef.current.add(ev.id);
              setLiveEvents((prev) => [ev, ...prev].slice(0, 200));
              onEventRef.current?.(ev);
            }
            break;
          }
          case 'approval:required': {
            const prompt = msg.payload as ApprovalPrompt;
            setApprovalConflict(null);
            if (prompt.sessionId === activeSessionRef.current) {
              setPendingApproval(prompt);
            }
            onApprovalRef.current?.(prompt);
            break;
          }
          case 'approval:conflict': {
            const p = msg.payload as { statusCode?: number; code?: string; error?: string };
            setApprovalConflict({
              statusCode: p.statusCode || 409,
              code: p.code,
              error:
                p.error ||
                '409 Conflict: эффект уже обработан или состояние якоря изменилось (защита TOCTOU).',
              at: new Date().toLocaleTimeString('ru-RU'),
            });
            setPendingApproval(null);
            break;
          }
          case 'auth:2fa_required': {
            const p = msg.payload as { error?: string };
            const reason =
              p.error || 'Сервер отклонил команду: требуется подтверждение 2FA-сессии.';
            setStreamError({ message: reason, code: 'TWO_FACTOR_REQUIRED' });
            setIsStreaming(false);
            onTwoFactorRejectedRef.current?.(reason);
            break;
          }
          case 'chat:stream_start': {
            const p = msg.payload as { sessionId: string };
            if (p.sessionId === activeSessionRef.current) {
              setStreamingText('');
              setStreamError(null);
              setApprovalConflict(null);
              setIsStreaming(true);
            }
            break;
          }
          case 'chat:token': {
            const p = msg.payload as { sessionId: string; token: string };
            if (p.sessionId === activeSessionRef.current) {
              setStreamingText((prev) => prev + p.token);
            }
            break;
          }
          case 'chat:complete': {
            const p = msg.payload as {
              sessionId: string;
              runId: string;
              content: string;
              anchorSid: string;
            };
            if (p.sessionId === activeSessionRef.current) {
              setIsStreaming(false);
              setStreamingText('');
              setPendingApproval(null);
            }
            onCompleteRef.current?.(p);
            break;
          }
          case 'chat:error': {
            const p = msg.payload as {
              sessionId?: string;
              error: string;
              code?: string;
              canSwitchToMockDemo?: boolean;
              retryPrompt?: string;
            };
            if (!p.sessionId || p.sessionId === activeSessionRef.current) {
              setIsStreaming(false);
              setPendingApproval(null);
              setStreamError({
                message: p.error,
                code: p.code,
                canSwitchToMockDemo: p.canSwitchToMockDemo,
                retryPrompt: p.retryPrompt,
              });
            }
            onErrorRef.current?.({
              sessionId: p.sessionId || activeSessionRef.current || '',
              error: p.error,
              code: p.code,
              canSwitchToMockDemo: p.canSwitchToMockDemo,
              retryPrompt: p.retryPrompt,
            });
            break;
          }
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus('reconnecting');
        const delay = Math.min(8000, 800 * Math.pow(1.6, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will trigger clean exponential backoff reconnect
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const socket = wsRef.current;
        wsRef.current = null;
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      }
    };
  }, [canConnect]);

  const sendTask = useCallback(
    (targetSessionId: string, prompt: string, opts?: { provider?: string; model?: string }) => {
      setStreamError(null);
      setApprovalConflict(null);
      return sendJson('agent:task', {
        sessionId: targetSessionId,
        prompt,
        provider: opts?.provider,
        model: opts?.model,
      });
    },
    [sendJson]
  );

  const respondToApproval = useCallback(
    (decision: ApprovalDecisionPayload) => {
      setPendingApproval(null);
      return sendJson('approval:response', {
        effectId: decision.effectId,
        idempotencyKey: decision.idempotencyKey,
        expectedAnchorHash: decision.expectedAnchorHash,
        decision: decision.decision,
      });
    },
    [sendJson]
  );

  const sendEmergencyAbort = useCallback(
    (targetSessionId: string, reason?: string) => {
      setPendingApproval(null);
      setIsStreaming(false);
      return sendJson('emergency:abort', {
        sessionId: targetSessionId,
        reason: reason || 'Аварийная остановка оператором (Web UI)',
      });
    },
    [sendJson]
  );

  const switchMode = useCallback(
    (nextMode: ExecutionMode) => {
      return sendJson('mode:switch', { mode: nextMode });
    },
    [sendJson]
  );

  const syncArbiterConfig = useCallback(
    (config: Partial<ArbiterSettings>) => {
      return sendJson('config:update', config as Record<string, unknown>);
    },
    [sendJson]
  );

  const clearApprovalConflict = useCallback(() => {
    setApprovalConflict(null);
  }, []);

  const clearStreamError = useCallback(() => {
    setStreamError(null);
  }, []);

  return {
    status,
    mode,
    bridgeStatus,
    sessionState,
    liveEvents,
    metrics,
    streamingText,
    isStreaming,
    pendingApproval,
    approvalConflict,
    streamError,
    sendTask,
    respondToApproval,
    sendEmergencyAbort,
    switchMode,
    syncArbiterConfig,
    clearApprovalConflict,
    clearStreamError,
  };
}
