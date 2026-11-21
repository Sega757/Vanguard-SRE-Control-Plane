import crypto from 'node:crypto';
import { z } from 'zod';

export const ExecutionModeSchema = z.enum(['MOCK_DEMO', 'AI_SANDBOX', 'LIVE_BRIDGE']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const EffectClassSchema = z.enum(['read_only', 'idempotent_write', 'irreversible']);
export const VerdictSchema = z.enum(['PENDING', 'OBSERVED', 'SUCCESS', 'FAILED']);
export const FailureClassSchema = z.enum(['NONE', 'PATCH', 'TEST', 'ENV', 'UNKNOWN']);
export const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
export const DecisionSourceSchema = z.enum(['web_ui', 'telegram_operator', 'live_bridge', 'system']);
export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const AiSandboxStepSchema = z.object({
  tool: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  kind: z.enum(['non_terminal', 'terminal']),
  effectClass: EffectClassSchema,
  filePath: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  patchHypothesis: z.string().min(1).max(400).optional(),
  riskLevel: RiskLevelSchema.optional(),
  riskAssessment: z.string().min(1).max(320).optional(),
  simulateRollbackFirst: z.boolean().optional(),
  failureCaseId: z.string().max(80).optional(),
  failureExcType: z.string().max(64).optional(),
  failureContract: z.string().max(240).optional(),
});

export const AiSandboxPlanSchema = z.object({
  planRationale: z.string().min(1).max(600),
  patchHypothesis: z.string().min(1).max(600).optional(),
  riskLevel: RiskLevelSchema.default('MEDIUM'),
  riskAssessment: z.string().min(1).max(500).optional(),
  verifierVerdictSummary: z.string().min(1).max(500).optional(),
  steps: z.array(AiSandboxStepSchema).min(1).max(5),
});

export const DagNodePacketSchema = z.object({
  sid: z.string().min(1).max(128),
  pid: z.string().max(128).nullable(),
  kind: z.enum(['root', 'non_terminal', 'terminal']),
  tool: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  effectClass: EffectClassSchema,
  fingerprint: z.string().min(4).max(128),
  verdict: VerdictSchema,
  failureClass: FailureClassSchema,
  errorSig: z.string().max(300).nullable(),
  anchor: z.boolean(),
  pruned: z.boolean(),
  dryRun: z.boolean().optional(),
  patchHypothesis: z.string().max(500).nullable().optional(),
  riskLevel: RiskLevelSchema.optional(),
  riskAssessment: z.string().max(400).nullable().optional(),
  commitHash: z.string().max(64).nullable(),
  blobHash: z.string().min(8).max(128),
  latencyMs: z.number().min(0).max(600000),
  createdAt: z.string(),
});

export const ArbiterPolicyPacketSchema = z.object({
  maxRetriesPerAnchor: z.number().int().min(1).max(20).optional(),
  maxTotalRollbacks: z.number().int().min(1).max(50).optional(),
  maxConstraints: z.number().int().min(1).max(20).optional(),
  maxRepeatRejects: z.number().int().min(1).max(20).optional(),
  replanSteps: z.number().int().min(1).max(10).optional(),
  controlRunEnabled: z.boolean().optional(),
  autoApproveIdempotent: z.boolean().optional(),
});

export const TaskDispatchPacketSchema = z.object({
  type: z.literal('TASK_DISPATCH'),
  sessionId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(10000),
  anchorSid: z.string().max(128).optional(),
  provider: z.string().max(32).optional(),
  model: z.string().max(80).optional(),
});

export const ApprovalDecisionPacketSchema = z.object({
  effectId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(4).max(128),
  expectedAnchorHash: z.string().min(4).max(128),
  decision: z.enum(['APPROVE', 'REJECT', 'EMERGENCY_ABORT']),
  source: DecisionSourceSchema.default('web_ui'),
  actor: z.string().max(128).optional(),
});

export const EmergencyAbortPacketSchema = z.object({
  sessionId: z.string().min(1).max(128),
  reason: z.string().min(1).max(300).default('Аварийная остановка оператором'),
  source: DecisionSourceSchema.default('web_ui'),
  actor: z.string().max(128).optional(),
});

export const VerifierVerdictPacketSchema = z.object({
  type: z.literal('VERIFIER_VERDICT'),
  sessionId: z.string().min(1).max(128),
  sid: z.string().min(1).max(128),
  verdict: VerdictSchema,
  failureClass: FailureClassSchema,
  summary: z.string().max(500),
});

export const BridgePayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BRIDGE_HELLO'),
    agentVersion: z.string().max(32),
    protocolVersion: z.string().max(32).optional(),
    workspace: z.string().max(500),
    hasWorkspaceManager: z.boolean().optional(),
    modules: z.array(z.string().max(64)).max(32).optional(),
    anchorCommit: z.string().max(64).nullable().optional(),
  }),
  z.object({
    type: z.literal('PONG'),
    ts: z.number(),
    pingSentAt: z.number().optional(),
    workspace: z.string().max(500).optional(),
    modules: z.array(z.string().max(64)).max(32).optional(),
  }),
  z.object({
    type: z.literal('HEARTBEAT'),
    ts: z.number(),
    protocolVersion: z.string().max(32).optional(),
    modules: z.array(z.string().max(64)).max(32).optional(),
  }),
  z.object({
    type: z.literal('DAG_NODE'),
    sessionId: z.string().min(1).max(128),
    node: DagNodePacketSchema,
  }),
  VerifierVerdictPacketSchema,
  z.object({
    type: z.literal('APPROVAL_REQUIRED'),
    sessionId: z.string().min(1).max(128),
    effectId: z.string().min(1).max(128),
    sid: z.string().min(1).max(128),
    tool: z.string().min(1).max(80),
    effectClass: EffectClassSchema,
    idempotencyKey: z.string().min(4).max(128),
    expectedAnchorHash: z.string().min(4).max(128),
    summary: z.string().max(500),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('EMERGENCY_ABORT_ACK'),
    sessionId: z.string().min(1).max(128),
    restoredCommit: z.string().max(64),
    reason: z.string().max(300),
  }),
  z.object({
    type: z.literal('BRIDGE_ACK'),
    sessionId: z.string().max(128).optional(),
    effectId: z.string().max(128).optional(),
    decision: z.string().max(32).optional(),
    message: z.string().max(500),
  }),
]);

export const BridgeSignedEnvelopeSchema = z.object({
  timestamp: z.number().int().positive(),
  nonce: z.string().min(8).max(128),
  signature: z.string().max(128),
  payload: z.record(z.string(), z.unknown()),
});

export const WsClientMessageSchema = z.object({
  type: z.enum([
    'auth:handshake',
    'session:join',
    'config:update',
    'approval:response',
    'agent:task',
    'emergency:abort',
    'mode:switch',
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',') + '}';
}

export function maskSecret(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `••••${trimmed.slice(-4)}`;
}

const seenBridgeNonces = new Map<string, number>();

export function signBridgeEnvelope(
  payload: Record<string, unknown>,
  secret: string
): { timestamp: number; nonce: string; signature: string; payload: Record<string, unknown> } {
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(12).toString('hex');
  const body = canonicalJson({ timestamp, nonce, payload });
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    : '';
  return { timestamp, nonce, signature, payload };
}

export function verifyBridgeEnvelope(
  raw: unknown,
  secret: string,
  maxSkewSec = 30
): { ok: true; payload: Record<string, unknown>; timestamp: number } | { ok: false; error: string } {
  const parsed = BridgeSignedEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `Некорректный формат конверта моста: ${parsed.error.issues[0]?.message}` };
  }

  const { timestamp, nonce, signature, payload } = parsed.data;
  const now = Date.now();
  const skewMs = Math.abs(now - timestamp);
  if (skewMs > maxSkewSec * 1000) {
    return {
      ok: false,
      error: `Отклонено защитой от replay-атак: расхождение timestamp ${Math.round(skewMs / 1000)}с > ${maxSkewSec}с`,
    };
  }

  if (seenBridgeNonces.size > 1000) {
    for (const [k, exp] of seenBridgeNonces.entries()) {
      if (exp < now) seenBridgeNonces.delete(k);
    }
  }

  if (seenBridgeNonces.has(nonce)) {
    return { ok: false, error: 'Обнаружен повтор nonce (replay-атака отклонена)' };
  }

  if (secret) {
    const body = canonicalJson({ timestamp, nonce, payload });
    const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, error: 'Неверная подпись HMAC-SHA256 пакета моста' };
    }
  }

  seenBridgeNonces.set(nonce, now + maxSkewSec * 2000);
  return { ok: true, payload, timestamp };
}
