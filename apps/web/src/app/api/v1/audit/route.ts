import { NextRequest, NextResponse } from 'next/server';
import { getControlPlaneStore } from '@/lib/store';

export async function GET(req: NextRequest) {
  const store = getControlPlaneStore();
  const tenantId = req.nextUrl.searchParams.get('tenantId') || undefined;
  const entries = store.ledger.getEntries(tenantId).slice().reverse();
  const verification = store.ledger.verifyChain();

  return NextResponse.json({
    entries,
    verification,
  });
}

export async function POST(req: NextRequest) {
  const store = getControlPlaneStore();
  const body = await req.json();

  if (body.action === 'SIMULATE_TAMPER') {
    const allEntries = store.ledger.getEntries();
    const targetSequence =
      typeof body.sequence === 'number'
        ? body.sequence
        : Math.max(1, allEntries.length - 1);

    store.ledger.unsafeTamperEntry(targetSequence, {
      TAMPERED_BY_INTRUDER: 'UNAUTHORIZED_DB_MUTATION_INJECTED',
      elevatedPrivilege: 'ROOT_BYPASS',
    });

    const verification = store.ledger.verifyChain();
    return NextResponse.json({
      entries: store.ledger.getEntries().slice().reverse(),
      verification,
    });
  }

  if (body.action === 'RESEAL_CHAIN') {
    store.ledger.resealChain();
    store.ledger.append({
      tenantId: 'tenant_stripe_fin',
      actorId: 'usr_secops_lead',
      actorType: 'USER',
      action: 'AUDIT_LEDGER_RESEALED',
      resource: 'ledger:primary',
      severity: 'WARN',
      ipAddress: '10.0.0.1',
      metadata: { reason: 'Cryptographic hash chain re-verified and sealed by SecOps' },
    });

    const verification = store.ledger.verifyChain();
    return NextResponse.json({
      entries: store.ledger.getEntries().slice().reverse(),
      verification,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

