import crypto from 'node:crypto';
import { maskSecret } from './protocolSchema.ts';
import type { ApprovalPrompt, Severity, TransponderEvent } from './sreEngine.ts';

export interface TelegramDecisionCallbackArgs {
  effectId: string;
  idempotencyKey: string;
  expectedAnchorHash: string;
  decision: 'APPROVE' | 'REJECT' | 'EMERGENCY_ABORT';
  chatId: string;
  username: string;
}

export interface TelegramDecisionResult {
  ok: boolean;
  statusCode: number;
  message: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
};

interface PendingCallbackRecord {
  effectId: string;
  idempotencyKey: string;
  expectedAnchorHash: string;
  sessionId: string;
  summary: string;
}

export class TelegramBridge {
  private pollingActive = false;
  private pollAbort: AbortController | null = null;
  private offset = 0;
  private minSeverity: Severity = 'HIGH';
  private enabledNotifications = true;
  private callbackIndex = new Map<string, PendingCallbackRecord>();
  private onDecision: ((args: TelegramDecisionCallbackArgs) => Promise<TelegramDecisionResult>) | null = null;
  private onUnauthorizedAttempt: ((chatId: string, action: string) => void) | null = null;
  private botUsername: string | null = null;
  private lastPollError: string | null = null;

  public get token(): string {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  }

  public get webhookSecret(): string {
    return (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  }

  public get allowedChatIds(): string[] {
    return (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  public isConfigured(): boolean {
    return Boolean(this.token && this.allowedChatIds.length > 0);
  }

  public verifyWebhookSecret(
    headerToken: string | undefined
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    const expected = this.webhookSecret;
    if (!expected) {
      return {
        ok: false,
        statusCode: 503,
        error: 'Webhook disabled without TELEGRAM_WEBHOOK_SECRET',
      };
    }
    const provided = (headerToken || '').trim();
    if (!provided) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Missing X-Telegram-Bot-Api-Secret-Token header',
      };
    }
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return {
        ok: false,
        statusCode: 403,
        error: 'Invalid X-Telegram-Bot-Api-Secret-Token',
      };
    }
    return { ok: true };
  }

  public getStatus() {
    return {
      configured: this.isConfigured(),
      hasToken: Boolean(this.token),
      maskedToken: maskSecret(this.token),
      webhookConfigured: Boolean(this.webhookSecret),
      allowedChatsCount: this.allowedChatIds.length,
      pollingActive: this.pollingActive,
      botUsername: this.botUsername,
      minSeverity: this.minSeverity,
      enabledNotifications: this.enabledNotifications,
      lastPollError: this.lastPollError,
    };
  }

  public updateFilter(opts: { minSeverity?: Severity; enabledNotifications?: boolean }) {
    if (opts.minSeverity && SEVERITY_RANK[opts.minSeverity]) {
      this.minSeverity = opts.minSeverity;
    }
    if (typeof opts.enabledNotifications === 'boolean') {
      this.enabledNotifications = opts.enabledNotifications;
    }
    return this.getStatus();
  }

  public bindHandlers(
    onDecision: (args: TelegramDecisionCallbackArgs) => Promise<TelegramDecisionResult>,
    onUnauthorizedAttempt?: (chatId: string, action: string) => void
  ) {
    this.onDecision = onDecision;
    this.onUnauthorizedAttempt = onUnauthorizedAttempt || null;
  }

  private async apiCall<T = unknown>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    if (!this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN не задан');
    }
    const resp = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal,
    });
    const data = (await resp.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    if (!resp.ok || !data.ok) {
      const code = data.error_code || resp.status;
      throw new Error(`Telegram HTTP ${code}: ${data.description || 'API error'}`);
    }
    return data.result as T;
  }

  public async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    botUsername?: string;
  }> {
    if (!this.token) {
      return {
        ok: false,
        latencyMs: 0,
        message: 'Переменная TELEGRAM_BOT_TOKEN не задана на сервере.',
      };
    }
    const t0 = Date.now();
    try {
      const me = await this.apiCall<{ username?: string; first_name?: string }>('getMe');
      this.botUsername = me.username || null;
      const latencyMs = Date.now() - t0;
      const chatsCount = this.allowedChatIds.length;
      return {
        ok: true,
        latencyMs,
        botUsername: me.username,
        message:
          chatsCount > 0
            ? `Бот @${me.username || me.first_name} активен · разрешённых чатов: ${chatsCount}`
            : `Бот @${me.username || me.first_name} отвечает, но TELEGRAM_ALLOWED_CHAT_IDS пуст`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        message: err instanceof Error ? err.message : 'Ошибка Telegram Bot API',
      };
    }
  }

  public startPolling(): void {
    if (!this.isConfigured() || this.pollingActive) return;
    this.pollingActive = true;
    void this.pollLoop().catch((err) => {
      // Never allow unhandled rejection to crash Express server
      this.pollingActive = false;
      this.lastPollError = err instanceof Error ? err.message : String(err);
      console.warn('[TELEGRAM] Long-polling terminated cleanly:', this.lastPollError);
    });
  }

  public stopPolling(): void {
    this.pollingActive = false;
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  private async sleepCancelable(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  private async pollLoop(): Promise<void> {
    let backoffMs = 2000;
    let consecutiveConflicts = 0;

    try {
      const me = await this.apiCall<{ username?: string }>('getMe');
      this.botUsername = me.username || null;
      this.lastPollError = null;
      console.log(`[TELEGRAM] Двусторонний пульт запущен (@${this.botUsername})`);
    } catch (err) {
      this.lastPollError = err instanceof Error ? err.message : String(err);
      console.warn('[TELEGRAM] Не удалось стартовать long-polling:', this.lastPollError);
      this.pollingActive = false;
      return;
    }

    while (this.pollingActive) {
      this.pollAbort = new AbortController();
      try {
        const updates = await this.apiCall<Array<Record<string, unknown>>>(
          'getUpdates',
          {
            offset: this.offset,
            timeout: 20,
            allowed_updates: ['callback_query', 'message'],
          },
          this.pollAbort.signal
        );

        // Reset backoff on clean poll
        backoffMs = 2000;
        consecutiveConflicts = 0;
        this.lastPollError = null;

        for (const upd of updates) {
          const updateId = Number(upd.update_id || 0);
          if (updateId >= this.offset) {
            this.offset = updateId + 1;
          }
          try {
            await this.handleUpdate(upd);
          } catch (handlerErr) {
            console.warn(
              '[TELEGRAM] Ошибка обработки update:',
              handlerErr instanceof Error ? handlerErr.message : handlerErr
            );
          }
        }
      } catch (err) {
        if (!this.pollingActive) break;
        const msg = err instanceof Error ? err.message : String(err);
        this.lastPollError = msg;

        if (msg.includes('409') || msg.includes('Conflict')) {
          consecutiveConflicts += 1;
          if (consecutiveConflicts >= 3) {
            console.warn(
              '[TELEGRAM] Повторный 409 Conflict (активен другой инстанс/webhook). Остановка long-polling.'
            );
            this.pollingActive = false;
            break;
          }
          const waitMs = Math.min(60_000, backoffMs * 2);
          console.warn(`[TELEGRAM] 409 Conflict (#${consecutiveConflicts}). Повтор через ${waitMs / 1000}с.`);
          await this.sleepCancelable(waitMs);
          backoffMs = waitMs;
          continue;
        }

        // Network / transient failure exponential backoff (capped at 60s)
        const waitMs = Math.min(60_000, backoffMs);
        await this.sleepCancelable(waitMs);
        backoffMs = Math.min(60_000, Math.round(backoffMs * 2));
      }
    }
  }

  public async handleUpdate(update: Record<string, unknown>): Promise<void> {
    const cb = update.callback_query as
      | {
          id: string;
          data?: string;
          from?: { username?: string; first_name?: string; id?: number };
          message?: { message_id: number; chat: { id: number }; text?: string };
        }
      | undefined;

    if (!cb || !cb.data || !cb.message) return;

    const chatId = String(cb.message.chat.id);
    const username = cb.from?.username || cb.from?.first_name || `tg_${cb.from?.id || 'unknown'}`;

    if (!this.allowedChatIds.includes(chatId)) {
      this.onUnauthorizedAttempt?.(chatId, cb.data);
      try {
        await this.apiCall('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Доступ запрещён: chat_id не входит в TELEGRAM_ALLOWED_CHAT_IDS.',
          show_alert: true,
        });
      } catch {
        // ignore
      }
      return;
    }

    const [prefix, effectId] = cb.data.split(':');
    const decisionMap: Record<string, 'APPROVE' | 'REJECT' | 'EMERGENCY_ABORT'> = {
      A: 'APPROVE',
      R: 'REJECT',
      E: 'EMERGENCY_ABORT',
    };
    const decision = decisionMap[prefix];
    const record = effectId ? this.callbackIndex.get(effectId) : undefined;

    if (!decision || !record || !this.onDecision) {
      await this.apiCall('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Запрос уже обработан или устарел (409 Conflict).',
        show_alert: true,
      }).catch(() => {});
      return;
    }

    const result = await this.onDecision({
      effectId: record.effectId,
      idempotencyKey: record.idempotencyKey,
      expectedAnchorHash: record.expectedAnchorHash,
      decision,
      chatId,
      username,
    });

    const statusBadge = result.ok
      ? `✅ Итог: ${decision} (telegram_operator: @${username})`
      : `⚠️ Отклонено (${result.statusCode}): ${result.message}`;

    await this.apiCall('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: result.ok ? `Выполнено: ${decision}` : result.message.slice(0, 180),
      show_alert: !result.ok,
    }).catch(() => {});

    await this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      parse_mode: 'HTML',
      text:
        `<b>🛡 Vanguard SRE — Approval Gate</b>\n` +
        `Сессия: <code>${record.sessionId}</code>\n` +
        `Эффект: <code>${record.effectId}</code>\n` +
        `${record.summary}\n\n` +
        `<b>${statusBadge}</b>`,
    }).catch(() => {});
  }

  public async notifyEvent(ev: TransponderEvent): Promise<void> {
    if (!this.isConfigured() || !this.enabledNotifications) return;
    const interestingTypes = new Set([
      'ROLLBACK_TRIGGERED',
      'ESCALATED',
      'EMERGENCY_ABORT',
      'SESSION_COMPLETED',
    ]);
    if (!interestingTypes.has(ev.type)) return;
    if (SEVERITY_RANK[ev.severity] < SEVERITY_RANK[this.minSeverity]) return;

    const text =
      `<b>⚡ Vanguard SRE · ${ev.type}</b>\n` +
      `Уровень: <code>${ev.severity}</code> · Сессия: <code>${ev.sessionId}</code>\n` +
      `Шаг: <code>${ev.sid}</code>\n` +
      `${ev.summary}\n` +
      `HMAC: <code>${ev.hash.slice(0, 16)}…</code>`;

    await Promise.all(
      this.allowedChatIds.map((chatId) =>
        this.apiCall('sendMessage', {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
        }).catch(() => {})
      )
    );
  }

  public async sendApprovalGate(prompt: ApprovalPrompt): Promise<void> {
    if (!this.isConfigured() || !this.enabledNotifications) return;

    this.callbackIndex.set(prompt.effectId, {
      effectId: prompt.effectId,
      idempotencyKey: prompt.idempotencyKey,
      expectedAnchorHash: prompt.expectedAnchorHash,
      sessionId: prompt.sessionId,
      summary: prompt.summary,
    });
    if (this.callbackIndex.size > 200) {
      const oldestKey = this.callbackIndex.keys().next().value;
      if (oldestKey) this.callbackIndex.delete(oldestKey);
    }

    const text =
      `<b>🔐 Vanguard SRE — Approval Gate (IRREVERSIBLE_EFFECT)</b>\n` +
      `Сессия: <code>${prompt.sessionId}</code>\n` +
      `Инструмент: <code>${prompt.tool}</code>\n` +
      `Effect ID: <code>${prompt.effectId}</code>\n` +
      `Anchor Hash: <code>${prompt.expectedAnchorHash.slice(0, 16)}</code>\n\n` +
      `${prompt.summary}`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `A:${prompt.effectId}` },
          { text: '❌ Reject', callback_data: `R:${prompt.effectId}` },
        ],
        [{ text: '🛑 Emergency Abort', callback_data: `E:${prompt.effectId}` }],
      ],
    };

    await Promise.all(
      this.allowedChatIds.map((chatId) =>
        this.apiCall('sendMessage', {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }).catch(() => {})
      )
    );
  }
}
