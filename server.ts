import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import {
  generateTotpSetup,
  isEphemeralTwoFactorSecret,
  isServerTwoFactorEnforced,
  issueTwoFactorSessionToken,
  revokeTwoFactorSessionToken,
  setServerTwoFactorEnforcement,
  verifyTotpCode,
  verifyTwoFactorSessionToken,
} from './server/totp.ts';
import {
  isEphemeralTransponderSecret,
  VanguardRuntime,
  type TransponderEvent,
} from './server/sreEngine.ts';
import {
  ApprovalDecisionPacketSchema,
  ArbiterPolicyPacketSchema,
  BridgePayloadSchema,
  EmergencyAbortPacketSchema,
  ExecutionModeSchema,
  SeveritySchema,
  verifyBridgeEnvelope,
  WsClientMessageSchema,
} from './server/protocolSchema.ts';
import { AiSandboxError, getLlmProvidersStatus, probeLlmRouter } from './server/llmRouter.ts';
import {
  getGithubIntegrationStatus,
  getGithubOverview,
  testGithubConnection,
} from './server/githubBridge.ts';
import { TelegramBridge } from './server/telegramBridge.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string | null;
  userId: string | null;
  twoFactorRequired: boolean;
  twoFactorToken: string | null;
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === 'metadata.google.internal' ||
    lower.startsWith('169.254.') ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.')
  );
}

// Server-side 2FA enforcement middleware for mutating REST endpoints
function requireServerTwoFactor(req: Request, res: Response, next: NextFunction): void {
  const uid = String(req.header('x-vanguard-uid') || req.body?.uid || '').trim();
  const headerRequires2fa = req.header('x-vanguard-2fa-required') === 'true';
  const serverEnforced = isServerTwoFactorEnforced(uid);

  if (headerRequires2fa || serverEnforced) {
    const token = req.header('x-vanguard-2fa-token') || undefined;
    const check = verifyTwoFactorSessionToken(token, uid || undefined);
    if (!check.valid) {
      res.status(403).json({
        error: check.reason || 'Требуется серверный маркер подтверждённой 2FA-сессии.',
        code: 'TWO_FACTOR_REQUIRED',
      });
      return;
    }
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const runtime = new VanguardRuntime();
  const telegram = new TelegramBridge();
  const clients = new Set<ConnectedClient>();

  function safeSend(ws: WebSocket, data: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function broadcastAll(data: unknown) {
    for (const c of clients) {
      safeSend(c.ws, data);
    }
  }

  function broadcastMetrics() {
    broadcastAll({ type: 'metrics:update', payload: runtime.getMetricsSnapshot(clients.size) });
  }

  function broadcastToSession(sessionId: string, data: unknown) {
    for (const c of clients) {
      if (c.sessionId === sessionId) {
        safeSend(c.ws, data);
      }
    }
  }

  function emitAndBroadcastEvent(ev: TransponderEvent) {
    broadcastAll({ type: 'transponder:event', payload: ev });
    void telegram.notifyEvent(ev);
  }

  // Bind Two-Way Telegram Inline Buttons to shared TOCTOU-protected Arbiter handler
  telegram.bindHandlers(
    async ({ effectId, idempotencyKey, expectedAnchorHash, decision, username }) => {
      const outcome = runtime.decideApproval({
        effectId,
        idempotencyKey,
        expectedAnchorHash,
        decision,
        source: 'telegram_operator',
        actor: `@${username}`,
      });

      if (outcome.event) {
        emitAndBroadcastEvent(outcome.event);
      }

      if (outcome.ok && outcome.sessionId) {
        const st = runtime.getOrCreateSession(outcome.sessionId);
        broadcastToSession(outcome.sessionId, { type: 'session:state', payload: st });
        if (decision === 'EMERGENCY_ABORT') {
          const aborted = runtime.executeEmergencyAbort(
            outcome.sessionId,
            `Аварийная остановка из Telegram (@${username})`,
            'telegram_operator',
            `@${username}`
          );
          aborted.events.forEach(emitAndBroadcastEvent);
          broadcastToSession(outcome.sessionId, { type: 'session:state', payload: aborted.state });
        }
        broadcastMetrics();
      }

      return {
        ok: outcome.ok,
        statusCode: outcome.statusCode,
        message: outcome.message,
      };
    },
    (chatId, action) => {
      const ev = runtime.emitSystemSecurityEvent(
        'system_security',
        'TELEGRAM_UNAUTHORIZED_CHAT',
        'CRITICAL',
        `Попытка неавторизованного управления из Telegram chat_id=${chatId} (${action})`,
        { chatId, action },
        'telegram_operator'
      );
      emitAndBroadcastEvent(ev);
    }
  );

  // Start Telegram long-polling automatically when env vars are set
  if (telegram.isConfigured()) {
    telegram.startPolling();
  }

  // ============================================================
  // REST API Endpoints
  // ============================================================

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'vanguard-sre-control-plane',
      mode: runtime.getMode(),
      uptimeSec: Math.round(process.uptime()),
      wsClients: clients.size,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      ephemeralSecrets: isEphemeralTransponderSecret() || isEphemeralTwoFactorSecret(),
    });
  });

  app.get('/api/metrics/snapshot', (_req, res) => {
    res.json(runtime.getMetricsSnapshot(clients.size));
  });

  // Zero Secrets in Firestore/Client: returns ONLY booleans & masked last 4 chars
  app.get('/api/system/integrations-status', (_req, res) => {
    const transponderEphemeral = isEphemeralTransponderSecret();
    const twoFactorEphemeral = isEphemeralTwoFactorSecret();
    res.json({
      mode: runtime.getMode(),
      ephemeralSecrets: transponderEphemeral || twoFactorEphemeral,
      ephemeralSecretDetails: {
        transponder: transponderEphemeral,
        twoFactorSession: twoFactorEphemeral,
      },
      bridge: runtime.getBridgeStatus(),
      llmProviders: getLlmProvidersStatus(),
      github: getGithubIntegrationStatus(),
      telegram: telegram.getStatus(),
      checkedAt: new Date().toISOString(),
    });
  });

  // Authorized download of reference Python Bridge Agent
  app.get('/api/bridge/agent-script', requireServerTwoFactor, (req, res) => {
    const uid = String(req.header('x-vanguard-uid') || '').trim();
    const role = String(req.header('x-vanguard-role') || '').trim().toLowerCase();
    if (!uid || (role !== 'admin' && role !== 'operator')) {
      res.status(403).json({
        ok: false,
        error: 'Скачивание скрипта Python Bridge доступно только авторизованным администраторам и операторам.',
      });
      return;
    }

    const scriptPath = path.resolve(__dirname, 'vanguard_bridge_agent.py');
    if (!fs.existsSync(scriptPath)) {
      res.status(404).json({ ok: false, error: 'Файл vanguard_bridge_agent.py не найден на сервере.' });
      return;
    }

    const content = fs.readFileSync(scriptPath, 'utf8');
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vanguard_bridge_agent.py"');
    res.send(content);
  });

  app.post('/api/system/test-github', requireServerTwoFactor, async (_req, res) => {
    const result = await testGithubConnection();
    res.json(result);
  });

  app.post('/api/system/test-telegram', requireServerTwoFactor, async (_req, res) => {
    const result = await telegram.testConnection();
    res.json(result);
  });

  app.post('/api/system/test-llm', requireServerTwoFactor, async (req, res) => {
    const provider = req.body?.provider ? String(req.body.provider) : undefined;
    const model = req.body?.model ? String(req.body.model) : undefined;
    const result = await probeLlmRouter(provider, model);
    res.json(result);
  });

  app.post('/api/system/test-bridge', requireServerTwoFactor, async (_req, res) => {
    const result = await runtime.pingExternalBridge();
    res.json(result);
  });

  app.post('/api/system/telegram-filter', requireServerTwoFactor, (req, res) => {
    const minSeverityRaw = req.body?.minSeverity;
    const enabledRaw = req.body?.enabledNotifications;
    const sevParsed = minSeverityRaw ? SeveritySchema.safeParse(minSeverityRaw) : null;
    const updated = telegram.updateFilter({
      minSeverity: sevParsed?.success ? sevParsed.data : undefined,
      enabledNotifications: typeof enabledRaw === 'boolean' ? enabledRaw : undefined,
    });
    res.json(updated);
  });

  // Hardened Telegram Webhook endpoint (requires TELEGRAM_WEBHOOK_SECRET + timingSafeEqual header check)
  app.post('/api/telegram/webhook', async (req, res) => {
    const secretCheck = telegram.verifyWebhookSecret(req.header('x-telegram-bot-api-secret-token'));
    if (!secretCheck.ok) {
      const ev = runtime.emitSystemSecurityEvent(
        'system_security',
        'TELEGRAM_WEBHOOK_REJECTED',
        secretCheck.statusCode === 403 ? 'CRITICAL' : 'MEDIUM',
        `Отклонён запрос к /api/telegram/webhook (HTTP ${secretCheck.statusCode}): ${secretCheck.error}`,
        { statusCode: secretCheck.statusCode, reason: secretCheck.error },
        'telegram_operator'
      );
      emitAndBroadcastEvent(ev);
      res.status(secretCheck.statusCode).json({ ok: false, error: secretCheck.error });
      return;
    }

    try {
      if (req.body && typeof req.body === 'object') {
        await telegram.handleUpdate(req.body as Record<string, unknown>);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Webhook error' });
    }
  });

  // GitHub Server-Side Proxy Overview
  app.get('/api/github/overview', async (req, res) => {
    const repoOverride = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const overview = await getGithubOverview(repoOverride);
    res.json(overview);
  });

  // Execution Plane Mode Switcher (MOCK_DEMO | AI_SANDBOX | LIVE_BRIDGE)
  app.post('/api/mode', requireServerTwoFactor, (req, res) => {
    const parsed = ExecutionModeSchema.safeParse(req.body?.mode);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Недопустимый режим. Ожидается MOCK_DEMO, AI_SANDBOX или LIVE_BRIDGE.',
      });
      return;
    }
    const result = runtime.setMode(parsed.data);
    if (!result.ok) {
      res.status(409).json(result);
      return;
    }
    const ev = runtime.emitSystemSecurityEvent(
      'system_control',
      'EXECUTION_MODE_SWITCHED',
      'MEDIUM',
      `Режим Execution Plane переключён на ${result.mode}`,
      { mode: result.mode },
      'web_ui'
    );
    emitAndBroadcastEvent(ev);
    broadcastAll({ type: 'mode:updated', payload: { mode: result.mode, bridge: runtime.getBridgeStatus() } });
    broadcastMetrics();
    res.json(result);
  });

  // TOCTOU-protected Approval Gate REST Endpoint
  app.post('/api/approval/decide', requireServerTwoFactor, (req, res) => {
    const parsed = ApprovalDecisionPacketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: `Невалидный пакет решения: ${parsed.error.issues[0]?.message}`,
      });
      return;
    }

    const outcome = runtime.decideApproval({
      effectId: parsed.data.effectId,
      idempotencyKey: parsed.data.idempotencyKey,
      expectedAnchorHash: parsed.data.expectedAnchorHash,
      decision: parsed.data.decision,
      source: parsed.data.source,
      actor: parsed.data.actor || String(req.header('x-vanguard-uid') || 'web_operator'),
    });

    if (outcome.event) {
      emitAndBroadcastEvent(outcome.event);
    }

    if (outcome.ok && outcome.sessionId) {
      const st = runtime.getOrCreateSession(outcome.sessionId);
      broadcastToSession(outcome.sessionId, { type: 'session:state', payload: st });
      broadcastMetrics();
    }

    res.status(outcome.statusCode).json(outcome);
  });

  // Emergency Abort + SIGKILL + 3-Layer Rollback REST Endpoint
  app.post('/api/emergency-abort', requireServerTwoFactor, (req, res) => {
    const parsed = EmergencyAbortPacketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Некорректные параметры аварийной остановки.' });
      return;
    }
    const result = runtime.executeEmergencyAbort(
      parsed.data.sessionId,
      parsed.data.reason,
      parsed.data.source,
      parsed.data.actor || String(req.header('x-vanguard-uid') || 'web_operator')
    );
    result.events.forEach(emitAndBroadcastEvent);
    broadcastToSession(parsed.data.sessionId, { type: 'session:state', payload: result.state });
    broadcastMetrics();
    res.json({ ok: true, state: result.state, eventsCount: result.events.length });
  });

  // Server-Side HMAC Chain Verification
  app.post('/api/audit/verify-chain', (_req, res) => {
    const report = runtime.verifyHmacChain();
    res.json(report);
  });

  // Server-Side RBAC Audit Gate (validates 2FA token before admin mutates Firestore roles)
  app.post('/api/rbac/authorize', requireServerTwoFactor, (req, res) => {
    const actor = String(req.header('x-vanguard-uid') || 'admin');
    const targetEmail = String(req.body?.targetEmail || '');
    const action = String(req.body?.action || 'RBAC_UPDATE');
    const ev = runtime.emitSystemSecurityEvent(
      'system_rbac',
      'RBAC_SERVER_AUTHORIZED',
      'HIGH',
      `Сервер подтвердил 2FA-сессию для RBAC-операции (${action}) над ${targetEmail}`,
      { actor, targetEmail, action },
      'web_ui'
    );
    emitAndBroadcastEvent(ev);
    res.json({ ok: true });
  });

  // --- Server-Side 2FA Endpoints ---
  app.post('/api/2fa/status', (req, res) => {
    const uid = String(req.body?.uid || '').trim();
    const enabled = Boolean(req.body?.enabled);
    if (uid) {
      setServerTwoFactorEnforcement(uid, enabled);
    }
    res.json({ ok: true, enforced: isServerTwoFactorEnforced(uid) });
  });

  app.post('/api/2fa/generate', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'Требуется корректный email для генерации TOTP.' });
        return;
      }
      const setup = await generateTotpSetup(email);
      res.json(setup);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка генерации 2FA' });
    }
  });

  app.post('/api/2fa/verify', (req, res) => {
    const uid = String(req.body?.uid || '').trim();
    const secret = String(req.body?.secret || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();
    const backupCodes: string[] = Array.isArray(req.body?.backupCodes) ? req.body.backupCodes : [];

    if (!code) {
      res.status(400).json({ valid: false, error: 'Введите код подтверждения.' });
      return;
    }

    if (secret && verifyTotpCode(secret, code, 1)) {
      if (uid) setServerTwoFactorEnforcement(uid, true);
      const issued = uid ? issueTwoFactorSessionToken(uid, 3600) : null;
      res.json({
        valid: true,
        method: 'totp',
        twoFactorToken: issued?.token || null,
        expiresAt: issued?.expiresAt || null,
      });
      return;
    }

    const matchedBackup = backupCodes.find((b) => b.toUpperCase() === code);
    if (matchedBackup) {
      if (uid) setServerTwoFactorEnforcement(uid, true);
      const issued = uid ? issueTwoFactorSessionToken(uid, 3600) : null;
      res.json({
        valid: true,
        method: 'backup',
        consumedCode: matchedBackup,
        twoFactorToken: issued?.token || null,
        expiresAt: issued?.expiresAt || null,
      });
      return;
    }

    res.json({ valid: false, error: 'Неверный 6-значный код TOTP или резервный код.' });
  });

  app.post('/api/2fa/logout', (req, res) => {
    const token = req.header('x-vanguard-2fa-token') || undefined;
    revokeTwoFactorSessionToken(token);
    res.json({ ok: true });
  });

  // External Custom API Health Probe (no client secrets persisted)
  app.post('/api/integrations/test', requireServerTwoFactor, async (req, res) => {
    const baseUrl = String(req.body?.baseUrl || '').trim();
    const healthPath = String(req.body?.healthPath || '').trim();
    const authType = String(req.body?.authType || 'none');
    const authHeaderName = String(req.body?.authHeaderName || 'Authorization').trim();
    const timeoutMs = Math.min(15000, Math.max(1000, Number(req.body?.timeoutMs || 5000)));

    let targetUrl: URL;
    try {
      const joined = healthPath
        ? `${baseUrl.replace(/\/+$/, '')}/${healthPath.replace(/^\/+/, '')}`
        : baseUrl;
      targetUrl = new URL(joined);
      if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
        res.status(400).json({ status: 'offline', error: 'Разрешены только протоколы HTTP и HTTPS.' });
        return;
      }
      if (isPrivateOrBlockedHost(targetUrl.hostname)) {
        res.status(400).json({
          status: 'offline',
          error: 'Запросы к локальным/внутренним адресам заблокированы политикой безопасности.',
        });
        return;
      }
    } catch {
      res.status(400).json({ status: 'offline', error: 'Некорректный URL внешнего сервиса.' });
      return;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Vanguard-SRE-HealthProbe/2.1',
      Accept: 'application/json, text/plain, */*',
    };
    if (authType === 'bearer' && process.env.CUSTOM_API_BEARER_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.CUSTOM_API_BEARER_TOKEN}`;
    } else if (authType === 'api_key' && process.env.CUSTOM_API_KEY) {
      headers[authHeaderName || 'X-API-Key'] = process.env.CUSTOM_API_KEY;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - t0;
      clearTimeout(timer);
      const status = response.ok ? 'online' : response.status < 500 ? 'degraded' : 'offline';
      res.json({
        status,
        httpStatus: response.status,
        latencyMs,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      clearTimeout(timer);
      res.json({
        status: 'offline',
        httpStatus: 0,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : 'Таймаут или сетевая ошибка',
        checkedAt: new Date().toISOString(),
      });
    }
  });

  // ============================================================
  // Vite / Static Frontend
  // ============================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ============================================================
  // HTTP Server + Dual WebSocket Upgrade (/ws & /ws/bridge)
  // ============================================================
  const server = http.createServer(app);
  const clientWss = new WebSocketServer({ noServer: true });
  const bridgeWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws') {
      clientWss.handleUpgrade(request, socket, head, (ws) => {
        clientWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/bridge') {
      bridgeWss.handleUpgrade(request, socket, head, (ws) => {
        bridgeWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  function checkWsTwoFactor(client: ConnectedClient, actionName: string): boolean {
    const enforced =
      client.twoFactorRequired || (client.userId ? isServerTwoFactorEnforced(client.userId) : false);
    if (!enforced) return true;
    const check = verifyTwoFactorSessionToken(client.twoFactorToken || undefined, client.userId || undefined);
    if (!check.valid) {
      safeSend(client.ws, {
        type: 'auth:2fa_required',
        payload: {
          action: actionName,
          error: check.reason || 'Команда отклонена: требуется подтверждённый серверный 2FA-токен.',
        },
      });
      return false;
    }
    return true;
  }

  // --- Client WebSocket (/ws) ---
  clientWss.on('connection', (ws) => {
    const client: ConnectedClient = {
      ws,
      sessionId: null,
      userId: null,
      twoFactorRequired: false,
      twoFactorToken: null,
    };
    clients.add(client);

    safeSend(ws, {
      type: 'ws:connected',
      payload: {
        connectedAt: new Date().toISOString(),
        mode: runtime.getMode(),
        bridge: runtime.getBridgeStatus(),
        metrics: runtime.getMetricsSnapshot(clients.size),
        recentEvents: runtime.getRecentEvents().slice(0, 50),
        config: runtime.getConfig(),
      },
    });
    broadcastMetrics();

    ws.on('message', async (raw) => {
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      const envelope = WsClientMessageSchema.safeParse(parsedRaw);
      if (!envelope.success) {
        safeSend(ws, {
          type: 'chat:error',
          payload: { error: `Некорректная команда WebSocket: ${envelope.error.issues[0]?.message}` },
        });
        return;
      }

      const { type, payload } = envelope.data;

      if (type === 'auth:handshake') {
        client.userId = payload.userId ? String(payload.userId) : client.userId;
        client.twoFactorRequired = Boolean(payload.twoFactorRequired);
        client.twoFactorToken = payload.twoFactorToken ? String(payload.twoFactorToken) : null;
        if (client.userId) {
          setServerTwoFactorEnforcement(client.userId, client.twoFactorRequired);
        }
        return;
      }

      if (type === 'session:join') {
        const sessionId = String(payload.sessionId || 'session_default');
        client.sessionId = sessionId;
        if (payload.userId) client.userId = String(payload.userId);
        if (typeof payload.twoFactorRequired === 'boolean') {
          client.twoFactorRequired = payload.twoFactorRequired;
        }
        if (typeof payload.twoFactorToken === 'string') {
          client.twoFactorToken = payload.twoFactorToken;
        }
        const sessionState = runtime.getOrCreateSession(sessionId);
        safeSend(ws, { type: 'session:state', payload: sessionState });
        return;
      }

      if (type === 'config:update') {
        if (!checkWsTwoFactor(client, 'config:update')) return;
        const parsedPolicy = ArbiterPolicyPacketSchema.safeParse(payload);
        if (!parsedPolicy.success) return;
        const updated = runtime.updateConfig(parsedPolicy.data);
        safeSend(ws, { type: 'config:updated', payload: updated });
        return;
      }

      if (type === 'mode:switch') {
        if (!checkWsTwoFactor(client, 'mode:switch')) return;
        const modeParsed = ExecutionModeSchema.safeParse(payload.mode);
        if (!modeParsed.success) return;
        const result = runtime.setMode(modeParsed.data);
        if (!result.ok) {
          safeSend(ws, { type: 'chat:error', payload: { error: result.message } });
          return;
        }
        broadcastAll({ type: 'mode:updated', payload: { mode: result.mode, bridge: runtime.getBridgeStatus() } });
        broadcastMetrics();
        return;
      }

      if (type === 'approval:response') {
        if (!checkWsTwoFactor(client, 'approval:response')) return;
        const parsedDecision = ApprovalDecisionPacketSchema.safeParse({
          effectId: payload.effectId || payload.approvalId,
          idempotencyKey: payload.idempotencyKey,
          expectedAnchorHash: payload.expectedAnchorHash,
          decision: payload.decision || (payload.approved === true ? 'APPROVE' : 'REJECT'),
          source: 'web_ui',
          actor: client.userId || 'web_operator',
        });

        if (!parsedDecision.success) {
          safeSend(ws, {
            type: 'approval:conflict',
            payload: { statusCode: 400, error: parsedDecision.error.issues[0]?.message },
          });
          return;
        }

        const outcome = runtime.decideApproval({
          effectId: parsedDecision.data.effectId,
          idempotencyKey: parsedDecision.data.idempotencyKey,
          expectedAnchorHash: parsedDecision.data.expectedAnchorHash,
          decision: parsedDecision.data.decision,
          source: 'web_ui',
          actor: parsedDecision.data.actor || 'web_operator',
        });

        if (outcome.event) {
          emitAndBroadcastEvent(outcome.event);
        }

        if (!outcome.ok) {
          safeSend(ws, {
            type: 'approval:conflict',
            payload: { statusCode: outcome.statusCode, code: outcome.code, error: outcome.message },
          });
          return;
        }

        if (outcome.sessionId) {
          const st = runtime.getOrCreateSession(outcome.sessionId);
          broadcastToSession(outcome.sessionId, { type: 'session:state', payload: st });
          broadcastMetrics();
        }
        return;
      }

      if (type === 'emergency:abort') {
        if (!checkWsTwoFactor(client, 'emergency:abort')) return;
        const sessionId = String(payload.sessionId || client.sessionId || 'session_default');
        const reason = String(payload.reason || 'Аварийная остановка оператором (Web UI)');
        const result = runtime.executeEmergencyAbort(
          sessionId,
          reason,
          'web_ui',
          client.userId || 'web_operator'
        );
        result.events.forEach(emitAndBroadcastEvent);
        broadcastToSession(sessionId, { type: 'session:state', payload: result.state });
        broadcastToSession(sessionId, {
          type: 'chat:error',
          payload: {
            sessionId,
            error: `EMERGENCY ABORT выполнен: процессы остановлены, выполнен 3-слойный откат к якорю ${result.state.anchorSid}.`,
          },
        });
        broadcastMetrics();
        return;
      }

      if (type === 'agent:task') {
        if (!checkWsTwoFactor(client, 'agent:task')) return;
        const sessionId = String(payload.sessionId || client.sessionId || 'session_default');
        const prompt = String(payload.prompt || '').trim();
        const provider = payload.provider ? String(payload.provider) : undefined;
        const model = payload.model ? String(payload.model) : undefined;
        client.sessionId = sessionId;

        if (!prompt) {
          safeSend(ws, { type: 'chat:error', payload: { sessionId, error: 'Пустой текст задачи.' } });
          return;
        }

        const runId = `run_${Date.now()}`;
        broadcastToSession(sessionId, { type: 'chat:stream_start', payload: { sessionId, runId } });

        try {
          await runtime.executeTaskStream(
            sessionId,
            prompt,
            clients.size,
            { provider, model, actor: client.userId || 'web_operator' },
            {
              onEvent: (ev) => {
                emitAndBroadcastEvent(ev);
              },
              onState: (state) => {
                broadcastToSession(sessionId, { type: 'session:state', payload: state });
              },
              onApprovalRequired: (approvalPrompt) => {
                broadcastToSession(sessionId, { type: 'approval:required', payload: approvalPrompt });
                void telegram.sendApprovalGate(approvalPrompt);
              },
              onChatToken: (token) => {
                broadcastToSession(sessionId, { type: 'chat:token', payload: { sessionId, runId, token } });
              },
              onChatComplete: (fullText, anchorSid) => {
                broadcastToSession(sessionId, {
                  type: 'chat:complete',
                  payload: { sessionId, runId, content: fullText, anchorSid },
                });
              },
              onMetrics: () => {
                broadcastMetrics();
              },
            }
          );
        } catch (err) {
          if (err instanceof AiSandboxError) {
            broadcastToSession(sessionId, {
              type: 'chat:error',
              payload: {
                sessionId,
                runId,
                error: err.message,
                code: err.code,
                canSwitchToMockDemo: true,
                retryPrompt: prompt,
              },
            });
          } else {
            const message = err instanceof Error ? err.message : 'Ошибка выполнения задачи агентом';
            broadcastToSession(sessionId, {
              type: 'chat:error',
              payload: { sessionId, runId, error: message, retryPrompt: prompt },
            });
          }
        }
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      broadcastMetrics();
    });
  });

  // --- Python Execution Plane Bridge WebSocket (/ws/bridge) ---
  bridgeWss.on('connection', (ws) => {
    const bridgeSecret = process.env.VANGUARD_BRIDGE_HMAC_SECRET?.trim() || '';

    ws.on('message', (raw) => {
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      const verified = verifyBridgeEnvelope(rawJson, bridgeSecret, 30);
      if (!verified.ok) {
        const ev = runtime.emitSystemSecurityEvent(
          'system_bridge',
          'BRIDGE_HMAC_REJECTED',
          'CRITICAL',
          `Отклонён неподписанный/просроченный пакет Python Bridge: ${verified.error}`,
          { reason: verified.error },
          'live_bridge'
        );
        emitAndBroadcastEvent(ev);
        ws.close(4003, verified.error.slice(0, 120));
        return;
      }

      const parsedPayload = BridgePayloadSchema.safeParse(verified.payload);
      if (!parsedPayload.success) {
        const ev = runtime.emitSystemSecurityEvent(
          'system_bridge',
          'BRIDGE_SCHEMA_ERROR',
          'HIGH',
          `Нарушение Zod-схемы пакета моста: ${parsedPayload.error.issues[0]?.message}`,
          { issues: parsedPayload.error.issues },
          'live_bridge'
        );
        emitAndBroadcastEvent(ev);
        return;
      }

      const data = parsedPayload.data;
      if (data.type === 'BRIDGE_HELLO') {
        runtime.attachBridgeSocket(ws, {
          agentVersion: data.agentVersion,
          protocolVersion: data.protocolVersion,
          workspace: data.workspace,
          modules: data.modules,
        });
        const ev = runtime.emitSystemSecurityEvent(
          'system_bridge',
          'BRIDGE_CONNECTED',
          'INFO',
          `Python Bridge v${data.agentVersion} подключён (${data.workspace})`,
          {
            workspace: data.workspace,
            protocolVersion: data.protocolVersion || '2.1',
            modules: data.modules || [],
            anchorCommit: data.anchorCommit || null,
          },
          'live_bridge'
        );
        emitAndBroadcastEvent(ev);
        broadcastAll({ type: 'mode:updated', payload: { mode: runtime.getMode(), bridge: runtime.getBridgeStatus() } });
        broadcastMetrics();
      } else if (data.type === 'PONG') {
        runtime.markBridgePong(data.pingSentAt, data.modules);
        broadcastAll({ type: 'mode:updated', payload: { mode: runtime.getMode(), bridge: runtime.getBridgeStatus() } });
      } else if (data.type === 'HEARTBEAT') {
        runtime.recordBridgeHeartbeat({
          envelopeTimestamp: verified.timestamp,
          protocolVersion: data.protocolVersion,
          modules: data.modules,
        });
        broadcastAll({ type: 'mode:updated', payload: { mode: runtime.getMode(), bridge: runtime.getBridgeStatus() } });
      } else if (data.type === 'DAG_NODE') {
        const { state, event } = runtime.ingestBridgeDagNode(data.sessionId, data.node);
        emitAndBroadcastEvent(event);
        broadcastToSession(data.sessionId, { type: 'session:state', payload: state });
        broadcastMetrics();
      } else if (data.type === 'VERIFIER_VERDICT') {
        const ev = runtime.emitSystemSecurityEvent(
          data.sessionId,
          'VERIFIER_VERDICT',
          data.verdict === 'FAILED' ? 'HIGH' : 'INFO',
          `[LIVE_BRIDGE] ExternalVerifier: ${data.verdict} (${data.failureClass}) — ${data.summary}`,
          { sid: data.sid, verdict: data.verdict, failureClass: data.failureClass },
          'live_bridge'
        );
        emitAndBroadcastEvent(ev);
      } else if (data.type === 'EMERGENCY_ABORT_ACK') {
        const ev = runtime.emitSystemSecurityEvent(
          data.sessionId,
          'EMERGENCY_ABORT_ACK',
          'HIGH',
          `Python Bridge подтвердил SIGKILL и восстановление git commit ${data.restoredCommit}`,
          { restoredCommit: data.restoredCommit, reason: data.reason },
          'live_bridge'
        );
        emitAndBroadcastEvent(ev);
      }
    });

    ws.on('close', () => {
      runtime.detachBridgeSocket(ws);
      broadcastAll({ type: 'mode:updated', payload: { mode: runtime.getMode(), bridge: runtime.getBridgeStatus() } });
      broadcastMetrics();
    });
  });

  // Periodic lightweight telemetry heartbeat
  const heartbeat = setInterval(() => {
    if (clients.size > 0) {
      broadcastMetrics();
    }
  }, 15_000);

  const shutdown = () => {
    clearInterval(heartbeat);
    telegram.stopPolling();
    clientWss.close();
    bridgeWss.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanguard SRE Control Plane listening on http://0.0.0.0:${PORT} (mode=${runtime.getMode()})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Vanguard SRE server:', err);
  process.exit(1);
});
