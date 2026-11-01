import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';
import { PermissionScope } from '@aegis/core';

export async function GET(req: NextRequest) {
  const store = getControlPlaneStore();
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant_stripe_fin';
  const tenants = Array.from(store.tenants.values());
  const activeTenant = store.tenants.get(tenantId) ?? tenants[0];

  const rateLimitSnapshot = store.rateLimiter.getBucketSnapshot(`rl:${activeTenant.id}`, {
    limit: activeTenant.rateLimitPerMinute,
    windowMs: 60_000,
    burstFactor: activeTenant.burstFactor,
  });

  const chainIntegrity = store.ledger.verifyChain();

  return NextResponse.json({
    tenants,
    activeTenant,
    demoRawKeys: store.demoRawKeys,
    rateLimitSnapshot,
    chainIntegrity,
    recentTraces: store.recentTraces.slice(0, 20),
    telemetry: store.telemetry,
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();

  if (body.action === 'RESET_RATE_LIMIT') {
    const tenantId = body.tenantId || 'tenant_stripe_fin';
    store.rateLimiter.resetKey(`rl:${tenantId}`);
    store.ledger.append({
      tenantId,
      actorId: 'usr_console_operator',
      actorType: 'USER',
      action: 'RATE_LIMIT_BUCKET_RESET',
      resource: `rl:${tenantId}`,
      severity: 'INFO',
      ipAddress: '127.0.0.1',
      metadata: { reason: 'Manual operator quota reset via Control Plane' },
    });
    return NextResponse.json({ reset: true });
  }

  const burstCount = Math.min(25, Math.max(1, Number(body.burstCount ?? 1)));
  const traces = [];

  for (let i = 0; i < burstCount; i++) {
    const trace = store.executeGatewayRequest({
      rawApiKey: body.rawApiKey,
      tenantId: body.tenantId || 'tenant_stripe_fin',
      endpoint: body.endpoint || '/v1/payments/intents',
      method: body.method || 'POST',
      subjectId: body.subjectId || `usr_customer_${100 + i}`,
      flagKey: body.flagKey || 'llm-multi-region-failover',
      requiredScope: (body.requiredScope as PermissionScope) || 'gateway:proxy',
      cost: 1,
    });
    traces.push(trace);
  }

  const latestTrace = traces[traces.length - 1];
  return NextResponse.json(
    {
      latestTrace,
      traces,
      recentTraces: store.recentTraces.slice(0, 20),
      telemetry: store.telemetry,
    },
    { status: 200 }
  );
}

