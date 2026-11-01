import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';
import { AiModelId } from '@aegis/core';

export async function GET(req: NextRequest) {
  const store = getControlPlaneStore();
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant_stripe_fin';

  return NextResponse.json({
    idempotencyRecords: store.idempotencyEngine.getRecords(),
    aiBudget: store.aiGovernor.getBudget(tenantId),
    allAiBudgets: store.aiGovernor.getAllBudgets(),
    aiExecutions: store.aiGovernor.getRecentExecutions(),
    canaryDeployment: store.canarySplitter.getDeployment(),
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();
  const tenantId = body.tenantId || 'tenant_stripe_fin';

  if (body.action === 'EXECUTE_IDEMPOTENT') {
    const idempotencyKey = body.idempotencyKey || 'idem_wire_transfer_88412';
    const amountUsd = Number(body.amountUsd ?? 12500);
    const evaluation = store.idempotencyEngine.executeOrReplay({
      tenantId,
      idempotencyKey,
      endpoint: 'POST /v1/payments/intents',
      payload: { amountUsd, currency: 'USD', beneficiary: body.beneficiary || 'acct_eu_991' },
      responseFactory: () => ({
        statusCode: 200,
        body: {
          transferId: `tr_live_${Math.random().toString(36).slice(2, 9)}`,
          status: 'SETTLED',
          amountUsd,
          feeUsd: Number((amountUsd * 0.001).toFixed(2)),
        },
      }),
    });

    store.ledger.append({
      tenantId,
      actorId: 'sys_idempotency_guard',
      actorType: 'SYSTEM',
      action:
        evaluation.status === 'EXECUTED_FRESH'
          ? 'IDEMPOTENT_KEY_LOCKED'
          : evaluation.status === 'REPLAYED_FROM_CACHE'
          ? 'IDEMPOTENT_CACHE_REPLAY'
          : 'IDEMPOTENT_CONFLICT_422',
      resource: `idem:${idempotencyKey}`,
      severity: evaluation.status === 'CONFLICT_PAYLOAD_MISMATCH' ? 'WARN' : 'INFO',
      ipAddress: '198.51.100.42',
      metadata: {
        status: evaluation.status,
        replayCount: evaluation.record.replayCount,
        amountUsd,
      },
    });

    return NextResponse.json({
      evaluation,
      idempotencyRecords: store.idempotencyEngine.getRecords(),
    });
  }

  if (body.action === 'METER_AI_INFERENCE') {
    const exec = store.aiGovernor.meterInference({
      tenantId,
      modelId: (body.modelId || 'claude-3-7-sonnet') as AiModelId,
      prompt:
        body.prompt || 'Analyze real-time wire transfer fraud risk vector for merchant #8841',
    });

    store.ledger.append({
      tenantId,
      actorId: 'sys_ai_finops_governor',
      actorType: 'SYSTEM',
      action: exec.budgetExceeded
        ? 'AI_BUDGET_CEILING_BLOCKED'
        : exec.semanticCacheHit
        ? 'AI_SEMANTIC_CACHE_HIT'
        : 'AI_TOKENS_METERED',
      resource: `model:${exec.modelId}`,
      severity: exec.budgetExceeded ? 'CRITICAL' : 'INFO',
      ipAddress: '10.0.88.14',
      metadata: {
        inputTokens: exec.inputTokens,
        outputTokens: exec.outputTokens,
        costUsd: exec.costUsd,
        semanticCacheHit: exec.semanticCacheHit,
      },
    });

    return NextResponse.json({
      execution: exec,
      aiBudget: store.aiGovernor.getBudget(tenantId),
      aiExecutions: store.aiGovernor.getRecentExecutions(),
    });
  }

  if (body.action === 'SET_CANARY_WEIGHT') {
    const dep = store.canarySplitter.setCanaryWeight(Number(body.weightPercent ?? 20));
    store.ledger.append({
      tenantId,
      actorId: 'usr_release_engineer',
      actorType: 'USER',
      action: 'CANARY_TRAFFIC_SPLIT_UPDATED',
      resource: dep.serviceName,
      severity: 'INFO',
      ipAddress: '10.0.12.9',
      metadata: {
        stableVersion: dep.stableVersion,
        canaryVersion: dep.canaryVersion,
        canaryWeightPercent: dep.canaryWeightPercent,
      },
    });
    return NextResponse.json({ canaryDeployment: dep });
  }

  if (body.action === 'SIMULATE_CANARY_SLO_BREACH') {
    const dep = store.canarySplitter.simulateCanaryRegression();
    store.ledger.append({
      tenantId,
      actorId: 'sys_slo_watchdog',
      actorType: 'SYSTEM',
      action: 'CANARY_AUTO_ROLLBACK_TRIGGERED',
      resource: dep.serviceName,
      severity: 'CRITICAL',
      ipAddress: '10.0.12.9',
      metadata: {
        canaryErrorRatePercent: dep.canaryMetrics.errorRatePercent,
        thresholdPercent: dep.autoRollbackThresholdPercent,
        rolledBackTo: dep.stableVersion,
      },
    });
    return NextResponse.json({ canaryDeployment: dep });
  }

  if (body.action === 'PROMOTE_CANARY') {
    const dep = store.canarySplitter.promoteCanary();
    store.ledger.append({
      tenantId,
      actorId: 'usr_release_engineer',
      actorType: 'USER',
      action: 'CANARY_REVISION_PROMOTED',
      resource: dep.serviceName,
      severity: 'INFO',
      ipAddress: '10.0.12.9',
      metadata: { promotedVersion: dep.canaryVersion },
    });
    return NextResponse.json({ canaryDeployment: dep });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

