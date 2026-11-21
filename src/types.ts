import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'operator' | 'viewer';
export type UserStatus = 'active' | 'suspended';
export type EffectClass = 'read_only' | 'idempotent_write' | 'irreversible';
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'ESCALATED' | 'ROLLBACK_PARTIAL';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type ExecutionMode = 'MOCK_DEMO' | 'AI_SANDBOX' | 'LIVE_BRIDGE';
export type DecisionSource = 'web_ui' | 'telegram_operator' | 'live_bridge' | 'system';
export type LlmProviderId = 'gemini' | 'anthropic' | 'openai' | 'custom' | 'mock_demo';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type NavSection =
  | 'chat'
  | 'dashboard'
  | 'logs'
  | 'sessions'
  | 'settings'
  | 'profile'
  | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  status: UserStatus;
  twoFactorEnabled: boolean;
  canRunAgent: boolean;
  canApproveIrreversible: boolean;
  canManageIntegrations: boolean;
  canExportAuditLogs: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserSecurity {
  uid: string;
  totpSecret: string;
  enabled: boolean;
  backupCodes: string[];
  updatedAt?: Timestamp | null;
}

export interface AgentSession {
  id: string;
  ownerId: string;
  ownerEmail: string;
  title: string;
  status: SessionStatus;
  anchorSid: string;
  totalSteps: number;
  totalRollbacks: number;
  constraintsCount: number;
  lastMessagePreview: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  ownerId: string;
  role: 'user' | 'assistant' | 'system' | 'constraint';
  content: string;
  stepSid: string;
  createdAt?: Timestamp | null;
  localTs?: string;
}

export interface AuditLogEvent {
  id: string;
  seq: number;
  ownerId: string;
  sessionId: string;
  eventType: string;
  severity: Severity;
  sid: string;
  pid: string;
  summary: string;
  payloadSummary: string;
  blobHash: string;
  prevHash: string;
  eventHash: string;
  latencyMs: number;
  source?: DecisionSource;
  createdAt?: Timestamp | null;
  ts?: string;
}

export interface ApiIntegration {
  id: string;
  ownerId: string;
  name: string;
  baseUrl: string;
  healthPath: string;
  authType: 'none' | 'bearer' | 'api_key';
  authHeaderName: string;
  effectClass: EffectClass;
  timeoutMs: number;
  enabled: boolean;
  lastStatus: 'online' | 'degraded' | 'offline' | 'unknown';
  lastLatencyMs: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface ArbiterSettings {
  ownerId: string;
  maxRetriesPerAnchor: number;
  maxTotalRollbacks: number;
  maxConstraints: number;
  maxRepeatRejects: number;
  replanSteps: number;
  controlRunEnabled: boolean;
  autoApproveIdempotent: boolean;
  theme: 'dark' | 'light';
  updatedAt?: Timestamp | null;
}

export interface DagNode {
  sid: string;
  pid: string | null;
  kind: 'root' | 'non_terminal' | 'terminal';
  tool: string;
  label: string;
  effectClass: EffectClass;
  fingerprint: string;
  verdict: 'PENDING' | 'OBSERVED' | 'SUCCESS' | 'FAILED';
  failureClass: 'NONE' | 'PATCH' | 'TEST' | 'ENV' | 'UNKNOWN';
  errorSig: string | null;
  anchor: boolean;
  pruned: boolean;
  dryRun?: boolean;
  patchHypothesis?: string | null;
  riskLevel?: RiskLevel;
  riskAssessment?: string | null;
  commitHash: string | null;
  commitUrl?: string | null;
  blobHash: string;
  latencyMs: number;
  createdAt: string;
}

export interface ConstraintNotice {
  attempt: number;
  caseId: string;
  file: string;
  line: number;
  excType: string;
  scope: string;
  fingerprint: string;
  contract: string;
  rendered: string;
}

export interface TransponderEvent {
  id: string;
  schema: string;
  seq: number;
  ts: string;
  type: string;
  severity: Severity;
  sessionId: string;
  sid: string;
  pid: string | null;
  summary: string;
  source?: DecisionSource;
  payload: Record<string, unknown>;
  blobs: string[];
  prev: string;
  hash: string;
  latencyMs: number;
}

export interface ApprovalPrompt {
  effectId: string;
  approvalId: string;
  sessionId: string;
  sid: string;
  tool: string;
  effectClass: EffectClass;
  idempotencyKey: string;
  expectedAnchorHash: string;
  summary: string;
  args: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalDecisionPayload {
  effectId: string;
  idempotencyKey: string;
  expectedAnchorHash: string;
  decision: 'APPROVE' | 'REJECT' | 'EMERGENCY_ABORT';
}

export interface ApprovalConflictNotice {
  statusCode: number;
  code?: string;
  error: string;
  at: string;
}

export interface ChatStreamError {
  message: string;
  code?: string;
  canSwitchToMockDemo?: boolean;
  retryPrompt?: string;
}

export interface SessionRuntimeState {
  sessionId: string;
  mode: ExecutionMode;
  status: SessionStatus;
  anchorSid: string;
  anchorHash: string;
  tipSid: string;
  totalSteps: number;
  totalRollbacks: number;
  nodes: DagNode[];
  constraints: ConstraintNotice[];
  events: TransponderEvent[];
  effectLedger: Record<string, { state: 'INTENT' | 'COMMITTED'; tool: string; blobHash: string }>;
  pendingApproval: ApprovalPrompt | null;
}

export interface MetricBucket {
  time: string;
  timestamp: number;
  steps: number;
  rollbacks: number;
  avgLatencyMs: number;
  cpuPercent: number;
  memoryMb: number;
  activeConnections: number;
}

export interface CoreServiceHealth {
  id: string;
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  endpoint: string;
}

export interface ServerMetricsSnapshot {
  mode?: ExecutionMode;
  uptimeSec: number;
  activeWsConnections: number;
  activeSessions: number;
  totalSessions: number;
  totalEvents: number;
  hmacChainTip: string;
  blobCount: number;
  medianLatencyMs: number;
  successRate: number;
  memoryMb: number;
  heapMb: number;
  verifications: {
    SUCCESS: number;
    OBSERVED: number;
    PATCH: number;
    TEST: number;
    ENV: number;
  };
  buckets: MetricBucket[];
  coreServices: CoreServiceHealth[];
}

export interface LlmProviderStatus {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  maskedKey: string | null;
  models: string[];
  defaultModel: string;
  envHint: string;
  tier?: 'primary' | 'optional';
}

export interface BridgeStatus {
  mode: ExecutionMode;
  canSwitchToLive: boolean;
  bridgeUrlConfigured: boolean;
  bridgeUrlMasked: string | null;
  hmacConfigured: boolean;
  hmacMasked: string | null;
  wsAgentConnected: boolean;
  agentVersion: string | null;
  protocolVersion?: string | null;
  workspace: string | null;
  modules?: string[];
  connectedAt: string | null;
  lastPongAt: string | null;
  lastHeartbeatAt?: string | null;
  lastLatencyMs?: number | null;
}

export interface GithubIntegrationStatus {
  configured: boolean;
  hasToken: boolean;
  maskedToken: string | null;
  defaultRepo: string | null;
}

export interface TelegramStatus {
  configured: boolean;
  hasToken: boolean;
  maskedToken: string | null;
  webhookConfigured?: boolean;
  allowedChatsCount: number;
  pollingActive: boolean;
  botUsername: string | null;
  minSeverity: Severity;
  enabledNotifications: boolean;
  lastPollError?: string | null;
}

export interface SystemIntegrationsStatus {
  mode: ExecutionMode;
  ephemeralSecrets?: boolean;
  ephemeralSecretDetails?: {
    transponder: boolean;
    twoFactorSession: boolean;
  };
  bridge: BridgeStatus;
  llmProviders: LlmProviderStatus[];
  github: GithubIntegrationStatus;
  telegram: TelegramStatus;
  checkedAt: string;
}

export interface GithubCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GithubPrInfo {
  number: number;
  title: string;
  state: string;
  author: string;
  headBranch: string;
  updatedAt: string;
  url: string;
}

export interface GithubOverview {
  configured: boolean;
  repo: string;
  defaultBranch?: string;
  visibility?: string;
  openIssues?: number;
  stars?: number;
  htmlUrl?: string;
  branches: string[];
  commits: GithubCommitInfo[];
  pullRequests: GithubPrInfo[];
  fetchedAt: string;
  error?: string;
}

export interface HmacChainVerificationResult {
  valid: boolean;
  checkedCount: number;
  brokenIndex: number | null;
  brokenEventId: string | null;
  reason: string;
  verifiedAt: string;
}
