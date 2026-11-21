import { GoogleGenAI, Type } from '@google/genai';
import { AiSandboxPlanSchema, maskSecret } from './protocolSchema.ts';
import type { ConstraintNotice, PlannedStep } from './sreEngine.ts';

export type LlmProviderId = 'gemini' | 'anthropic' | 'openai' | 'custom' | 'mock_demo';

export interface LlmProviderStatus {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  maskedKey: string | null;
  models: string[];
  defaultModel: string;
  envHint: string;
  tier: 'primary' | 'optional';
}

export class AiSandboxError extends Error {
  public readonly code: 'LLM_NO_KEY' | 'LLM_QUOTA_EXCEEDED' | 'LLM_API_ERROR' | 'LLM_SCHEMA_INVALID';
  public readonly provider: string;
  public readonly model: string;

  constructor(
    message: string,
    code: 'LLM_NO_KEY' | 'LLM_QUOTA_EXCEEDED' | 'LLM_API_ERROR' | 'LLM_SCHEMA_INVALID',
    provider: string,
    model: string
  ) {
    super(message);
    this.name = 'AiSandboxError';
    this.code = code;
    this.provider = provider;
    this.model = model;
  }
}

export function getLlmProvidersStatus(): LlmProviderStatus[] {
  const customConfigured = Boolean(
    process.env.CUSTOM_LLM_API_KEY?.trim() && process.env.CUSTOM_LLM_BASE_URL?.trim()
  );
  const customModel = process.env.CUSTOM_LLM_MODEL?.trim() || 'gpt-4o-mini';

  return [
    {
      id: 'gemini',
      label: 'Google Gemini',
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      maskedKey: maskSecret(process.env.GEMINI_API_KEY),
      models: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
      defaultModel: 'gemini-3.1-flash-lite',
      envHint: 'GEMINI_API_KEY',
      tier: 'primary',
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude',
      configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      maskedKey: maskSecret(process.env.ANTHROPIC_API_KEY),
      models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest'],
      defaultModel: 'claude-sonnet-4-20250514',
      envHint: 'ANTHROPIC_API_KEY',
      tier: 'optional',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      maskedKey: maskSecret(process.env.OPENAI_API_KEY),
      models: ['gpt-4o', 'gpt-4o-mini'],
      defaultModel: 'gpt-4o-mini',
      envHint: 'OPENAI_API_KEY',
      tier: 'optional',
    },
    {
      id: 'custom',
      label: 'Custom OpenAI-Compatible API',
      configured: customConfigured,
      maskedKey: maskSecret(process.env.CUSTOM_LLM_API_KEY),
      models: [customModel],
      defaultModel: customModel,
      envHint: 'CUSTOM_LLM_API_KEY + CUSTOM_LLM_BASE_URL',
      tier: 'optional',
    },
  ];
}

export function hasAnyConfiguredLlmProvider(): boolean {
  return getLlmProvidersStatus().some((p) => p.configured);
}

export function resolveActiveProvider(
  requestedProvider?: string,
  requestedModel?: string
): { provider: LlmProviderId; model: string } {
  const statuses = getLlmProvidersStatus();
  if (requestedProvider && requestedProvider !== 'mock_demo' && requestedProvider !== 'simulation') {
    const match = statuses.find((p) => p.id === requestedProvider && p.configured);
    if (match) {
      const model =
        requestedModel && match.models.includes(requestedModel)
          ? requestedModel
          : match.defaultModel;
      return { provider: match.id, model };
    }
  }

  const firstConfigured = statuses.find((p) => p.configured);
  if (firstConfigured) {
    return { provider: firstConfigured.id, model: firstConfigured.defaultModel };
  }

  return { provider: 'mock_demo', model: 'deterministic-offline' };
}

export function buildMockDemoPlan(userPrompt: string): {
  provider: LlmProviderId;
  model: string;
  planRationale: string;
  patchHypothesis: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskAssessment: string;
  verifierVerdictSummary: string;
  steps: PlannedStep[];
} {
  const lower = userPrompt.toLowerCase();
  const wantsDeploy =
    lower.includes('деплой') ||
    lower.includes('deploy') ||
    lower.includes('продакш') ||
    lower.includes('релиз') ||
    lower.includes('необратим') ||
    lower.includes('миграц');
  const wantsRollback =
    lower.includes('откат') ||
    lower.includes('rollback') ||
    lower.includes('патч') ||
    lower.includes('утечк') ||
    lower.includes('исправ') ||
    lower.includes('баг');

  const steps: PlannedStep[] = [
    {
      tool: 'inspect_workspace',
      label: 'Инспекция рабочего дерева git и активных процессов (/proc)',
      kind: 'non_terminal',
      effectClass: 'read_only',
      filePath: 'workspace/worker_pool.py',
      summary: 'Чтение состояния текущего якоря и проверка открытых файловых дескрипторов',
      patchHypothesis: 'Проверка базового состояния до внесения изменений',
      riskLevel: 'LOW',
      riskAssessment: 'Операция только на чтение без побочных эффектов',
      dryRun: true,
    },
    {
      tool: 'read_telemetry',
      label: 'Проверка цепочки Transponder HMAC-SHA256',
      kind: 'non_terminal',
      effectClass: 'read_only',
      filePath: 'transponder/telemetry.jsonl',
      summary: 'Валидация целостности журнала и отсутствия рваного хвоста',
      patchHypothesis: 'Подтверждение целостности предыдущего якоря',
      riskLevel: 'LOW',
      riskAssessment: 'Чтение журнала аудита безопасно',
      dryRun: true,
    },
    wantsDeploy
      ? {
          tool: 'deploy_release',
          label: 'Канареечное развёртывание релиза (необратимый эффект)',
          kind: 'terminal',
          effectClass: 'irreversible',
          filePath: 'deploy/canary_rollout.yaml',
          summary: 'Демонстрация Approval Gate для необратимого переключения трафика',
          patchHypothesis: 'Поэтапное переключение 10% трафика после подтверждения оператора',
          riskLevel: 'HIGH',
          riskAssessment: 'Необратимая операция: требуется подтверждение оператора и TOCTOU-проверка якоря',
          dryRun: true,
        }
      : {
          tool: 'apply_patch',
          label: 'Применение патча и запуск ExternalVerifier',
          kind: 'terminal',
          effectClass: 'idempotent_write',
          filePath: 'workspace/worker_pool.py',
          summary: 'Демонстрация 3-слойного отката и повторной верификации инвариантов',
          patchHypothesis: 'Закрытие дочерних групп процессов через os.killpg и контекстный менеджер',
          riskLevel: 'MEDIUM',
          riskAssessment: 'При нарушении инварианта выполняется 3-слойный откат к якорю',
          dryRun: true,
          simulateRollbackFirst: wantsRollback,
          failureCaseId: 'guard_fd_cleanup',
          failureExcType: 'AssertionError',
          failureContract: 'Все фоновые группы процессов должны завершаться без утечки дескрипторов',
        },
  ];

  return {
    provider: 'mock_demo',
    model: 'deterministic-offline',
    planRationale:
      'Офлайн-демонстрация (MOCK_DEMO): детерминированный прогон протокола Arbiter, 3-слойного отката и Approval Gate без обращения к внешним LLM.',
    patchHypothesis: wantsDeploy
      ? 'Демонстрационный сценарий канареечного релиза с обязательным Approval Gate.'
      : 'Демонстрационный сценарий исправления утечки дескрипторов с 3-слойным откатом.',
    riskLevel: wantsDeploy ? 'HIGH' : 'MEDIUM',
    riskAssessment: 'Демонстрационный режим MOCK_DEMO — реальные файлы и внешние сервисы не затрагиваются.',
    verifierVerdictSummary: 'ExternalVerifier (MOCK_DEMO): демонстрационная проверка инвариантов.',
    steps,
  };
}

const AI_SANDBOX_PLANNER_PROMPT =
  'Ты — инженерный планировщик и анализатор Vanguard SRE в режиме AI_SANDBOX (dry_run: true, файлы на диске НЕ изменяются). ' +
  'Проанализируй произвольную инженерную задачу пользователя и верни СТРОГО валидный JSON-объект со следующими полями:\n' +
  '- planRationale: краткая техническая стратегия решения (на русском)\n' +
  '- patchHypothesis: конкретная гипотеза патча или архитектурного изменения (на русском)\n' +
  '- riskLevel: "LOW" | "MEDIUM" | "HIGH"\n' +
  '- riskAssessment: оценка инженерных рисков и точек отказа\n' +
  '- verifierVerdictSummary: критерий и ожидаемый вердикт ExternalVerifier (goal/guard проверки)\n' +
  '- steps: массив из 3–4 шагов DAG, каждый шаг содержит:\n' +
  '  tool (один из: inspect_workspace, read_telemetry, apply_patch, call_external_api, deploy_release),\n' +
  '  label (конкретное название шага по задаче пользователя),\n' +
  '  kind ("non_terminal" | "terminal"),\n' +
  '  effectClass ("read_only" | "idempotent_write" | "irreversible"),\n' +
  '  filePath (релевантный путь к файлу/манифесту для задачи),\n' +
  '  summary (что именно проверяется или моделируется на этом шаге),\n' +
  '  patchHypothesis (гипотеза изменения для этого шага),\n' +
  '  riskLevel ("LOW" | "MEDIUM" | "HIGH"),\n' +
  '  riskAssessment (риски этого шага),\n' +
  '  simulateRollbackFirst (boolean: true если полезно смоделировать откат при нарушении инварианта),\n' +
  '  failureCaseId, failureExcType, failureContract (если simulateRollbackFirst=true).\n' +
  'Если задача предполагает деплой в продакшен, миграцию БД или необратимую операцию, поставь effectClass="irreversible" для финального шага. ' +
  'Никогда не пиши, что файлы реально изменены на диске — это dry-run анализ в песочнице.';

const REPORT_SYSTEM_PROMPT =
  'Ты — автономный SRE-инженер Vanguard SRE (v2). Дай чёткий, структурированный инженерный отчёт на русском языке ' +
  'по выполненной задаче: гипотеза патча, оценка рисков, шаги DAG, вердикт ExternalVerifier и рекомендации. ' +
  'Если режим AI_SANDBOX (dry_run: true), прямо укажи, что выполнен анализ в песочнице без изменения файлов на диске.';

function classifyApiError(
  err: unknown,
  provider: string,
  model: string
): AiSandboxError {
  if (err instanceof AiSandboxError) return err;
  const rawMsg = err instanceof Error ? err.message : String(err);
  const lower = rawMsg.toLowerCase();
  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted')
  ) {
    return new AiSandboxError(
      `Исчерпана квота или превышен лимит запросов ${provider} (${model}): ${rawMsg.slice(0, 220)}`,
      'LLM_QUOTA_EXCEEDED',
      provider,
      model
    );
  }
  return new AiSandboxError(
    `Ошибка обращения к LLM API ${provider} (${model}): ${rawMsg.slice(0, 240)}`,
    'LLM_API_ERROR',
    provider,
    model
  );
}

async function callOpenAiCompatibleJson(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '{}';
}

async function callAnthropicText(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.map((c) => c.text || '').join('') ?? '';
}

function parseAndValidateSandboxJson(
  rawText: string,
  provider: LlmProviderId,
  model: string
): {
  provider: LlmProviderId;
  model: string;
  planRationale: string;
  patchHypothesis: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskAssessment: string;
  verifierVerdictSummary: string;
  steps: PlannedStep[];
} {
  let rawObj: unknown;
  try {
    const trimmed = rawText.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    rawObj = JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
  } catch (err) {
    throw new AiSandboxError(
      `Модель ${provider}/${model} вернула невалидный JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      'LLM_SCHEMA_INVALID',
      provider,
      model
    );
  }

  const parsed = AiSandboxPlanSchema.safeParse(rawObj);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AiSandboxError(
      `Ответ ${provider}/${model} не прошёл Zod-валидацию (${issue?.path.join('.') || 'root'}: ${issue?.message})`,
      'LLM_SCHEMA_INVALID',
      provider,
      model
    );
  }

  const data = parsed.data;
  const steps: PlannedStep[] = data.steps.map((s) => ({
    tool: s.tool,
    label: s.label,
    kind: s.kind,
    effectClass: s.effectClass,
    filePath: s.filePath,
    summary: s.summary,
    patchHypothesis: s.patchHypothesis || data.patchHypothesis || s.summary,
    riskLevel: s.riskLevel || data.riskLevel,
    riskAssessment: s.riskAssessment || data.riskAssessment || 'Анализ в изолированной песочнице (dry_run)',
    dryRun: true,
    simulateRollbackFirst: Boolean(s.simulateRollbackFirst),
    failureCaseId: s.failureCaseId || 'guard_invariant_01',
    failureExcType: s.failureExcType || 'AssertionError',
    failureContract:
      s.failureContract || 'Инвариант должен сохранять идемпотентность и закрывать дескрипторы процессов',
  }));

  return {
    provider,
    model,
    planRationale: data.planRationale,
    patchHypothesis: data.patchHypothesis || steps[steps.length - 1]?.patchHypothesis || data.planRationale,
    riskLevel: data.riskLevel,
    riskAssessment: data.riskAssessment || 'Оценка рисков выполнена в песочнице AI_SANDBOX.',
    verifierVerdictSummary:
      data.verifierVerdictSummary || 'ExternalVerifier: проверка целевых инвариантов в режиме dry_run.',
    steps,
  };
}

export async function generateAiSandboxPlan(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  userPrompt: string,
  constraints: ConstraintNotice[]
): Promise<{
  provider: LlmProviderId;
  model: string;
  planRationale: string;
  patchHypothesis: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskAssessment: string;
  verifierVerdictSummary: string;
  steps: PlannedStep[];
}> {
  const resolved = resolveActiveProvider(requestedProvider, requestedModel);
  if (resolved.provider === 'mock_demo') {
    throw new AiSandboxError(
      'Не найден активный ключ LLM (GEMINI_API_KEY или опциональный провайдер). Задайте ключ в окружении или переключитесь в режим MOCK_DEMO.',
      'LLM_NO_KEY',
      'none',
      'none'
    );
  }

  const constraintContext =
    constraints.length > 0
      ? `\n\nАктивные негативные ограничения (Constraints):\n${constraints.map((c) => c.rendered).join('\n')}`
      : '';
  const fullPrompt = `Задача оператора (режим AI_SANDBOX, dry_run=true): ${userPrompt}${constraintContext}`;

  try {
    if (resolved.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: resolved.model,
        contents: fullPrompt,
        config: {
          systemInstruction: AI_SANDBOX_PLANNER_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              planRationale: { type: Type.STRING },
              patchHypothesis: { type: Type.STRING },
              riskLevel: { type: Type.STRING },
              riskAssessment: { type: Type.STRING },
              verifierVerdictSummary: { type: Type.STRING },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tool: { type: Type.STRING },
                    label: { type: Type.STRING },
                    kind: { type: Type.STRING },
                    effectClass: { type: Type.STRING },
                    filePath: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    patchHypothesis: { type: Type.STRING },
                    riskLevel: { type: Type.STRING },
                    riskAssessment: { type: Type.STRING },
                    simulateRollbackFirst: { type: Type.BOOLEAN },
                    failureCaseId: { type: Type.STRING },
                    failureExcType: { type: Type.STRING },
                    failureContract: { type: Type.STRING },
                  },
                  required: ['tool', 'label', 'kind', 'effectClass', 'filePath', 'summary'],
                },
              },
            },
            required: ['planRationale', 'patchHypothesis', 'riskLevel', 'riskAssessment', 'steps'],
          },
        },
      });
      return parseAndValidateSandboxJson(response.text ?? '', resolved.provider, resolved.model);
    }

    if (resolved.provider === 'openai' || resolved.provider === 'custom') {
      const baseUrl =
        resolved.provider === 'openai'
          ? 'https://api.openai.com/v1'
          : process.env.CUSTOM_LLM_BASE_URL || '';
      const apiKey =
        resolved.provider === 'openai'
          ? process.env.OPENAI_API_KEY || ''
          : process.env.CUSTOM_LLM_API_KEY || '';
      const rawText = await callOpenAiCompatibleJson(
        baseUrl,
        apiKey,
        resolved.model,
        AI_SANDBOX_PLANNER_PROMPT,
        fullPrompt
      );
      return parseAndValidateSandboxJson(rawText, resolved.provider, resolved.model);
    }

    if (resolved.provider === 'anthropic') {
      const rawText = await callAnthropicText(
        process.env.ANTHROPIC_API_KEY || '',
        resolved.model,
        AI_SANDBOX_PLANNER_PROMPT,
        fullPrompt
      );
      return parseAndValidateSandboxJson(rawText, resolved.provider, resolved.model);
    }
  } catch (err) {
    throw classifyApiError(err, resolved.provider, resolved.model);
  }

  throw new AiSandboxError('Неподдерживаемый провайдер LLM', 'LLM_API_ERROR', resolved.provider, resolved.model);
}

export async function streamSreReport(
  provider: LlmProviderId,
  model: string,
  summaryPrompt: string,
  fallbackSummary: string,
  strictSandboxMode: boolean,
  onToken: (token: string) => void
): Promise<string> {
  if (provider === 'mock_demo') {
    const text = `Отчёт Vanguard SRE (режим MOCK_DEMO — офлайн-симуляция без вызова LLM):\n\n${fallbackSummary}`;
    onToken(text);
    return text;
  }

  try {
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const stream = await ai.models.generateContentStream({
        model,
        contents: summaryPrompt,
        config: { systemInstruction: REPORT_SYSTEM_PROMPT },
      });
      let fullText = '';
      for await (const chunk of stream) {
        const piece = chunk.text ?? '';
        if (piece) {
          fullText += piece;
          onToken(piece);
        }
      }
      if (!fullText && strictSandboxMode) {
        throw new Error('Gemini вернул пустой потоковый отчёт.');
      }
      return fullText || fallbackSummary;
    }

    if (provider === 'anthropic') {
      const text = await callAnthropicText(
        process.env.ANTHROPIC_API_KEY || '',
        model,
        REPORT_SYSTEM_PROMPT,
        summaryPrompt
      );
      onToken(text);
      return text || fallbackSummary;
    }

    if (provider === 'openai' || provider === 'custom') {
      const baseUrl =
        provider === 'openai' ? 'https://api.openai.com/v1' : process.env.CUSTOM_LLM_BASE_URL || '';
      const apiKey =
        provider === 'openai' ? process.env.OPENAI_API_KEY || '' : process.env.CUSTOM_LLM_API_KEY || '';
      const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: REPORT_SYSTEM_PROMPT },
            { role: 'user', content: summaryPrompt },
          ],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text && strictSandboxMode) {
        throw new Error('Пустой ответ при генерации отчёта.');
      }
      onToken(text || fallbackSummary);
      return text || fallbackSummary;
    }
  } catch (err) {
    if (strictSandboxMode) {
      throw classifyApiError(err, provider, model);
    }
  }

  onToken(fallbackSummary);
  return fallbackSummary;
}

export async function probeLlmRouter(
  requestedProvider?: string,
  requestedModel?: string
): Promise<{
  ok: boolean;
  provider: LlmProviderId;
  model: string;
  latencyMs: number;
  message: string;
}> {
  const resolved = resolveActiveProvider(requestedProvider, requestedModel);
  const t0 = Date.now();
  if (resolved.provider === 'mock_demo') {
    return {
      ok: false,
      provider: 'mock_demo',
      model: resolved.model,
      latencyMs: 1,
      message: 'Активный LLM-ключ не задан (доступен только режим MOCK_DEMO).',
    };
  }

  try {
    if (resolved.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const res = await ai.models.generateContent({
        model: resolved.model,
        contents: 'Ответь одним словом: OK',
      });
      return {
        ok: true,
        provider: resolved.provider,
        model: resolved.model,
        latencyMs: Date.now() - t0,
        message: `Ответ получен (${(res.text || 'OK').trim().slice(0, 24)})`,
      };
    }

    if (resolved.provider === 'anthropic') {
      const text = await callAnthropicText(
        process.env.ANTHROPIC_API_KEY || '',
        resolved.model,
        'Respond with OK',
        'Ping'
      );
      return {
        ok: true,
        provider: resolved.provider,
        model: resolved.model,
        latencyMs: Date.now() - t0,
        message: `Ответ получен (${text.trim().slice(0, 24)})`,
      };
    }

    const baseUrl =
      resolved.provider === 'openai'
        ? 'https://api.openai.com/v1'
        : process.env.CUSTOM_LLM_BASE_URL || '';
    const apiKey =
      resolved.provider === 'openai'
        ? process.env.OPENAI_API_KEY || ''
        : process.env.CUSTOM_LLM_API_KEY || '';
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return {
      ok: true,
      provider: resolved.provider,
      model: resolved.model,
      latencyMs: Date.now() - t0,
      message: `API доступен (HTTP ${resp.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      provider: resolved.provider,
      model: resolved.model,
      latencyMs: Date.now() - t0,
      message: err instanceof Error ? err.message : 'Ошибка обращения к LLM API',
    };
  }
}
