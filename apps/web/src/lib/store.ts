import {
  AuditLedger,
  SlidingWindowRateLimiter,
  FeatureFlagEngine,
  ApiKeyRecord,
  generateApiKey,
  hashApiKey,
  hasScope,
  PermissionScope,
  RoleName,
  FeatureFlagConfig,
  MultiRegionCircuitBreaker,
  WebhookDispatcher,
} from '@aegis/core';

export interface TenantOrganization {
  id: string;
  name: string;
  slug: string;
  tier: 'FREE' | 'PRO' | 'ENTERPRISE';
  region: 'us-east-1' | 'eu-central-1' | 'ap-south-1';
  rateLimitPerMinute: number;
  burstFactor: number;
  monthlyQuota: number;
  requestsThisMonth: number;
}

export interface GatewayTelemetryPoint {
  timestamp: string;
  allowedCount: number;
  throttledCount: number;
  p95LatencyMs: number;
}

export interface GatewayExecutionTrace {
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

class EnterpriseControlPlaneStore {
  public readonly ledger: AuditLedger;
  public readonly rateLimiter: SlidingWindowRateLimiter;
  public readonly flagEngine: FeatureFlagEngine;
  public readonly circuitBreaker: MultiRegionCircuitBreaker;
  public readonly webhookDispatcher: WebhookDispatcher;
  public tenants: Map<string, TenantOrganization> = new Map();
  public apiKeys: Map<string, ApiKeyRecord> = new Map();
  public demoRawKeys: Record<string, string> = {};
  public recentTraces: GatewayExecutionTrace[] = [];
  public telemetry: GatewayTelemetryPoint[] = [];

  constructor() {
    this.ledger = new AuditLedger([], 'aegis-production-hmac-key-2026');
    this.rateLimiter = new SlidingWindowRateLimiter();
    this.flagEngine = new FeatureFlagEngine();
    this.circuitBreaker = new MultiRegionCircuitBreaker();
    this.webhookDispatcher = new WebhookDispatcher();
    this.seedInitialEnterpriseData();
  }

  private seedInitialEnterpriseData() {
    const initialTenants: TenantOrganization[] = [
      {
        id: 'tenant_stripe_fin',
        name: 'Apex Global FinTech',
        slug: 'apex-fintech',
        tier: 'ENTERPRISE',
        region: 'us-east-1',
        rateLimitPerMinute: 25,
        burstFactor: 1.2,
        monthlyQuota: 5_000_000,
        requestsThisMonth: 1_842_910,
      },
      {
        id: 'tenant_medcore_ai',
        name: 'MedCore Diagnostics AI',
        slug: 'medcore-ai',
        tier: 'PRO',
        region: 'eu-central-1',
        rateLimitPerMinute: 12,
        burstFactor: 1.0,
        monthlyQuota: 1_000_000,
        requestsThisMonth: 412_300,
      },
      {
        id: 'tenant_orbital_dev',
        name: 'Orbital Cloud Sandbox',
        slug: 'orbital-dev',
        tier: 'FREE',
        region: 'ap-south-1',
        rateLimitPerMinute: 6,
        burstFactor: 1.0,
        monthlyQuota: 100_000,
        requestsThisMonth: 88_420,
      },
    ];

    for (const t of initialTenants) {
      this.tenants.set(t.id, t);
    }

    // Seed deterministic demo API keys so the interactive simulator works out-of-the-box
    const seededKeys: Array<{
      tenantId: string;
      name: string;
      role: RoleName;
      rateLimitPerMinute: number;
      customRawKey: string;
    }> = [
      {
        tenantId: 'tenant_stripe_fin',
        name: 'Apex Production Gateway Mesh',
        role: 'OWNER',
        rateLimitPerMinute: 25,
        customRawKey: 'aegis_live_apexfin_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
      },
      {
        tenantId: 'tenant_medcore_ai',
        name: 'MedCore EU Inference Worker',
        role: 'DEVELOPER',
        rateLimitPerMinute: 12,
        customRawKey: 'aegis_live_medcore_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
      },
      {
        tenantId: 'tenant_orbital_dev',
        name: 'Orbital Read-Only Auditor Key',
        role: 'AUDITOR',
        rateLimitPerMinute: 6,
        customRawKey: 'aegis_live_orbital_7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c',
      },
    ];

    for (const k of seededKeys) {
      const issued = generateApiKey(k);
      this.apiKeys.set(issued.record.id, issued.record);
      this.demoRawKeys[k.tenantId] = issued.rawKey;
    }

    // Seed Enterprise Feature Flags
    const initialFlags: FeatureFlagConfig[] = [
      {
        key: 'llm-multi-region-failover',
        name: 'Multi-Region LLM Failover Routing',
        description:
          'Automatically fails over inference traffic between us-east-1 and eu-central-1 when upstream p99 latency exceeds 450ms.',
        enabled: true,
        rolloutPercentage: 50,
        targetTenants: ['tenant_stripe_fin'],
        rules: [
          {
            id: 'rule_tier_ent',
            description: 'Always enable for ENTERPRISE tier organizations',
            attribute: 'tenantTier',
            operator: 'EQUALS',
            values: ['ENTERPRISE'],
            serveVariant: true,
          },
          {
            id: 'rule_eu_region',
            description: 'Enable for EU-Central sovereign workloads',
            attribute: 'region',
            operator: 'IN',
            values: ['eu-central-1'],
            serveVariant: true,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      {
        key: 'zero-knowledge-payload-encryption',
        name: 'Zero-Knowledge Envelope Encryption (KMS)',
        description:
          'Encrypts sensitive webhook & ledger payloads at the edge using tenant-specific AWS KMS customer master keys.',
        enabled: true,
        rolloutPercentage: 35,
        targetTenants: [],
        rules: [
          {
            id: 'rule_ent_only',
            description: 'Target Enterprise Tier customers',
            attribute: 'tenantTier',
            operator: 'EQUALS',
            values: ['ENTERPRISE'],
            serveVariant: true,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      {
        key: 'realtime-anomaly-circuit-breaker',
        name: 'AI Traffic Anomaly Circuit Breaker',
        description:
          'Drops suspicious credential-stuffing spikes at the edge before hitting core PostgreSQL clusters.',
        enabled: true,
        rolloutPercentage: 80,
        targetTenants: ['tenant_stripe_fin', 'tenant_medcore_ai'],
        rules: [],
        updatedAt: new Date().toISOString(),
      },
      {
        key: 'graphql-federation-cache-v2',
        name: 'Sub-Millisecond Edge GraphQL Cache v2',
        description:
          'Experimental stale-while-revalidate Redis cluster caching for high-read GraphQL queries.',
        enabled: false,
        rolloutPercentage: 15,
        targetTenants: [],
        rules: [],
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const flag of initialFlags) {
      this.flagEngine.upsertFlag(flag);
    }

    // Seed initial cryptographic audit trail entries
    this.ledger.append({
      tenantId: 'tenant_stripe_fin',
      actorId: 'sys_bootstrap',
      actorType: 'SYSTEM',
      action: 'TENANT_PROVISIONED',
      resource: 'org:apex-fintech',
      severity: 'INFO',
      ipAddress: '10.0.14.21',
      metadata: { tier: 'ENTERPRISE', region: 'us-east-1', isolationMode: 'STRICT_RLS' },
    });

    this.ledger.append({
      tenantId: 'tenant_stripe_fin',
      actorId: 'usr_secops_lead',
      actorType: 'USER',
      action: 'API_KEY_ISSUED',
      resource: 'key:Apex Production Gateway Mesh',
      severity: 'INFO',
      ipAddress: '198.51.100.42',
      metadata: { role: 'OWNER', rateLimitPerMinute: 25, hashAlgorithm: 'SHA-256' },
    });

    this.ledger.append({
      tenantId: 'tenant_medcore_ai',
      actorId: 'usr_platform_eng',
      actorType: 'USER',
      action: 'FLAG_RULE_ATTACHED',
      resource: 'flag:llm-multi-region-failover',
      severity: 'WARN',
      ipAddress: '172.16.88.10',
      metadata: { rolloutPercentage: 50, regionRule: 'eu-central-1' },
    });

    // Seed 12 telemetry intervals for real-time charts
    const now = Date.now();
    for (let i = 11; i >= 0; i--) {
      const t = new Date(now - i * 5000).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      this.telemetry.push({
        timestamp: t,
        allowedCount: 18 + ((i * 7) % 15),
        throttledCount: i % 4 === 0 ? 3 : 0,
        p95LatencyMs: 6 + ((i * 3) % 7),
      });
    }

    // Seed initial realistic gateway executions so the trace stream and inspector are populated on first load
    const sampleRoutes: Array<{
      tenantId: string;
      endpoint: string;
      method: 'POST' | 'GET' | 'PUT';
      subjectId: string;
      flagKey: string;
    }> = [
      {
        tenantId: 'tenant_stripe_fin',
        endpoint: '/v1/payments/intents',
        method: 'POST',
        subjectId: 'usr_merchant_9012',
        flagKey: 'llm-multi-region-failover',
      },
      {
        tenantId: 'tenant_medcore_ai',
        endpoint: '/v1/ai/chat/completions',
        method: 'POST',
        subjectId: 'usr_clinician_304',
        flagKey: 'zero-knowledge-payload-encryption',
      },
      {
        tenantId: 'tenant_stripe_fin',
        endpoint: '/v1/ledger/settlements',
        method: 'GET',
        subjectId: 'usr_treasury_118',
        flagKey: 'realtime-anomaly-circuit-breaker',
      },
      {
        tenantId: 'tenant_orbital_dev',
        endpoint: '/v1/payments/intents',
        method: 'POST',
        subjectId: 'usr_sandbox_77',
        flagKey: 'llm-multi-region-failover',
      },
      {
        tenantId: 'tenant_stripe_fin',
        endpoint: '/v1/payments/intents',
        method: 'POST',
        subjectId: 'usr_enterprise_8841',
        flagKey: 'llm-multi-region-failover',
      },
    ];

    for (const sample of sampleRoutes) {
      this.executeGatewayRequest({
        tenantId: sample.tenantId,
        rawApiKey: this.demoRawKeys[sample.tenantId],
        endpoint: sample.endpoint,
        method: sample.method,
        subjectId: sample.subjectId,
        flagKey: sample.flagKey,
        requiredScope: 'gateway:proxy',
      });
    }

    // Seed initial signed webhook deliveries (including 1 in retry backoff and 1 in DLQ)
    this.webhookDispatcher.dispatch({
      tenantId: 'tenant_stripe_fin',
      eventType: 'payment.intent.succeeded',
      targetUrl: 'https://webhooks.apexfintech.io/v1/events',
      payload: { intentId: 'pi_994812', amountUsd: 14500, currency: 'USD' },
      simulateFailure: false,
    });
    this.webhookDispatcher.dispatch({
      tenantId: 'tenant_medcore_ai',
      eventType: 'flag.rollout.updated',
      targetUrl: 'https://events.medcore-diagnostics.eu/hooks',
      payload: { flagKey: 'llm-multi-region-failover', rolloutPercentage: 50 },
      simulateFailure: true,
    });
    const dlqItem = this.webhookDispatcher.dispatch({
      tenantId: 'tenant_stripe_fin',
      eventType: 'security.rate_limit.breached',
      targetUrl: 'https://siem.apexfintech.io/ingest',
      payload: { ip: '198.51.100.74', route: '/v1/payments/intents', status: 429 },
      simulateFailure: true,
    });
    this.webhookDispatcher.retryDelivery(dlqItem.id, true);
    this.webhookDispatcher.retryDelivery(dlqItem.id, true);
    this.webhookDispatcher.retryDelivery(dlqItem.id, true);
  }

  public executeGatewayRequest(params: {
    rawApiKey?: string;
    tenantId: string;
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    subjectId: string;
    flagKey?: string;
    requiredScope?: PermissionScope;
    cost?: number;
  }): GatewayExecutionTrace {
    const startNs = process.hrtime.bigint();
    const tenant =
      this.tenants.get(params.tenantId) ?? Array.from(this.tenants.values())[0];

    // 1. Authenticate API key if provided, or look up tenant key
    let matchedKey: ApiKeyRecord | undefined;
    if (params.rawApiKey) {
      const candidateHash = hashApiKey(params.rawApiKey.trim());
      matchedKey = Array.from(this.apiKeys.values()).find(
        (k) => k.keyHash === candidateHash && k.status === 'ACTIVE'
      );
    } else {
      matchedKey = Array.from(this.apiKeys.values()).find(
        (k) => k.tenantId === tenant.id && k.status === 'ACTIVE'
      );
    }

    const requestId = `req_${Math.random().toString(36).slice(2, 10)}`;
    const requiredScope = params.requiredScope ?? 'gateway:proxy';

    // Check RBAC scope
    if (!matchedKey || !hasScope(matchedKey.scopes, requiredScope)) {
      const auditEntry = this.ledger.append({
        tenantId: tenant.id,
        actorId: matchedKey?.id ?? 'anonymous_key',
        actorType: 'API_KEY',
        action: 'GATEWAY_RBAC_DENIED',
        resource: `${params.method} ${params.endpoint}`,
        severity: 'CRITICAL',
        ipAddress: '203.0.113.88',
        metadata: {
          requiredScope,
          assignedRole: matchedKey?.role ?? 'NONE',
          statusCode: !matchedKey ? 401 : 403,
        },
      });

      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const trace: GatewayExecutionTrace = {
        requestId,
        timestamp: new Date().toISOString(),
        tenantId: tenant.id,
        endpoint: params.endpoint,
        method: params.method,
        statusCode: !matchedKey ? 401 : 403,
        latencyMs: Math.max(1.2, Number(elapsedMs.toFixed(2))),
        rateLimit: {
          allowed: false,
          limit: tenant.rateLimitPerMinute,
          remaining: 0,
          currentWeight: 0,
          resetAtMs: Date.now() + 60_000,
          headers: {},
        },
        auditSequence: auditEntry.sequence,
        auditHash: auditEntry.hash,
      };
      this.recordTrace(trace);
      return trace;
    }

    // 2. Evaluate Sliding-Window Rate Limiter
    const rlDecision = this.rateLimiter.evaluate(
      `rl:${tenant.id}`,
      {
        limit: tenant.rateLimitPerMinute,
        windowMs: 60_000,
        burstFactor: tenant.burstFactor,
      },
      Date.now(),
      params.cost ?? 1
    );

    // 3. Evaluate Feature Flag if requested
    const flagToEval = params.flagKey || 'llm-multi-region-failover';
    const flagResult = this.flagEngine.evaluate(flagToEval, {
      tenantId: tenant.id,
      subjectId: params.subjectId || 'usr_default_99',
      tenantTier: tenant.tier,
      region: tenant.region,
    });

    const statusCode: 200 | 429 = rlDecision.allowed ? 200 : 429;
    if (rlDecision.allowed) {
      tenant.requestsThisMonth += params.cost ?? 1;
    }

    // 4. Append to SHA-256 Cryptographic Audit Ledger
    const auditEntry = this.ledger.append({
      tenantId: tenant.id,
      actorId: matchedKey.id,
      actorType: 'API_KEY',
      action: rlDecision.allowed ? 'GATEWAY_REQUEST_ALLOWED' : 'GATEWAY_RATE_LIMITED',
      resource: `${params.method} ${params.endpoint}`,
      severity: rlDecision.allowed ? 'INFO' : 'WARN',
      ipAddress: '198.51.100.74',
      metadata: {
        statusCode,
        slidingWindowWeight: rlDecision.currentWeight,
        remainingQuota: rlDecision.remaining,
        flagKey: flagResult.flagKey,
        flagVariant: flagResult.value,
        flagReason: flagResult.reason,
      },
    });

    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const latencyMs = Number((elapsedMs + 2.4 + Math.random() * 2.5).toFixed(2));

    const trace: GatewayExecutionTrace = {
      requestId,
      timestamp: new Date().toISOString(),
      tenantId: tenant.id,
      endpoint: params.endpoint,
      method: params.method,
      statusCode,
      latencyMs,
      rateLimit: {
        allowed: rlDecision.allowed,
        limit: rlDecision.limit,
        remaining: rlDecision.remaining,
        currentWeight: rlDecision.currentWeight,
        resetAtMs: rlDecision.resetAtMs,
        headers: rlDecision.headers,
      },
      flagEvaluation: {
        flagKey: flagResult.flagKey,
        value: flagResult.value,
        reason: flagResult.reason,
        bucketScore: flagResult.bucketScore,
      },
      auditSequence: auditEntry.sequence,
      auditHash: auditEntry.hash,
    };

    this.recordTrace(trace);
    return trace;
  }

  private recordTrace(trace: GatewayExecutionTrace) {
    this.recentTraces.unshift(trace);
    if (this.recentTraces.length > 40) {
      this.recentTraces.pop();
    }

    const timeLabel = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const latestPoint = this.telemetry[this.telemetry.length - 1];
    if (latestPoint && latestPoint.timestamp === timeLabel) {
      if (trace.statusCode === 200) {
        latestPoint.allowedCount += 1;
      } else {
        latestPoint.throttledCount += 1;
      }
    } else {
      this.telemetry.push({
        timestamp: timeLabel,
        allowedCount: trace.statusCode === 200 ? 1 : 0,
        throttledCount: trace.statusCode === 200 ? 0 : 1,
        p95LatencyMs: Math.round(trace.latencyMs + 4),
      });
      if (this.telemetry.length > 16) {
        this.telemetry.shift();
      }
    }
  }
}

const globalForAegis = globalThis as unknown as {
  aegisControlPlaneStore?: EnterpriseControlPlaneStore;
};

export function getControlPlaneStore(): EnterpriseControlPlaneStore {
  if (
    !globalForAegis.aegisControlPlaneStore ||
    globalForAegis.aegisControlPlaneStore.recentTraces.length === 0 ||
    !globalForAegis.aegisControlPlaneStore.circuitBreaker
  ) {
    globalForAegis.aegisControlPlaneStore = new EnterpriseControlPlaneStore();
  }
  return globalForAegis.aegisControlPlaneStore;
}

