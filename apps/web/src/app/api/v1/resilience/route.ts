import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';
import { inspectAndSanitizePayload, RegionClusterHealth } from '@aegis/core';

export async function GET() {
  const store = getControlPlaneStore();
  return NextResponse.json({
    regions: store.circuitBreaker.getRegions(),
    webhooks: store.webhookDispatcher.getDeliveries(),
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();

  if (body.action === 'TRIP_REGION') {
    const region = (body.region || 'us-east-1') as RegionClusterHealth['region'];
    store.circuitBreaker.tripRegion(region);
    store.ledger.append({
      tenantId: body.tenantId || 'tenant_stripe_fin',
      actorId: 'sys_circuit_breaker',
      actorType: 'SYSTEM',
      action: 'REGIONAL_CIRCUIT_OPENED',
      resource: `cluster:${region}`,
      severity: 'CRITICAL',
      ipAddress: '10.0.99.1',
      metadata: {
        region,
        newState: 'OPEN',
        failoverTarget: 'eu-central-1',
        reason: 'Upstream p95 latency exceeded 500ms threshold',
      },
    });
    return NextResponse.json({
      regions: store.circuitBreaker.getRegions(),
      webhooks: store.webhookDispatcher.getDeliveries(),
    });
  }

  if (body.action === 'HALF_OPEN_REGION') {
    const region = (body.region || 'us-east-1') as RegionClusterHealth['region'];
    store.circuitBreaker.halfOpenRegion(region);
    return NextResponse.json({
      regions: store.circuitBreaker.getRegions(),
      webhooks: store.webhookDispatcher.getDeliveries(),
    });
  }

  if (body.action === 'RECOVER_REGION') {
    const region = (body.region || 'us-east-1') as RegionClusterHealth['region'];
    store.circuitBreaker.recoverRegion(region);
    store.ledger.append({
      tenantId: body.tenantId || 'tenant_stripe_fin',
      actorId: 'sys_circuit_breaker',
      actorType: 'SYSTEM',
      action: 'REGIONAL_CIRCUIT_CLOSED',
      resource: `cluster:${region}`,
      severity: 'INFO',
      ipAddress: '10.0.99.1',
      metadata: { region, newState: 'CLOSED', healthProbe: 'PASSED' },
    });
    return NextResponse.json({
      regions: store.circuitBreaker.getRegions(),
      webhooks: store.webhookDispatcher.getDeliveries(),
    });
  }

  if (body.action === 'DISPATCH_WEBHOOK') {
    const delivery = store.webhookDispatcher.dispatch({
      tenantId: body.tenantId || 'tenant_stripe_fin',
      eventType: body.eventType || 'payment.intent.succeeded',
      targetUrl: body.targetUrl || 'https://webhooks.apexfintech.io/v1/events',
      payload: {
        tenantId: body.tenantId || 'tenant_stripe_fin',
        dispatchedAt: new Date().toISOString(),
        amountUsd: 8950,
      },
      simulateFailure: Boolean(body.simulateFailure),
    });

    store.ledger.append({
      tenantId: delivery.tenantId,
      actorId: 'sys_webhook_worker',
      actorType: 'SYSTEM',
      action: delivery.status === 'DELIVERED' ? 'WEBHOOK_DELIVERED' : 'WEBHOOK_RETRY_QUEUED',
      resource: delivery.id,
      severity: delivery.status === 'DELIVERED' ? 'INFO' : 'WARN',
      ipAddress: '10.0.44.12',
      metadata: {
        eventType: delivery.eventType,
        status: delivery.status,
        lastHttpStatus: delivery.lastHttpStatus,
      },
    });

    return NextResponse.json({
      delivery,
      regions: store.circuitBreaker.getRegions(),
      webhooks: store.webhookDispatcher.getDeliveries(),
    });
  }

  if (body.action === 'REPLAY_DLQ') {
    const count = store.webhookDispatcher.replayDeadLetterQueue();
    store.ledger.append({
      tenantId: body.tenantId || 'tenant_stripe_fin',
      actorId: 'usr_sre_oncall',
      actorType: 'USER',
      action: 'WEBHOOK_DLQ_REPLAYED',
      resource: 'dlq:primary',
      severity: 'INFO',
      ipAddress: '10.0.44.12',
      metadata: { replayedEventsCount: count },
    });
    return NextResponse.json({
      replayedCount: count,
      regions: store.circuitBreaker.getRegions(),
      webhooks: store.webhookDispatcher.getDeliveries(),
    });
  }

  if (body.action === 'INSPECT_DLP') {
    const inspection = inspectAndSanitizePayload(String(body.payload || ''));
    if (inspection.wafBlocked || inspection.redactedCount > 0) {
      store.ledger.append({
        tenantId: body.tenantId || 'tenant_stripe_fin',
        actorId: 'sys_edge_dlp_waf',
        actorType: 'SYSTEM',
        action: inspection.wafBlocked ? 'EDGE_WAF_ATTACK_BLOCKED' : 'EDGE_DLP_PII_REDACTED',
        resource: 'filter:inbound-payload',
        severity: inspection.wafBlocked ? 'CRITICAL' : 'WARN',
        ipAddress: '203.0.113.195',
        metadata: {
          wafBlocked: inspection.wafBlocked,
          redactedCount: inspection.redactedCount,
          detectedTypes: inspection.detectedTypes,
        },
      });
    }
    return NextResponse.json({ inspection });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

