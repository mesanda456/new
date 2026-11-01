import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';
import { computeDeterministicBucket, FeatureFlagConfig } from '@aegis/core';

export async function GET(req: NextRequest) {
  const store = getControlPlaneStore();
  const flagKey = req.nextUrl.searchParams.get('flagKey');
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'tenant_stripe_fin';
  const subjectId = req.nextUrl.searchParams.get('subjectId') || 'usr_enterprise_42';

  const flags = store.flagEngine.getFlags();
  const tenant = store.tenants.get(tenantId) ?? Array.from(store.tenants.values())[0];

  const evaluation = flagKey
    ? store.flagEngine.evaluate(flagKey, {
        tenantId: tenant.id,
        subjectId,
        tenantTier: tenant.tier,
        region: tenant.region,
      })
    : undefined;

  return NextResponse.json({
    flags,
    evaluation,
    sampleBucket: flagKey
      ? computeDeterministicBucket(flagKey, `${tenant.id}:${subjectId}`)
      : undefined,
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();

  if (body.action === 'EVALUATE') {
    const tenant =
      store.tenants.get(body.tenantId) ?? Array.from(store.tenants.values())[0];
    const result = store.flagEngine.evaluate(body.flagKey, {
      tenantId: tenant.id,
      subjectId: body.subjectId || 'usr_sample_01',
      tenantTier: body.tenantTier || tenant.tier,
      region: body.region || tenant.region,
    });
    return NextResponse.json({ evaluation: result });
  }

  const existing = store.flagEngine.getFlag(body.key);
  const updatedFlag: FeatureFlagConfig = {
    key: body.key,
    name: body.name ?? existing?.name ?? body.key,
    description: body.description ?? existing?.description ?? '',
    enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? true),
    rolloutPercentage:
      typeof body.rolloutPercentage === 'number'
        ? Math.min(100, Math.max(0, body.rolloutPercentage))
        : (existing?.rolloutPercentage ?? 50),
    targetTenants: Array.isArray(body.targetTenants)
      ? body.targetTenants
      : (existing?.targetTenants ?? []),
    rules: Array.isArray(body.rules) ? body.rules : (existing?.rules ?? []),
    updatedAt: new Date().toISOString(),
  };

  store.flagEngine.upsertFlag(updatedFlag);

  store.ledger.append({
    tenantId: body.tenantId || 'tenant_stripe_fin',
    actorId: 'usr_platform_admin',
    actorType: 'USER',
    action: existing ? 'FEATURE_FLAG_UPDATED' : 'FEATURE_FLAG_CREATED',
    resource: `flag:${updatedFlag.key}`,
    severity: 'INFO',
    ipAddress: '10.24.18.9',
    metadata: {
      enabled: updatedFlag.enabled,
      rolloutPercentage: updatedFlag.rolloutPercentage,
      targetTenantsCount: updatedFlag.targetTenants.length,
    },
  });

  return NextResponse.json({
    flag: updatedFlag,
    flags: store.flagEngine.getFlags(),
  });
}

