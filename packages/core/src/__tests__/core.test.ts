import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AuditLedger,
  GENESIS_HASH,
  SlidingWindowRateLimiter,
  FeatureFlagEngine,
  computeDeterministicBucket,
  generateApiKey,
  hashApiKey,
  hasScope,
} from '../index';

describe('AuditLedger (SHA-256 Cryptographic Hash Chain)', () => {
  it('links entries from GENESIS_HASH and verifies chain integrity', () => {
    const ledger = new AuditLedger([], 'enterprise-hmac-secret');

    const e1 = ledger.append({
      tenantId: 'tenant_acme',
      actorId: 'usr_admin',
      actorType: 'USER',
      action: 'API_KEY_CREATED',
      resource: 'key_prod_01',
      severity: 'INFO',
      ipAddress: '10.24.0.12',
      metadata: { role: 'ADMIN', scopes: ['gateway:proxy'] },
    });

    const e2 = ledger.append({
      tenantId: 'tenant_acme',
      actorId: 'usr_admin',
      actorType: 'USER',
      action: 'FLAG_UPDATED',
      resource: 'flag:ai_inference_v2',
      severity: 'WARN',
      ipAddress: '10.24.0.12',
      metadata: { rolloutPercentage: 50 },
    });

    assert.equal(e1.sequence, 1);
    assert.equal(e1.previousHash, GENESIS_HASH);
    assert.equal(e2.sequence, 2);
    assert.equal(e2.previousHash, e1.hash);

    const verification = ledger.verifyChain();
    assert.equal(verification.valid, true);
    assert.equal(verification.totalEntries, 2);
    assert.equal(verification.verifiedEntries, 2);
  });

  it('detects unauthorized record tampering and reseals cleanly when authorized', () => {
    const ledger = new AuditLedger([], 'enterprise-hmac-secret');

    ledger.append({
      tenantId: 'tenant_acme',
      actorId: 'usr_1',
      actorType: 'USER',
      action: 'PAYMENT_LIMIT_CHANGED',
      resource: 'policy_1',
      severity: 'CRITICAL',
      ipAddress: '192.168.1.1',
      metadata: { maxTransferUsd: 10000 },
    });

    ledger.append({
      tenantId: 'tenant_acme',
      actorId: 'usr_2',
      actorType: 'USER',
      action: 'FLAG_READ',
      resource: 'flag_1',
      severity: 'INFO',
      ipAddress: '192.168.1.2',
      metadata: {},
    });

    // Simulate a rogue DB admin altering historical audit metadata at sequence #1
    ledger.unsafeTamperEntry(1, { maxTransferUsd: 9999999 });

    const brokenResult = ledger.verifyChain();
    assert.equal(brokenResult.valid, false);
    assert.equal(brokenResult.brokenAtSequence, 1);
    assert.ok(brokenResult.reason?.includes('Cryptographic payload digest mismatch'));

    // Re-seal chain and verify
    ledger.resealChain();
    const repairedResult = ledger.verifyChain();
    assert.equal(repairedResult.valid, true);
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('enforces sliding-window quotas and interpolates across window boundaries', () => {
    const limiter = new SlidingWindowRateLimiter();
    const config = { limit: 10, windowMs: 60_000 };
    const baseWindowStart = 1_700_000_040_000; // aligned to 60_000ms

    // Consume all 10 requests in window 1
    for (let i = 0; i < 10; i++) {
      const decision = limiter.evaluate('tenant_acme', config, baseWindowStart + 1000);
      assert.equal(decision.allowed, true);
    }

    // 11th request in window 1 is rejected with HTTP 429 headers
    const blocked = limiter.evaluate('tenant_acme', config, baseWindowStart + 2000);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);

    // Move halfway (50%) into window 2 -> previous window weight is 10 * (1 - 0.5) = 5
    const halfwayNextWindow = baseWindowStart + 60_000 + 30_000;
    const allowedInNext = limiter.evaluate('tenant_acme', config, halfwayNextWindow);
    assert.equal(allowedInNext.allowed, true);
    assert.equal(allowedInNext.currentWeight, 6); // 5 (interpolated) + 1 (current)
    assert.equal(allowedInNext.remaining, 4);
  });
});

describe('FeatureFlagEngine', () => {
  it('evaluates tenant allowlists, attribute targeting rules, and deterministic percentage rollouts', () => {
    const engine = new FeatureFlagEngine([
      {
        key: 'ai-smart-routing',
        name: 'AI Smart Routing',
        description: 'Routes high-priority traffic to low-latency edge clusters',
        enabled: true,
        rolloutPercentage: 25,
        targetTenants: ['tenant_vip'],
        rules: [
          {
            id: 'rule_enterprise_tier',
            description: 'Enable for all ENTERPRISE tier tenants',
            attribute: 'tenantTier',
            operator: 'EQUALS',
            values: ['ENTERPRISE'],
            serveVariant: true,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 1. Tenant allowlist match
    const vipEval = engine.evaluate('ai-smart-routing', {
      tenantId: 'tenant_vip',
      subjectId: 'user_1',
      tenantTier: 'FREE',
    });
    assert.equal(vipEval.value, true);
    assert.equal(vipEval.reason, 'TENANT_ALLOWLIST');

    // 2. Attribute rule match
    const entEval = engine.evaluate('ai-smart-routing', {
      tenantId: 'tenant_standard',
      subjectId: 'user_2',
      tenantTier: 'ENTERPRISE',
    });
    assert.equal(entEval.value, true);
    assert.equal(entEval.reason, 'RULE_MATCH');

    // 3. Deterministic bucket consistency across 100 invocations
    const firstBucket = computeDeterministicBucket('ai-smart-routing', 'tenant_free:user_99');
    for (let i = 0; i < 20; i++) {
      assert.equal(
        computeDeterministicBucket('ai-smart-routing', 'tenant_free:user_99'),
        firstBucket
      );
    }
  });
});

describe('RBAC & API Key Security', () => {
  it('hashes API keys deterministically and enforces role scopes', () => {
    const issued = generateApiKey({
      tenantId: 'tenant_acme',
      name: 'Production Gateway Key',
      role: 'DEVELOPER',
      rateLimitPerMinute: 120,
    });

    assert.ok(issued.rawKey.startsWith('aegis_live_tenantac_'));
    assert.equal(issued.record.keyHash, hashApiKey(issued.rawKey));
    assert.equal(hasScope(issued.record.scopes, 'flags:write'), true);
    assert.equal(hasScope(issued.record.scopes, 'keys:manage'), false);
  });
});

