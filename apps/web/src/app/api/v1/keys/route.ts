import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';
import { generateApiKey, RoleName } from '@aegis/core';

export async function GET(req: NextRequest) {
  const store = getControlPlaneStore();
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  const allKeys = Array.from(store.apiKeys.values());
  const keys = tenantId ? allKeys.filter((k) => k.tenantId === tenantId) : allKeys;

  return NextResponse.json({
    keys,
    demoRawKeys: store.demoRawKeys,
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();

  if (body.action === 'REVOKE') {
    const record = store.apiKeys.get(body.keyId);
    if (!record) {
      return NextResponse.json({ error: 'API Key not found' }, { status: 404 });
    }
    record.status = 'REVOKED';
    store.ledger.append({
      tenantId: record.tenantId,
      actorId: 'usr_security_admin',
      actorType: 'USER',
      action: 'API_KEY_REVOKED',
      resource: `key:${record.id}`,
      severity: 'CRITICAL',
      ipAddress: '10.24.0.88',
      metadata: { keyName: record.name, role: record.role },
    });

    return NextResponse.json({
      keys: Array.from(store.apiKeys.values()),
    });
  }

  const tenantId = body.tenantId || 'tenant_stripe_fin';
  const role: RoleName = body.role || 'DEVELOPER';
  const name = body.name || 'Production Microservice Key';
  const rateLimitPerMinute = Number(body.rateLimitPerMinute || 20);

  const issued = generateApiKey({
    tenantId,
    name,
    role,
    rateLimitPerMinute,
  });

  store.apiKeys.set(issued.record.id, issued.record);
  store.demoRawKeys[tenantId] = issued.rawKey;

  store.ledger.append({
    tenantId,
    actorId: 'usr_security_admin',
    actorType: 'USER',
    action: 'API_KEY_PROVISIONED',
    resource: `key:${issued.record.id}`,
    severity: 'INFO',
    ipAddress: '10.24.0.88',
    metadata: {
      name,
      role,
      scopes: issued.record.scopes,
      sha256Prefix: issued.record.keyHash.slice(0, 16),
    },
  });

  return NextResponse.json({
    issued,
    keys: Array.from(store.apiKeys.values()),
  });
}

