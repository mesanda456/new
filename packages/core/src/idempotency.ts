import * as crypto from 'crypto';

export type IdempotencyStatus = 'EXECUTED_FRESH' | 'REPLAYED_FROM_CACHE' | 'CONFLICT_PAYLOAD_MISMATCH';

export interface IdempotentRecord {
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

export interface IdempotencyEvaluation {
  status: IdempotencyStatus;
  record: IdempotentRecord;
  isCachedReplay: boolean;
}

export function hashRequestPayload(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    canonical[k] = payload[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Stripe-Grade Idempotency Key Engine (RFC Draft Idempotency-Key Header).
 * Prevents duplicate financial charges or double mutations during network retries:
 * - Same key + same payload -> returns cached original response (`REPLAYED_FROM_CACHE`).
 * - Same key + different payload -> rejects with HTTP 422 (`CONFLICT_PAYLOAD_MISMATCH`).
 */
export class IdempotencyEngine {
  private store = new Map<string, IdempotentRecord>();

  public executeOrReplay(params: {
    tenantId: string;
    idempotencyKey: string;
    endpoint: string;
    payload: Record<string, unknown>;
    responseFactory: () => { statusCode: number; body: Record<string, unknown> };
    ttlSeconds?: number;
  }): IdempotencyEvaluation {
    const compositeKey = `${params.tenantId}:${params.idempotencyKey}`;
    const incomingHash = hashRequestPayload(params.payload);
    const existing = this.store.get(compositeKey);

    if (existing) {
      if (existing.payloadHash !== incomingHash) {
        return {
          status: 'CONFLICT_PAYLOAD_MISMATCH',
          record: existing,
          isCachedReplay: false,
        };
      }

      existing.replayCount += 1;
      return {
        status: 'REPLAYED_FROM_CACHE',
        record: existing,
        isCachedReplay: true,
      };
    }

    const generated = params.responseFactory();
    const now = new Date();
    const expires = new Date(now.getTime() + (params.ttlSeconds ?? 86400) * 1000);

    const record: IdempotentRecord = {
      idempotencyKey: params.idempotencyKey,
      tenantId: params.tenantId,
      endpoint: params.endpoint,
      payloadHash: incomingHash,
      statusCode: generated.statusCode,
      responseBody: generated.body,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      replayCount: 0,
    };

    this.store.set(compositeKey, record);
    return {
      status: 'EXECUTED_FRESH',
      record,
      isCachedReplay: false,
    };
  }

  public getRecords(tenantId?: string): IdempotentRecord[] {
    const all = Array.from(this.store.values()).reverse();
    if (!tenantId) return all;
    return all.filter((r) => r.tenantId === tenantId);
  }
}

