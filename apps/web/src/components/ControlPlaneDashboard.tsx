'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Activity,
  KeyRound,
  Flag,
  Terminal,
  Network,
  Zap,
  RefreshCw,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Server,
  Layers,
  Cpu,
  ArrowUpRight,
  Flame,
  RotateCcw,
  Globe,
  Code2,
  ChevronRight,
  Radio,
  Sparkles,
  Database,
  Gauge,
} from 'lucide-react';

interface TenantOrganization {
  id: string;
  name: string;
  slug: string;
  tier: 'FREE' | 'PRO' | 'ENTERPRISE';
  region: string;
  rateLimitPerMinute: number;
  burstFactor: number;
  monthlyQuota: number;
  requestsThisMonth: number;
}

interface RateLimitSnapshot {
  allowed: boolean;
  limit: number;
  remaining: number;
  currentWeight: number;
  resetAtMs: number;
  headers: Record<string, string | undefined>;
}

interface GatewayExecutionTrace {
  requestId: string;
  timestamp: string;
  tenantId: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  statusCode: 200 | 401 | 403 | 429;
  latencyMs: number;
  rateLimit: {
    allowed: boolean;
    limit: number;
    remaining: number;
    currentWeight: number;
    resetAtMs: number;
    headers: Record<string, string | undefined>;
  };
  flagEvaluation?: {
    flagKey: string;
    value: boolean;
    reason: string;
    bucketScore: number;
  };
  auditSequence: number;
  auditHash: string;
}

interface FeatureFlagConfig {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetTenants: string[];
  rules: Array<{
    id: string;
    description: string;
    attribute: string;
    operator: string;
    values: string[];
    serveVariant: boolean;
  }>;
  updatedAt: string;
}

interface AuditLogEntry {
  id: string;
  sequence: number;
  timestamp: string;
  tenantId: string;
  actorId: string;
  actorType: string;
  action: string;
  resource: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  ipAddress: string;
  metadata: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  brokenAtSequence?: number;
  brokenEntryId?: string;
  expectedHash?: string;
  actualHash?: string;
  reason?: string;
}

interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  keyHash: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'AUDITOR' | 'SERVICE_CLIENT';
  scopes: string[];
  rateLimitPerMinute: number;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
}

interface RegionClusterHealth {
  region: 'us-east-1' | 'eu-central-1' | 'ap-south-1';
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  failureThreshold: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  lastStateChange: string;
  isPrimary: boolean;
}

interface WebhookEventDelivery {
  id: string;
  tenantId: string;
  eventType: string;
  targetUrl: string;
  status: 'DELIVERED' | 'RETRY_SCHEDULED' | 'DEAD_LETTER_QUEUE';
  attemptCount: number;
  maxAttempts: number;
  nextRetryDelaySeconds: number;
  hmacSignature: string;
  payload: Record<string, unknown>;
  lastHttpStatus: number;
  updatedAt: string;
}

interface DLPInspectionResult {
  originalPayload: string;
  sanitizedPayload: string;
  redactedCount: number;
  detectedTypes: string[];
  wafBlocked: boolean;
  wafReason?: string;
}

interface IdempotentRecord {
  idempotencyKey: string;
  tenantId: string;
  endpoint: string;
  payloadHash: string;
  statusCode: number;
  responseBody: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  replayCount: number;
}

interface TenantAiBudget {
  tenantId: string;
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  semanticCacheHits: number;
  totalRequests: number;
}

interface AiGatewayExecution {
  id: string;
  tenantId: string;
  modelId: string;
  promptPreview: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  semanticCacheHit: boolean;
  budgetExceeded: boolean;
  latencyMs: number;
  timestamp: string;
}

interface CanaryTrafficDeployment {
  serviceId: string;
  serviceName: string;
  stableVersion: string;
  canaryVersion: string;
  canaryWeightPercent: number;
  stableMetrics: {
    requests: number;
    p95LatencyMs: number;
    errorRatePercent: number;
  };
  canaryMetrics: {
    requests: number;
    p95LatencyMs: number;
    errorRatePercent: number;
  };
  autoRollbackThresholdPercent: number;
  status: 'HEALTHY_SPLIT' | 'CANARY_PROMOTED' | 'AUTO_ROLLED_BACK';
  lastUpdated: string;
}

export function ControlPlaneDashboard() {
  const [activeTab, setActiveTab] = useState<
    'gateway' | 'resilience' | 'finops' | 'flags' | 'audit' | 'keys' | 'architecture'
  >('gateway');

  const [tenants, setTenants] = useState<TenantOrganization[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('tenant_stripe_fin');
  const [rateLimitSnapshot, setRateLimitSnapshot] = useState<RateLimitSnapshot | null>(null);
  const [recentTraces, setRecentTraces] = useState<GatewayExecutionTrace[]>([]);
  const [latestTrace, setLatestTrace] = useState<GatewayExecutionTrace | null>(null);
  const [telemetry, setTelemetry] = useState<
    Array<{ timestamp: string; allowedCount: number; throttledCount: number; p95LatencyMs: number }>
  >([]);

  // Gateway simulator inputs
  const [simEndpoint, setSimEndpoint] = useState('/v1/payments/intents');
  const [simMethod, setSimMethod] = useState<'POST' | 'GET' | 'PUT' | 'DELETE'>('POST');
  const [simSubjectId, setSimSubjectId] = useState('usr_enterprise_8841');
  const [simFlagKey, setSimFlagKey] = useState('llm-multi-region-failover');
  const [simScope, setSimScope] = useState('gateway:proxy');
  const [isSending, setIsSending] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  // Feature flags state
  const [flags, setFlags] = useState<FeatureFlagConfig[]>([]);
  const [evalSubject, setEvalSubject] = useState('usr_customer_42');
  const [evalResult, setEvalResult] = useState<{
    flagKey: string;
    value: boolean;
    reason: string;
    bucketScore: number;
  } | null>(null);

  // Audit ledger state
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [chainVerification, setChainVerification] = useState<ChainVerificationResult>({
    valid: true,
    totalEntries: 0,
    verifiedEntries: 0,
  });

  // API keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [demoRawKeys, setDemoRawKeys] = useState<Record<string, string>>({});
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<
    'OWNER' | 'ADMIN' | 'DEVELOPER' | 'AUDITOR' | 'SERVICE_CLIENT'
  >('DEVELOPER');
  const [newlyIssuedSecret, setNewlyIssuedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Resilience, Webhooks & DLP state
  const [regions, setRegions] = useState<RegionClusterHealth[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEventDelivery[]>([]);
  const [dlpInput, setDlpInput] = useState(
    '{"customerEmail":"ceo@apexfintech.io","cardNumber":"4532-0151-1283-8899","ssn":"123-45-6789","auth":"Bearer aegis_live_secret_token_99"}'
  );
  const [dlpResult, setDlpResult] = useState<DLPInspectionResult | null>(null);

  // FinOps, Idempotency & Canary state
  const [idempotencyRecords, setIdempotencyRecords] = useState<IdempotentRecord[]>([]);
  const [idemKeyInput, setIdemKeyInput] = useState('idem_wire_transfer_88412');
  const [idemAmountInput, setIdemAmountInput] = useState(12500);
  const [idemLastStatus, setIdemLastStatus] = useState<string | null>(null);
  const [aiBudget, setAiBudget] = useState<TenantAiBudget | null>(null);
  const [aiExecutions, setAiExecutions] = useState<AiGatewayExecution[]>([]);
  const [aiModelInput, setAiModelInput] = useState('claude-3-7-sonnet');
  const [aiPromptInput, setAiPromptInput] = useState(
    'Analyze real-time wire transfer fraud risk vector for merchant #8841'
  );
  const [canaryDeployment, setCanaryDeployment] = useState<CanaryTrafficDeployment | null>(null);

  const fetchAllData = useCallback(async (tenantId: string) => {
    try {
      const [gwRes, flagsRes, auditRes, keysRes, resRes, finRes] = await Promise.all([
        fetch(`/api/v1/gateway?tenantId=${tenantId}`),
        fetch(`/api/v1/flags?tenantId=${tenantId}`),
        fetch(`/api/v1/audit`),
        fetch(`/api/v1/keys`),
        fetch(`/api/v1/resilience`),
        fetch(`/api/v1/finops?tenantId=${tenantId}`),
      ]);

      const gwData = await gwRes.json();
      const flagsData = await flagsRes.json();
      const auditData = await auditRes.json();
      const keysData = await keysRes.json();
      const resData = await resRes.json();
      const finData = await finRes.json();

      setTenants(gwData.tenants || []);
      setRateLimitSnapshot(gwData.rateLimitSnapshot || null);
      setRecentTraces(gwData.recentTraces || []);
      if (gwData.recentTraces?.length > 0) {
        setLatestTrace((prev) => prev ?? gwData.recentTraces[0]);
      }
      setTelemetry(gwData.telemetry || []);
      setDemoRawKeys(gwData.demoRawKeys || {});

      setFlags(flagsData.flags || []);
      setAuditEntries(auditData.entries || []);
      setChainVerification(
        auditData.verification || { valid: true, totalEntries: 0, verifiedEntries: 0 }
      );
      setApiKeys(keysData.keys || []);
      setRegions(resData.regions || []);
      setWebhooks(resData.webhooks || []);
      setIdempotencyRecords(finData.idempotencyRecords || []);
      setAiBudget(finData.aiBudget || null);
      setAiExecutions(finData.aiExecutions || []);
      setCanaryDeployment(finData.canaryDeployment || null);
    } catch (err) {
      console.error('Failed to synchronize Control Plane state:', err);
    }
  }, []);

  useEffect(() => {
    fetchAllData(selectedTenantId);
  }, [selectedTenantId, fetchAllData]);

  const activeTenant =
    tenants.find((t) => t.id === selectedTenantId) || tenants[0] || null;

  const fireGatewayRequest = async (burstCount: number = 1) => {
    setIsSending(true);
    try {
      const res = await fetch('/api/v1/gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          rawApiKey: demoRawKeys[selectedTenantId],
          endpoint: simEndpoint,
          method: simMethod,
          subjectId: simSubjectId,
          flagKey: simFlagKey,
          requiredScope: simScope,
          burstCount,
        }),
      });
      const data = await res.json();
      if (data.latestTrace) {
        setLatestTrace(data.latestTrace);
      }
      await fetchAllData(selectedTenantId);
    } finally {
      setIsSending(false);
    }
  };

  const resetRateLimitBucket = async () => {
    await fetch('/api/v1/gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RESET_RATE_LIMIT',
        tenantId: selectedTenantId,
      }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleUpdateFlag = async (flag: FeatureFlagConfig, patch: Partial<FeatureFlagConfig>) => {
    await fetch('/api/v1/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...flag,
        ...patch,
        tenantId: selectedTenantId,
      }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleEvaluateFlag = async (flagKey: string) => {
    const res = await fetch('/api/v1/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'EVALUATE',
        flagKey,
        tenantId: selectedTenantId,
        subjectId: evalSubject,
      }),
    });
    const data = await res.json();
    setEvalResult(data.evaluation);
  };

  const handleSimulateTamper = async () => {
    const res = await fetch('/api/v1/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SIMULATE_TAMPER' }),
    });
    const data = await res.json();
    setAuditEntries(data.entries || []);
    setChainVerification(data.verification);
  };

  const handleResealChain = async () => {
    const res = await fetch('/api/v1/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESEAL_CHAIN' }),
    });
    const data = await res.json();
    setAuditEntries(data.entries || []);
    setChainVerification(data.verification);
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    const res = await fetch('/api/v1/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: selectedTenantId,
        name: newKeyName.trim(),
        role: newKeyRole,
        rateLimitPerMinute: activeTenant?.rateLimitPerMinute || 20,
      }),
    });
    const data = await res.json();
    if (data.issued?.rawKey) {
      setNewlyIssuedSecret(data.issued.rawKey);
    }
    setNewKeyName('');
    await fetchAllData(selectedTenantId);
  };

  const handleRevokeKey = async (keyId: string) => {
    await fetch('/api/v1/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REVOKE', keyId }),
    });
    await fetchAllData(selectedTenantId);
  };

  const copySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyCurlCommand = () => {
    const cmd = `curl -X ${simMethod} http://localhost:3000/api/v1/gateway \\\n  -H "Content-Type: application/json" \\\n  -d '{"tenantId":"${selectedTenantId}","endpoint":"${simEndpoint}","method":"${simMethod}","subjectId":"${simSubjectId}","flagKey":"${simFlagKey}"}'`;
    navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const handleRegionAction = async (
    action: 'TRIP_REGION' | 'HALF_OPEN_REGION' | 'RECOVER_REGION',
    region: string
  ) => {
    await fetch('/api/v1/resilience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, region, tenantId: selectedTenantId }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleDispatchWebhook = async (simulateFailure: boolean) => {
    await fetch('/api/v1/resilience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DISPATCH_WEBHOOK',
        tenantId: selectedTenantId,
        eventType: simulateFailure ? 'security.rate_limit.breached' : 'payment.intent.succeeded',
        simulateFailure,
      }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleReplayDlq = async () => {
    await fetch('/api/v1/resilience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REPLAY_DLQ', tenantId: selectedTenantId }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleInspectDlp = async (customPayload?: string) => {
    const payloadToInspect = customPayload ?? dlpInput;
    if (customPayload) setDlpInput(customPayload);
    const res = await fetch('/api/v1/resilience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'INSPECT_DLP',
        tenantId: selectedTenantId,
        payload: payloadToInspect,
      }),
    });
    const data = await res.json();
    setDlpResult(data.inspection);
    await fetchAllData(selectedTenantId);
  };

  const handleExecuteIdempotent = async (customAmount?: number) => {
    const amountToUse = customAmount ?? idemAmountInput;
    if (customAmount !== undefined) setIdemAmountInput(customAmount);
    const res = await fetch('/api/v1/finops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'EXECUTE_IDEMPOTENT',
        tenantId: selectedTenantId,
        idempotencyKey: idemKeyInput,
        amountUsd: amountToUse,
      }),
    });
    const data = await res.json();
    setIdemLastStatus(data.evaluation?.status || null);
    await fetchAllData(selectedTenantId);
  };

  const handleMeterAiInference = async () => {
    await fetch('/api/v1/finops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'METER_AI_INFERENCE',
        tenantId: selectedTenantId,
        modelId: aiModelInput,
        prompt: aiPromptInput,
      }),
    });
    await fetchAllData(selectedTenantId);
  };

  const handleCanaryAction = async (
    action: 'SET_CANARY_WEIGHT' | 'SIMULATE_CANARY_SLO_BREACH' | 'PROMOTE_CANARY',
    weightPercent?: number
  ) => {
    await fetch('/api/v1/finops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        tenantId: selectedTenantId,
        weightPercent,
      }),
    });
    await fetchAllData(selectedTenantId);
  };

  const navItems = [
    {
      id: 'gateway',
      label: 'Edge API Gateway',
      sublabel: 'Rate Limiting & Live Proxy',
      icon: Terminal,
      badge: `${recentTraces.length}`,
    },
    {
      id: 'resilience',
      label: 'Resilience, Webhooks & DLP',
      sublabel: 'Circuit Breakers, DLQ & WAF',
      icon: Globe,
      badge: regions.some((r) => r.state === 'OPEN') ? 'FAILOVER' : '3 REGIONS',
      alert: regions.some((r) => r.state === 'OPEN'),
    },
    {
      id: 'finops',
      label: 'AI FinOps, Idempotency & Canary',
      sublabel: 'Token Metering & Safe Deploys',
      icon: Sparkles,
      badge:
        canaryDeployment?.status === 'AUTO_ROLLED_BACK'
          ? 'ROLLBACK'
          : `$${aiBudget?.currentSpendUsd?.toFixed(2) || '18.42'}`,
      alert: canaryDeployment?.status === 'AUTO_ROLLED_BACK',
    },
    {
      id: 'flags',
      label: 'Feature Rollouts',
      sublabel: 'SHA-256 Sticky Bucketing',
      icon: Flag,
      badge: `${flags.filter((f) => f.enabled).length}/${flags.length}`,
    },
    {
      id: 'audit',
      label: 'Cryptographic Ledger',
      sublabel: 'Tamper-Evident Hash Chain',
      icon: ShieldCheck,
      badge: chainVerification.valid ? 'SEALED' : 'ALERT',
      alert: !chainVerification.valid,
    },
    {
      id: 'keys',
      label: 'Identity & RBAC Keys',
      sublabel: 'Zero-Plaintext SHA-256',
      icon: KeyRound,
      badge: `${apiKeys.filter((k) => k.status === 'ACTIVE').length}`,
    },
    {
      id: 'architecture',
      label: 'System Design & ADRs',
      sublabel: 'Distributed Specs',
      icon: Network,
    },
  ] as const;

  // Build SVG Area Chart coordinates for telemetry
  const chartWidth = 680;
  const chartHeight = 150;
  const maxTraffic = Math.max(
    28,
    ...telemetry.map((t) => t.allowedCount + t.throttledCount)
  );
  const pointsAllowed = telemetry
    .map((pt, i) => {
      const x = (i / Math.max(1, telemetry.length - 1)) * chartWidth;
      const y = chartHeight - (pt.allowedCount / maxTraffic) * (chartHeight - 24) - 10;
      return `${x},${y}`;
    })
    .join(' ');
  const areaAllowed =
    telemetry.length > 0
      ? `0,${chartHeight} ${pointsAllowed} ${chartWidth},${chartHeight}`
      : '';

  return (
    <div className="min-h-screen flex bg-[#05070e] text-slate-100 selection:bg-indigo-500/30">
      {/* Subtle Ambient Background Grid & Glow */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div className="fixed -top-40 left-1/3 w-[560px] h-[320px] bg-indigo-600/10 blur-[140px] pointer-events-none rounded-full" />
      <div className="fixed bottom-0 right-10 w-[420px] h-[280px] bg-cyan-500/5 blur-[130px] pointer-events-none rounded-full" />

      {/* LEFT ENTERPRISE SIDEBAR */}
      <aside className="w-72 shrink-0 border-r border-slate-800/80 bg-[#070a14]/95 backdrop-blur-xl hidden xl:flex flex-col justify-between z-20">
        <div>
          {/* Brand Header */}
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/15">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-white text-sm">
                    AEGIS<span className="text-indigo-400">CLOUD</span>
                  </span>
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    v2.4
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">Enterprise Control Plane</p>
              </div>
            </div>
          </div>

          {/* Active Organization Switcher */}
          <div className="p-4 border-b border-slate-800/80">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">
              Isolated Tenant Context
            </label>
            <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-2.5">
              <select
                aria-label="Select Active Tenant Organization"
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                    {t.name} ({t.tier})
                  </option>
                ))}
              </select>
              {activeTenant && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3 text-cyan-400" />
                    {activeTenant.region}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-bold">
                    {activeTenant.tier}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Primary Navigation */}
          <div className="p-3 space-y-1">
            <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Core Governance Modules
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition group ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600/25 to-cyan-500/10 border border-indigo-500/40 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center transition ${
                        isActive
                          ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                          : 'bg-slate-900 text-slate-400 group-hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="truncate">
                      <div className="text-xs font-semibold leading-tight">{item.label}</div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">
                        {item.sublabel}
                      </div>
                    </div>
                  </div>
                  {'badge' in item && item.badge && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                        'alert' in item && item.alert
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                          : isActive
                          ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/30'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Infrastructure Health Card */}
        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div className="rounded-xl bg-slate-900/60 border border-slate-800/90 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                Cluster Health
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                99.99% SLA
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
              <div className="bg-slate-950/70 rounded-lg p-2 border border-slate-800/60">
                <div className="text-slate-500 text-[10px]">P95 LATENCY</div>
                <div className="text-white font-bold mt-0.5">3.8 ms</div>
              </div>
              <div className="bg-slate-950/70 rounded-lg p-2 border border-slate-800/60">
                <div className="text-slate-500 text-[10px]">HASH ENGINE</div>
                <div className="text-cyan-400 font-bold mt-0.5">SHA-256</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0 z-10">
        {/* Top Utility Bar */}
        <header className="sticky top-0 z-30 h-14 sm:h-16 border-b border-slate-800/80 bg-[#05070e]/90 backdrop-blur-xl px-3.5 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="xl:hidden h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate">
              <span className="font-bold text-white xl:hidden">AEGIS</span>
              <span className="font-mono text-slate-500 hidden sm:inline">aegis-mesh</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              <span className="font-mono text-indigo-400 font-semibold truncate hidden md:inline">
                {activeTenant?.slug || 'apex-fintech'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 hidden md:inline" />
              <span className="text-white font-semibold truncate">
                {navItems.find((n) => n.id === activeTab)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Cryptographic Chain Status Pill */}
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-[11px] sm:text-xs font-mono transition ${
                chainVerification.valid
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                  : 'bg-rose-500/15 border-rose-500/50 text-rose-300 animate-pulse'
              }`}
            >
              {chainVerification.valid ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline">
                    SHA-256 LEDGER VERIFIED ({chainVerification.verifiedEntries} BLOCKS)
                  </span>
                  <span className="sm:hidden">#{chainVerification.verifiedEntries} SEALED</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  <span className="hidden sm:inline">
                    TAMPER ALERT AT BLOCK #{chainVerification.brokenAtSequence}
                  </span>
                  <span className="sm:hidden">TAMPERED</span>
                </>
              )}
            </button>

            {/* Mobile Tenant Switcher */}
            <div className="xl:hidden flex items-center bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5">
              <select
                aria-label="Select Active Tenant Organization"
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="bg-transparent text-[11px] sm:text-xs font-semibold text-white focus:outline-none max-w-[130px] sm:max-w-none truncate"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                    {t.name} ({t.tier})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* Tablet Navigation Bar (sm..xl) */}
        <div className="hidden sm:flex xl:hidden overflow-x-auto gap-2 px-4 py-2.5 border-b border-slate-800/80 bg-[#070a14]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Main Scrollable Content */}
        <main className="max-w-[1400px] w-full mx-auto px-3.5 sm:px-6 pt-4 sm:pt-6 pb-24 sm:pb-8 space-y-5 sm:space-y-6">
          {/* Top Executive KPI Ribbon */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1 */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/70 to-slate-950/90 p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Tenant Isolation Context
                </span>
                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-indigo-400" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <div className="text-lg font-bold text-white tracking-tight">
                    {activeTenant?.name || 'Apex Global FinTech'}
                  </div>
                  <div className="text-xs font-mono text-slate-400 mt-1 flex items-center gap-2">
                    <span>{activeTenant?.region || 'us-east-1'}</span>
                    <span>•</span>
                    <span className="text-indigo-300">
                      {(activeTenant?.requestsThisMonth || 0).toLocaleString()} req/mo
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {activeTenant?.tier || 'ENTERPRISE'}
                </span>
              </div>
            </div>

            {/* Card 2 */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/70 to-slate-950/90 p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Sliding-Window Quota (60s)
                </span>
                <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Gauge className="h-4 w-4 text-cyan-400" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-2xl font-bold font-mono text-white">
                    {rateLimitSnapshot?.remaining ?? '--'}
                    <span className="text-xs font-normal text-slate-400 ml-1.5">
                      / {rateLimitSnapshot?.limit ?? '--'} rem
                    </span>
                  </div>
                  <span className="text-xs font-mono text-cyan-400">
                    w={rateLimitSnapshot?.currentWeight ?? 0}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden mt-2.5 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      (rateLimitSnapshot?.remaining ?? 1) === 0
                        ? 'bg-rose-500'
                        : 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400'
                    }`}
                    style={{
                      width: `${Math.max(
                        6,
                        Math.min(
                          100,
                          (((rateLimitSnapshot?.limit ?? 1) -
                            (rateLimitSnapshot?.remaining ?? 0)) /
                            Math.max(1, rateLimitSnapshot?.limit ?? 1)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/70 to-slate-950/90 p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Deterministic Rollouts
                </span>
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <div className="text-2xl font-bold font-mono text-white">
                    {flags.filter((f) => f.enabled).length}
                    <span className="text-xs font-normal text-slate-400 ml-1.5">
                      / {flags.length} Active Flags
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    SHA-256 Modulo-100 Sticky Buckets
                  </div>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-0.5">
                  0ms DB I/O <ArrowUpRight className="h-3 w-3" />
                </span>
              </div>
            </div>

            {/* Card 4 */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/70 to-slate-950/90 p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Cryptographic Audit Chain
                </span>
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Lock className="h-4 w-4 text-emerald-400" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <div className="text-2xl font-bold font-mono text-white">
                    #{chainVerification.totalEntries}
                    <span className="text-xs font-normal text-slate-400 ml-1.5">
                      Signed Blocks
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 mt-1 truncate max-w-[180px]">
                    Head: {auditEntries[0]?.hash.slice(0, 14) || '000000'}...
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                    chainVerification.valid
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  }`}
                >
                  {chainVerification.valid ? 'SEALED' : 'BROKEN'}
                </span>
              </div>
            </div>
          </section>

          {/* TAB 1: EDGE API GATEWAY & SIMULATOR */}
          {activeTab === 'gateway' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left 5 Cols: Request Dispatch Console + HTTP Response Inspector */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 shadow-xl">
                  <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                        <Zap className="h-4 w-4 text-indigo-400" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-white">
                          Edge Request Dispatch Studio
                        </h2>
                        <p className="text-[11px] text-slate-400">
                          Test RBAC scopes, sliding-window rate limits & flag injection
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={copyCurlCommand}
                      className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 flex items-center gap-1.5 transition"
                      title="Copy equivalent cURL command"
                    >
                      {copiedCurl ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          Copied cURL
                        </>
                      ) : (
                        <>
                          <Code2 className="h-3 w-3 text-indigo-400" />
                          Copy cURL
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Combined Method + Endpoint Bar */}
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                        Target Gateway Endpoint
                      </label>
                      <div className="flex rounded-xl overflow-hidden border border-slate-800 bg-slate-950 focus-within:border-indigo-500/60 transition">
                        <select
                          aria-label="HTTP Method"
                          value={simMethod}
                          onChange={(e) =>
                            setSimMethod(e.target.value as 'POST' | 'GET' | 'PUT' | 'DELETE')
                          }
                          className="bg-slate-900/90 px-3 py-2.5 text-xs font-mono font-bold text-indigo-400 border-r border-slate-800 focus:outline-none"
                        >
                          <option value="POST">POST</option>
                          <option value="GET">GET</option>
                          <option value="PUT">PUT</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                        <select
                          aria-label="Upstream Route"
                          value={simEndpoint}
                          onChange={(e) => setSimEndpoint(e.target.value)}
                          className="flex-1 bg-transparent px-3 py-2.5 text-xs font-mono text-white focus:outline-none"
                        >
                          <option value="/v1/payments/intents" className="bg-slate-900">
                            /v1/payments/intents
                          </option>
                          <option value="/v1/ai/chat/completions" className="bg-slate-900">
                            /v1/ai/chat/completions
                          </option>
                          <option value="/v1/ledger/settlements" className="bg-slate-900">
                            /v1/ledger/settlements
                          </option>
                          <option value="/v1/admin/tenant-export" className="bg-slate-900">
                            /v1/admin/tenant-export
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                          Subject ID (Sticky Hash)
                        </label>
                        <input
                          type="text"
                          value={simSubjectId}
                          onChange={(e) => setSimSubjectId(e.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500/60"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                          Required RBAC Scope
                        </label>
                        <select
                          aria-label="Required RBAC Scope"
                          value={simScope}
                          onChange={(e) => setSimScope(e.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500/60"
                        >
                          <option value="gateway:proxy">gateway:proxy</option>
                          <option value="flags:write">flags:write</option>
                          <option value="keys:manage">keys:manage (Admin)</option>
                          <option value="tenants:admin">tenants:admin (Owner)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                        Evaluate Feature Flag in Edge Header
                      </label>
                      <select
                        aria-label="Evaluate Feature Flag"
                        value={simFlagKey}
                        onChange={(e) => setSimFlagKey(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500/60"
                      >
                        {flags.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.key} ({f.rolloutPercentage}% rollout)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-2 grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5">
                      <button
                        disabled={isSending}
                        onClick={() => fireGatewayRequest(1)}
                        className="col-span-2 sm:flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 active:scale-[0.99] disabled:opacity-50 text-white font-semibold text-xs py-3 sm:py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/25 transition"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Dispatch Request
                      </button>

                      <button
                        disabled={isSending}
                        onClick={() => fireGatewayRequest(10)}
                        className="flex items-center justify-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 active:scale-[0.99] border border-amber-500/40 text-amber-300 font-semibold text-xs py-2.5 px-3.5 rounded-xl transition"
                        title="Send 10 rapid requests to trigger HTTP 429 Sliding-Window Rate Limiting"
                      >
                        <Flame className="h-3.5 w-3.5 text-amber-400" />
                        10× Spike
                      </button>

                      <button
                        onClick={resetRateLimitBucket}
                        className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] border border-slate-800 text-slate-300 text-xs py-2.5 px-3 rounded-xl transition"
                        title="Reset sliding-window quota for this tenant"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset Quota
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live HTTP Response Headers & Payload Inspector */}
                {latestTrace && (
                  <div className="rounded-2xl border border-slate-800/90 bg-[#070a12] overflow-hidden shadow-xl">
                    <div className="px-5 py-3 border-b border-slate-800/90 bg-slate-900/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300 font-semibold">
                          HTTP Edge Response ({latestTrace.requestId})
                        </span>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-md font-mono text-[11px] font-bold border ${
                          latestTrace.statusCode === 200
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : latestTrace.statusCode === 429
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        HTTP/2 {latestTrace.statusCode}{' '}
                        {latestTrace.statusCode === 200
                          ? 'OK'
                          : latestTrace.statusCode === 429
                          ? 'RATE LIMITED'
                          : 'RBAC DENIED'}
                      </span>
                    </div>

                    <div className="p-4 sm:p-5 font-mono text-xs space-y-1.5 leading-relaxed overflow-x-auto">
                      <div className="text-slate-500 text-[11px]">
                        # Standard IETF RateLimit & Cryptographic Governance Headers
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-indigo-400">x-aegis-edge-latency:</span>
                        <span className="text-slate-200">{latestTrace.latencyMs} ms</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-indigo-400">x-ratelimit-limit:</span>
                        <span className="text-slate-200">{latestTrace.rateLimit.limit}</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-indigo-400">x-ratelimit-remaining:</span>
                        <span className="text-slate-200">{latestTrace.rateLimit.remaining}</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-indigo-400">x-sliding-window-weight:</span>
                        <span className="text-cyan-300">{latestTrace.rateLimit.currentWeight}</span>
                      </div>
                      {latestTrace.flagEvaluation && (
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="text-cyan-400 break-all">
                            x-feature-flag-{latestTrace.flagEvaluation.flagKey}:
                          </span>
                          <span
                            className={
                              latestTrace.flagEvaluation.value
                                ? 'text-emerald-400 font-bold'
                                : 'text-slate-400'
                            }
                          >
                            {String(latestTrace.flagEvaluation.value)} (
                            {latestTrace.flagEvaluation.reason} • b=
                            {latestTrace.flagEvaluation.bucketScore})
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap justify-between gap-2 pt-1 border-t border-slate-800/80">
                        <span className="text-emerald-400">x-audit-sha256-seal:</span>
                        <span className="text-emerald-300 break-all">
                          #{latestTrace.auditSequence} • {latestTrace.auditHash.slice(0, 18)}...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right 7 Cols: High-Precision SVG Telemetry Graph + Live Request Stream */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                {/* SVG Area & Bar Hybrid Chart */}
                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Activity className="h-4 w-4 text-cyan-400" />
                        Real-Time Edge Throughput & Rate-Limit Telemetry
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Sliding-window counter interpolation across 5-second edge windows
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        200 OK
                      </span>
                      <span className="flex items-center gap-1.5 text-amber-400">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                        429 Throttled
                      </span>
                    </div>
                  </div>

                  {/* SVG Smooth Area Chart */}
                  <div className="relative h-40 w-full pt-2">
                    <svg
                      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                      className="w-full h-full overflow-visible"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id="emeraldArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Grid Lines */}
                      {[0.2, 0.5, 0.8].map((ratio, idx) => (
                        <line
                          key={idx}
                          x1={0}
                          y1={chartHeight * ratio}
                          x2={chartWidth}
                          y2={chartHeight * ratio}
                          stroke="#1e293b"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                      ))}

                      {/* Area Under Allowed Curve */}
                      {areaAllowed && <polygon points={areaAllowed} fill="url(#emeraldArea)" />}

                      {/* Allowed Traffic Line */}
                      {pointsAllowed && (
                        <polyline
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2.5"
                          points={pointsAllowed}
                        />
                      )}

                      {/* Data Nodes & Throttled Indicators */}
                      {telemetry.map((pt, i) => {
                        const x = (i / Math.max(1, telemetry.length - 1)) * chartWidth;
                        const y =
                          chartHeight -
                          (pt.allowedCount / maxTraffic) * (chartHeight - 24) -
                          10;
                        return (
                          <g key={i}>
                            <circle
                              cx={x}
                              cy={y}
                              r="3.5"
                              fill="#05070e"
                              stroke="#10b981"
                              strokeWidth="2"
                            />
                            {pt.throttledCount > 0 && (
                              <circle
                                cx={x}
                                cy={Math.max(12, y - 16)}
                                r="5"
                                fill="#f59e0b"
                                stroke="#05070e"
                                strokeWidth="1.5"
                              />
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* X-Axis Timestamps */}
                  <div className="flex justify-between pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500">
                    {telemetry.map((pt, i) => (
                      <span key={i}>{pt.timestamp.slice(3)}</span>
                    ))}
                  </div>
                </div>

                {/* Live Gateway Request Trace Stream */}
                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 overflow-hidden shadow-xl flex-1">
                  <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-sm font-bold text-white">
                        Live Gateway Execution Trace Stream
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      Click any row to inspect headers ({recentTraces.length} events)
                    </span>
                  </div>

                  <div className="overflow-x-auto max-h-[340px]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-950/70">
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Method & Upstream Route</th>
                          <th className="py-3 px-4">Tenant</th>
                          <th className="py-3 px-4">Quota Rem.</th>
                          <th className="py-3 px-4">Flag Evaluation</th>
                          <th className="py-3 px-4">SHA-256 Block</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 font-mono">
                        {recentTraces.map((tr) => {
                          const isSelected = latestTrace?.requestId === tr.requestId;
                          return (
                            <tr
                              key={tr.requestId}
                              onClick={() => setLatestTrace(tr)}
                              className={`cursor-pointer transition ${
                                isSelected
                                  ? 'bg-indigo-500/10'
                                  : 'hover:bg-slate-800/40'
                              }`}
                            >
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                                    tr.statusCode === 200
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : tr.statusCode === 429
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                  }`}
                                >
                                  {tr.statusCode}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-slate-200">
                                <span className="text-indigo-400 font-bold mr-2">
                                  {tr.method}
                                </span>
                                {tr.endpoint}
                              </td>
                              <td className="py-3 px-4 text-slate-400">{tr.tenantId}</td>
                              <td className="py-3 px-4 text-slate-300">
                                {tr.rateLimit.remaining}/{tr.rateLimit.limit}
                              </td>
                              <td className="py-3 px-4">
                                {tr.flagEvaluation ? (
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] ${
                                      tr.flagEvaluation.value
                                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {tr.flagEvaluation.value ? 'TRUE' : 'FALSE'} • b=
                                    {tr.flagEvaluation.bucketScore}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-emerald-400">
                                #{tr.auditSequence} ({tr.auditHash.slice(0, 8)})
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1.5: MULTI-REGION CIRCUIT BREAKERS, SIGNED WEBHOOK DLQ & ZERO-TRUST DLP */}
          {activeTab === 'resilience' && (
            <div className="space-y-6">
              {/* Row 1: Multi-Region Circuit Breakers & Failover Mesh */}
              <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <Globe className="h-4 w-4 text-cyan-400" />
                      Multi-Region Circuit Breakers & Automatic Failover Mesh
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Trip a regional cluster to <code className="text-rose-300">OPEN</code> to
                      watch traffic automatically fail over to healthy sovereign regions.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {regions.map((r) => (
                    <div
                      key={r.region}
                      className={`rounded-xl border p-4 flex flex-col justify-between gap-4 transition ${
                        r.state === 'CLOSED'
                          ? 'border-slate-800 bg-slate-950/70'
                          : r.state === 'HALF_OPEN'
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : 'border-rose-500/50 bg-rose-500/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-white">
                            {r.region}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                              r.state === 'CLOSED'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : r.state === 'HALF_OPEN'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                            }`}
                          >
                            CIRCUIT: {r.state}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">{r.name}</div>

                        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800/80 font-mono text-xs">
                          <div>
                            <div className="text-[10px] text-slate-500">P95 LATENCY</div>
                            <div
                              className={
                                r.state === 'OPEN'
                                  ? 'text-rose-400 font-bold'
                                  : 'text-emerald-400 font-bold'
                              }
                            >
                              {r.p95LatencyMs} ms
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500">ERROR RATE</div>
                            <div
                              className={
                                r.state === 'OPEN' ? 'text-rose-400 font-bold' : 'text-slate-200'
                              }
                            >
                              {r.errorRatePercent}%
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2">
                        {r.state === 'CLOSED' ? (
                          <button
                            onClick={() => handleRegionAction('TRIP_REGION', r.region)}
                            className="w-full py-2 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition"
                          >
                            Simulate Outage (Trip OPEN)
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRegionAction('HALF_OPEN_REGION', r.region)}
                              className="flex-1 py-2 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition"
                            >
                              Probe (HALF_OPEN)
                            </button>
                            <button
                              onClick={() => handleRegionAction('RECOVER_REGION', r.region)}
                              className="flex-1 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                            >
                              Restore (CLOSED)
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Row 2: Signed Webhook Outbox & DLQ + Edge DLP & WAF Scrubber */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left 7 Cols: Signed Webhook Outbox & Dead-Letter Queue */}
                <div className="lg:col-span-7 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl flex flex-col justify-between">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Zap className="h-4 w-4 text-indigo-400" />
                          Signed Webhook Outbox & Dead-Letter Queue (DLQ)
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Payloads signed with <code className="text-indigo-300">HMAC-SHA256</code>{' '}
                          and retried with exponential backoff
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleDispatchWebhook(false)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                        >
                          + Emit Event (200)
                        </button>
                        <button
                          onClick={() => handleDispatchWebhook(true)}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition"
                        >
                          Simulate 503 Timeout
                        </button>
                        <button
                          onClick={handleReplayDlq}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition"
                        >
                          Replay DLQ
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/60">
                            <th className="py-2.5 px-3">State</th>
                            <th className="py-2.5 px-3">Event Type</th>
                            <th className="py-2.5 px-3">Attempts & Backoff</th>
                            <th className="py-2.5 px-3">HMAC-SHA256 Signature</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {webhooks.map((wh) => (
                            <tr key={wh.id} className="hover:bg-slate-800/30">
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    wh.status === 'DELIVERED'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : wh.status === 'RETRY_SCHEDULED'
                                      ? 'bg-amber-500/15 text-amber-300'
                                      : 'bg-rose-500/20 text-rose-300'
                                  }`}
                                >
                                  {wh.status} (HTTP {wh.lastHttpStatus})
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-200">{wh.eventType}</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                {wh.attemptCount}/{wh.maxAttempts}{' '}
                                {wh.nextRetryDelaySeconds > 0 &&
                                  `• next in ${wh.nextRetryDelaySeconds}s`}
                              </td>
                              <td className="py-2.5 px-3 text-indigo-300 text-[11px] truncate max-w-[160px]">
                                {wh.hmacSignature.slice(0, 26)}...
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Right 5 Cols: Zero-Trust Edge PII Redaction & WAF Inspector */}
                <div className="lg:col-span-5 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Lock className="h-4 w-4 text-emerald-400" />
                      Zero-Trust Edge DLP & OWASP WAF Scrubber
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Automatically masks Credit Cards, SSNs, Emails, and Bearer Tokens at the edge,
                      and blocks SQLi/XSS payloads before they hit PostgreSQL.
                    </p>

                    <div className="mt-3 space-y-2.5">
                      <textarea
                        rows={3}
                        value={dlpInput}
                        onChange={(e) => setDlpInput(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500/60"
                      />

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleInspectDlp()}
                          className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                        >
                          Run DLP & WAF Inspection
                        </button>
                        <button
                          onClick={() =>
                            handleInspectDlp(
                              "SELECT * FROM tenants WHERE slug = 'apex' UNION SELECT credit_card FROM users --"
                            )
                          }
                          className="py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition"
                        >
                          Test SQLi Attack
                        </button>
                      </div>
                    </div>

                    {dlpResult && (
                      <div className="mt-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950 font-mono text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Edge WAF Verdict:</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              dlpResult.wafBlocked
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {dlpResult.wafBlocked
                              ? 'BLOCKED (OWASP CRS MATCH)'
                              : `PASSED (${dlpResult.redactedCount} PII REDACTED)`}
                          </span>
                        </div>
                        {dlpResult.detectedTypes.length > 0 && (
                          <div className="text-[11px] text-cyan-300">
                            Redacted PII: {dlpResult.detectedTypes.join(', ')}
                          </div>
                        )}
                        <div className="text-[11px] text-emerald-300 break-all bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                          {dlpResult.sanitizedPayload}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1.8: AI FINOPS TOKEN GOVERNOR, IDEMPOTENCY ENGINE & CANARY TRAFFIC SPLITTER */}
          {activeTab === 'finops' && (
            <div className="space-y-6">
              {/* Row 1: Progressive Canary Traffic Splitter & Auto-Rollback Engine */}
              {canaryDeployment && (
                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-indigo-400" />
                        <h2 className="text-sm font-bold text-white">
                          Progressive Canary Traffic Splitter & Automated SLO Rollback
                        </h2>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                            canaryDeployment.status === 'CANARY_PROMOTED'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : canaryDeployment.status === 'AUTO_ROLLED_BACK'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                          }`}
                        >
                          {canaryDeployment.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Service: <strong className="text-slate-200">{canaryDeployment.serviceName}</strong>{' '}
                        • Auto-Rollback SLO Threshold:{' '}
                        <code className="text-rose-300">
                          &gt;{canaryDeployment.autoRollbackThresholdPercent}% Error Rate
                        </code>
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleCanaryAction('SIMULATE_CANARY_SLO_BREACH')}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition"
                      >
                        Simulate Canary 6.8% Error Spike (Trigger Auto-Rollback)
                      </button>
                      <button
                        onClick={() => handleCanaryAction('PROMOTE_CANARY')}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                      >
                        Promote Canary to 100%
                      </button>
                    </div>
                  </div>

                  {/* Visual Stable vs Canary Split Bar */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-indigo-300">
                        STABLE ({canaryDeployment.stableVersion}):{' '}
                        <strong>{100 - canaryDeployment.canaryWeightPercent}%</strong> (p95:{' '}
                        {canaryDeployment.stableMetrics.p95LatencyMs}ms • err:{' '}
                        {canaryDeployment.stableMetrics.errorRatePercent}%)
                      </span>
                      <span className="text-cyan-300">
                        CANARY ({canaryDeployment.canaryVersion}):{' '}
                        <strong>{canaryDeployment.canaryWeightPercent}%</strong> (p95:{' '}
                        {canaryDeployment.canaryMetrics.p95LatencyMs}ms • err:{' '}
                        {canaryDeployment.canaryMetrics.errorRatePercent}%)
                      </span>
                    </div>

                    <div className="w-full h-3 rounded-full bg-slate-900 overflow-hidden flex border border-slate-800">
                      <div
                        style={{ width: `${100 - canaryDeployment.canaryWeightPercent}%` }}
                        className="bg-indigo-600 transition-all duration-300"
                      />
                      <div
                        style={{ width: `${canaryDeployment.canaryWeightPercent}%` }}
                        className="bg-cyan-400 transition-all duration-300"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">Adjust Canary Split Weight:</span>
                      {[0, 10, 25, 50, 75, 100].map((w) => (
                        <button
                          key={w}
                          onClick={() => handleCanaryAction('SET_CANARY_WEIGHT', w)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono transition ${
                            canaryDeployment.canaryWeightPercent === w
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                          }`}
                        >
                          {w}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Row 2: AI Token Metering & Semantic Cache + Stripe-Grade Idempotency Engine */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left 6 Cols: AI Token Metering, Semantic Cache & FinOps Budget Governor */}
                <div className="lg:col-span-6 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-amber-400" />
                          AI Token Metering, Semantic Cache & FinOps Budget
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Send the same prompt twice to see an edge{' '}
                          <strong className="text-emerald-300">Semantic Cache Hit ($0.00)</strong>
                        </p>
                      </div>
                      {aiBudget && (
                        <div className="text-right font-mono">
                          <div className="text-xs font-bold text-white">
                            ${aiBudget.currentSpendUsd.toFixed(4)} / $
                            {aiBudget.monthlyBudgetUsd.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            {aiBudget.semanticCacheHits} Semantic Cache Hits
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 mt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          aria-label="Select AI Model"
                          value={aiModelInput}
                          onChange={(e) => setAiModelInput(e.target.value)}
                          className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                        >
                          <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
                          <option value="gpt-4o-enterprise">gpt-4o-enterprise</option>
                          <option value="gemini-2-5-pro">gemini-2-5-pro</option>
                        </select>
                        <input
                          type="text"
                          value={aiPromptInput}
                          onChange={(e) => setAiPromptInput(e.target.value)}
                          className="sm:col-span-2 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>

                      <button
                        onClick={handleMeterAiInference}
                        className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                      >
                        Execute Metered LLM Inference (Test Semantic Cache)
                      </button>
                    </div>

                    <div className="mt-4 overflow-x-auto max-h-[210px]">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 bg-slate-950/60">
                            <th className="py-2 px-2.5">Model</th>
                            <th className="py-2 px-2.5">Tokens (In/Out)</th>
                            <th className="py-2 px-2.5">Cost</th>
                            <th className="py-2 px-2.5">Cache</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {aiExecutions.map((ex) => (
                            <tr key={ex.id}>
                              <td className="py-2 px-2.5 text-slate-200">{ex.modelId}</td>
                              <td className="py-2 px-2.5 text-slate-400">
                                {ex.inputTokens}/{ex.outputTokens}
                              </td>
                              <td className="py-2 px-2.5 text-emerald-400">
                                ${ex.costUsd.toFixed(5)}
                              </td>
                              <td className="py-2 px-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    ex.semanticCacheHit
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {ex.semanticCacheHit ? 'HIT (2.1ms)' : `MISS (${ex.latencyMs}ms)`}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Right 6 Cols: Stripe-Grade RFC Idempotency Key Engine */}
                <div className="lg:col-span-6 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-xl flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Lock className="h-4 w-4 text-cyan-400" />
                          Stripe-Grade Idempotency-Key Engine (Zero Double-Charge)
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Prevents duplicate financial settlements during client network retries
                        </p>
                      </div>
                      {idemLastStatus && (
                        <span
                          className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded border ${
                            idemLastStatus === 'EXECUTED_FRESH'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : idemLastStatus === 'REPLAYED_FROM_CACHE'
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          {idemLastStatus}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Idempotency-Key Header
                        </label>
                        <input
                          type="text"
                          value={idemKeyInput}
                          onChange={(e) => setIdemKeyInput(e.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Settlement Amount (USD)
                        </label>
                        <input
                          type="number"
                          value={idemAmountInput}
                          onChange={(e) => setIdemAmountInput(Number(e.target.value))}
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        onClick={() => handleExecuteIdempotent()}
                        className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                      >
                        Send / Retry Idempotent Transfer
                      </button>
                      <button
                        onClick={() => handleExecuteIdempotent(999999)}
                        className="py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition"
                        title="Send same Idempotency-Key with a different amount to trigger HTTP 422 Conflict"
                      >
                        Test 422 Payload Conflict
                      </button>
                    </div>

                    <div className="mt-4 overflow-x-auto max-h-[210px]">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 bg-slate-950/60">
                            <th className="py-2 px-2.5">Idempotency Key</th>
                            <th className="py-2 px-2.5">SHA-256 Payload</th>
                            <th className="py-2 px-2.5">Replays</th>
                            <th className="py-2 px-2.5">Cached Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {idempotencyRecords.map((rec) => (
                            <tr key={`${rec.tenantId}:${rec.idempotencyKey}`}>
                              <td className="py-2 px-2.5 text-indigo-300">{rec.idempotencyKey}</td>
                              <td className="py-2 px-2.5 text-slate-400">
                                {rec.payloadHash.slice(0, 12)}...
                              </td>
                              <td className="py-2 px-2.5 text-cyan-300 font-bold">
                                {rec.replayCount}×
                              </td>
                              <td className="py-2 px-2.5 text-emerald-300 truncate max-w-[160px]">
                                {JSON.stringify(rec.responseBody)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FEATURE FLAG & ROLLOUT ENGINE */}
          {activeTab === 'flags' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                {flags.map((flag) => (
                  <div
                    key={flag.key}
                    className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 flex flex-col gap-4 shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-sm font-bold text-indigo-300">
                            {flag.key}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                              flag.enabled
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {flag.enabled ? 'ACTIVE' : 'DISABLED'}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-white mt-1">{flag.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{flag.description}</p>
                      </div>

                      <button
                        onClick={() => handleUpdateFlag(flag, { enabled: !flag.enabled })}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                          flag.enabled
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                      >
                        {flag.enabled ? 'Disable Flag' : 'Enable Flag'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800/70">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-slate-400">
                            Progressive Rollout Percentage (SHA-256 Bucket)
                          </span>
                          <span className="font-mono font-bold text-cyan-400">
                            {flag.rolloutPercentage}%
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label={`Rollout percentage for ${flag.name}`}
                          min={0}
                          max={100}
                          step={5}
                          value={flag.rolloutPercentage}
                          onChange={(e) =>
                            handleUpdateFlag(flag, {
                              rolloutPercentage: Number(e.target.value),
                            })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-col justify-between">
                        <span className="text-xs text-slate-400">
                          Targeting Rules & Tenant Allowlists
                        </span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {flag.targetTenants.map((t) => (
                            <span
                              key={t}
                              className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                            >
                              Tenant: {t}
                            </span>
                          ))}
                          {flag.rules.map((r) => (
                            <span
                              key={r.id}
                              className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                            >
                              {r.attribute} {r.operator} [{r.values.join(',')}]
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Column: Deterministic Bucketing Sandbox */}
              <div className="lg:col-span-4">
                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 sticky top-24 shadow-xl">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-cyan-400" />
                    Deterministic Bucketing Sandbox
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Test how any <code className="text-indigo-300">subjectId</code> hashes into a
                    sticky 0–99 bucket using{' '}
                    <code className="text-indigo-300">SHA256(flagKey + subjectId) mod 100</code>.
                  </p>

                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                        Subject / Customer Identifier
                      </label>
                      <input
                        type="text"
                        value={evalSubject}
                        onChange={(e) => setEvalSubject(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <span className="block text-[10px] font-mono uppercase text-slate-400">
                        Click a Flag to Evaluate
                      </span>
                      {flags.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => handleEvaluateFlag(f.key)}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-indigo-500/50 text-xs font-mono flex items-center justify-between transition"
                        >
                          <span className="text-slate-200">{f.key}</span>
                          <span className="text-indigo-400">Evaluate →</span>
                        </button>
                      ))}
                    </div>

                    {evalResult && (
                      <div className="mt-4 p-4 rounded-xl border border-slate-800 bg-slate-950 font-mono text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Flag:</span>
                          <span className="text-white font-bold">{evalResult.flagKey}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Resolved Variant:</span>
                          <span
                            className={
                              evalResult.value
                                ? 'text-emerald-400 font-bold'
                                : 'text-rose-400 font-bold'
                            }
                          >
                            {String(evalResult.value).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Resolution Reason:</span>
                          <span className="text-cyan-300">{evalResult.reason}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Sticky Bucket Score:</span>
                          <span className="text-indigo-300">{evalResult.bucketScore} / 100</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SHA-256 TAMPER-EVIDENT AUDIT LEDGER */}
          {activeTab === 'audit' && (
            <div className="flex flex-col gap-5">
              {/* Integrity Verification Banner & Chaos Controls */}
              <div
                className={`rounded-2xl border p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                  chainVerification.valid
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-rose-500/50 bg-rose-500/10'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {chainVerification.valid ? (
                    <ShieldCheck className="h-7 w-7 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-7 w-7 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      {chainVerification.valid
                        ? `Cryptographic Hash Chain Verified (${chainVerification.verifiedEntries}/${chainVerification.totalEntries} Blocks Intact)`
                        : `CRITICAL SECURITY ALERT: Cryptographic Audit Chain Broken at Sequence #${chainVerification.brokenAtSequence}`}
                    </h2>
                    <p className="text-xs text-slate-300 mt-1">
                      {chainVerification.valid
                        ? 'Every audit log entry is cryptographically chained to its predecessor using HMAC-SHA256(sequence | timestamp | actor | action | canonicalMetadata | previousHash).'
                        : chainVerification.reason}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {chainVerification.valid ? (
                    <button
                      onClick={handleSimulateTamper}
                      className="px-4 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold transition flex items-center gap-1.5"
                    >
                      <ShieldAlert className="h-4 w-4 text-rose-400" />
                      Simulate Rogue DB Tampering Attack
                    </button>
                  ) : (
                    <button
                      onClick={handleResealChain}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/25"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Re-Compute & Seal Hash Chain
                    </button>
                  )}
                </div>
              </div>

              {/* Hash Chain Ledger Table */}
              <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/70 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="py-3.5 px-4">Seq</th>
                        <th className="py-3.5 px-4">Timestamp</th>
                        <th className="py-3.5 px-4">Tenant & Actor</th>
                        <th className="py-3.5 px-4">Action & Resource</th>
                        <th className="py-3.5 px-4">Cryptographic Hash Link (Prev → Current)</th>
                        <th className="py-3.5 px-4">Payload Metadata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {auditEntries.map((entry) => {
                        const isBrokenBlock =
                          !chainVerification.valid &&
                          chainVerification.brokenAtSequence === entry.sequence;
                        return (
                          <tr
                            key={entry.id}
                            className={
                              isBrokenBlock
                                ? 'bg-rose-500/15 border-l-4 border-l-rose-500'
                                : 'hover:bg-slate-800/30'
                            }
                          >
                            <td className="py-3 px-4 font-bold text-indigo-400">
                              #{entry.sequence}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-slate-200">{entry.tenantId}</div>
                              <div className="text-[10px] text-slate-500">
                                {entry.actorType}: {entry.actorId}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5 ${
                                  entry.severity === 'CRITICAL'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : entry.severity === 'WARN'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-indigo-500/15 text-indigo-300'
                                }`}
                              >
                                {entry.action}
                              </span>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {entry.resource}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[11px]">
                              <div className="text-slate-500">
                                Prev: {entry.previousHash.slice(0, 16)}...
                              </div>
                              <div
                                className={
                                  isBrokenBlock
                                    ? 'text-rose-400 font-bold'
                                    : 'text-emerald-400'
                                }
                              >
                                Curr: {entry.hash.slice(0, 16)}...
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[11px] text-slate-300 max-w-xs truncate">
                              {JSON.stringify(entry.metadata)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MULTI-TENANT RBAC & API KEYS */}
          {activeTab === 'keys' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                {newlyIssuedSecret && (
                  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold text-emerald-300 uppercase font-mono">
                        New API Key Secret Provisioned (Shown Once Only — Stored as SHA-256 Hash)
                      </span>
                      <p className="font-mono text-sm text-white mt-1 break-all">
                        {newlyIssuedSecret}
                      </p>
                    </div>
                    <button
                      onClick={() => copySecret(newlyIssuedSecret)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
                    >
                      {copiedKey ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedKey ? 'Copied' : 'Copy Key'}
                    </button>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 overflow-hidden shadow-xl">
                  <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">
                      Provisioned Multi-Tenant API Keys (Zero Plaintext Storage)
                    </h3>
                    <span className="text-xs font-mono text-slate-400">
                      SHA-256 Key Digest Verification
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                          <th className="py-3.5 px-4">Name & Prefix</th>
                          <th className="py-3.5 px-4">Tenant</th>
                          <th className="py-3.5 px-4">RBAC Role & Scopes</th>
                          <th className="py-3.5 px-4">SHA-256 Digest</th>
                          <th className="py-3.5 px-4">Status</th>
                          <th className="py-3.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {apiKeys.map((k) => (
                          <tr key={k.id} className="hover:bg-slate-800/30">
                            <td className="py-3 px-4">
                              <div className="font-sans font-semibold text-white">{k.name}</div>
                              <div className="text-[11px] text-indigo-400">{k.prefix}</div>
                            </td>
                            <td className="py-3 px-4 text-slate-300">{k.tenantId}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-bold">
                                {k.role}
                              </span>
                              <div className="text-[10px] text-slate-400 mt-1 max-w-[220px] truncate">
                                {k.scopes.join(', ')}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-400 text-[11px]">
                              {k.keyHash.slice(0, 16)}...
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  k.status === 'ACTIVE'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {k.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {k.status === 'ACTIVE' && (
                                <button
                                  onClick={() => handleRevokeKey(k.id)}
                                  className="text-rose-400 hover:text-rose-300 text-xs underline"
                                >
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4">
                <form
                  onSubmit={handleCreateApiKey}
                  className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 space-y-4 shadow-xl"
                >
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-indigo-400" />
                    Issue Scoped API Key
                  </h3>
                  <p className="text-xs text-slate-400">
                    Keys are generated with high-entropy CSPRNG bytes and only their SHA-256 hash is
                    persisted.
                  </p>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                      Key Description / Workload Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., EU Settlement Worker"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                      RBAC Role Assignment
                    </label>
                    <select
                      aria-label="RBAC Role Assignment"
                      value={newKeyRole}
                      onChange={(e) =>
                        setNewKeyRole(
                          e.target.value as
                            | 'OWNER'
                            | 'ADMIN'
                            | 'DEVELOPER'
                            | 'AUDITOR'
                            | 'SERVICE_CLIENT'
                        )
                      }
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs font-mono text-white"
                    >
                      <option value="OWNER">OWNER (All Scopes + Tenant Admin)</option>
                      <option value="ADMIN">ADMIN (Gateway, Flags, Keys, Audit)</option>
                      <option value="DEVELOPER">DEVELOPER (Gateway + Flags Write)</option>
                      <option value="AUDITOR">AUDITOR (Read-Only Audit & Verify)</option>
                      <option value="SERVICE_CLIENT">SERVICE_CLIENT (Gateway Proxy Only)</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shadow-lg shadow-indigo-600/20"
                  >
                    Generate Cryptographic API Key
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: SYSTEM ARCHITECTURE & ADRs */}
          {activeTab === 'architecture' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 space-y-3 shadow-xl">
                <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs uppercase">
                  <Server className="h-4 w-4" />
                  ADR-001: Sliding-Window Counter Rate Limiting
                </div>
                <h3 className="text-sm font-bold text-white">
                  O(1) Memory Footprint with Boundary Burst Protection
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Fixed-window counters suffer from 2x boundary traffic spikes, while pure rolling
                  logs require O(N) sorted-set memory per user. AegisCloud implements the{' '}
                  <strong>Sliding Window Counter</strong> algorithm used by Cloudflare and Envoy:
                </p>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-300 overflow-x-auto">
                  {`elapsed = (now - currWindowStart) / windowMs
weight  = prevCount * (1 - elapsed) + currCount
allowed = (weight + cost) <= limit * burstFactor`}
                </pre>
              </div>

              <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 space-y-3 shadow-xl">
                <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase">
                  <Flag className="h-4 w-4" />
                  ADR-002: Stateless Deterministic Flag Bucketing
                </div>
                <h3 className="text-sm font-bold text-white">
                  Zero-Database-Lookup Progressive Rollouts
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  To guarantee that a customer always receives a consistent feature variant across
                  horizontally scaled gateway nodes without querying PostgreSQL on every request, we
                  compute a deterministic 32-bit integer slice from the SHA-256 digest:
                </p>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-indigo-300 overflow-x-auto">
                  {`digest = SHA256(flagKey + ":" + tenantId + ":" + subjectId)
bucket = digest.readUInt32BE(0) % 100
serve  = bucket < flag.rolloutPercentage`}
                </pre>
              </div>

              <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-6 space-y-3 shadow-xl">
                <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs uppercase">
                  <ShieldCheck className="h-4 w-4" />
                  ADR-003: Tamper-Evident SHA-256 Audit Ledger
                </div>
                <h3 className="text-sm font-bold text-white">
                  Cryptographic Hash Chaining for SOC2 / PCI-DSS Compliance
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Standard SQL audit tables can be silently altered by a compromised DBA account.
                  Every AegisCloud audit event includes the{' '}
                  <code className="text-emerald-300">previousHash</code> and canonical JSON metadata
                  digest. Modifying any historical row invalidates every subsequent signature in the
                  chain.
                </p>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                  {`blockHash = HMAC_SHA256(
  secret,
  seq | ts | tenant | actor | action | meta | prevHash
)`}
                </pre>
              </div>
            </div>
          )}
        </main>

        {/* Mobile Fixed Bottom Navigation Dock (sm:hidden) */}
        <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#070a14]/95 backdrop-blur-xl border-t border-slate-800/90 px-1 py-1.5 flex items-center justify-around">
          {[
            { id: 'gateway', shortLabel: 'Gateway', icon: Terminal },
            {
              id: 'resilience',
              shortLabel: 'Failover',
              icon: Globe,
              alert: regions.some((r) => r.state === 'OPEN'),
            },
            {
              id: 'finops',
              shortLabel: 'FinOps',
              icon: Sparkles,
              alert: canaryDeployment?.status === 'AUTO_ROLLED_BACK',
            },
            { id: 'flags', shortLabel: 'Flags', icon: Flag },
            {
              id: 'audit',
              shortLabel: 'Ledger',
              icon: ShieldCheck,
              alert: !chainVerification.valid,
            },
            { id: 'keys', shortLabel: 'Keys', icon: KeyRound },
            { id: 'architecture', shortLabel: 'ADRs', icon: Network },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition ${
                  isActive ? 'text-indigo-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.alert && (
                  <span className="absolute top-1 right-2 h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                )}
                <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span className="text-[10px] font-medium mt-0.5">{tab.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
