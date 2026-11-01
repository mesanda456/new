import * as crypto from 'crypto';

export type WebhookStatus = 'DELIVERED' | 'RETRY_SCHEDULED' | 'DEAD_LETTER_QUEUE';

export interface WebhookEventDelivery {
  id: string;
  tenantId: string;
  eventType:
    | 'payment.intent.succeeded'
    | 'security.rate_limit.breached'
    | 'audit.chain.verified'
    | 'flag.rollout.updated';
  targetUrl: string;
  status: WebhookStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryDelaySeconds: number;
  hmacSignature: string;
  payload: Record<string, unknown>;
  lastHttpStatus: number;
  updatedAt: string;
}

export function signWebhookPayload(
  payload: Record<string, unknown>,
  timestamp: string,
  secret: string
): string {
  const body = JSON.stringify(payload);
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`t=${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Computes exponential backoff with deterministic jitter: base * 2^(attempt - 1)
 */
export function computeBackoffSeconds(attempt: number, baseSeconds: number = 15): number {
  return baseSeconds * Math.pow(2, Math.max(0, attempt - 1));
}

/**
 * Signed Webhook Outbox & Dead-Letter Queue (DLQ) Engine.
 */
export class WebhookDispatcher {
  private deliveries: WebhookEventDelivery[] = [];
  private readonly signingSecret: string;

  constructor(signingSecret: string = 'whsec_aegis_enterprise_signing_key_2026') {
    this.signingSecret = signingSecret;
  }

  public dispatch(params: {
    tenantId: string;
    eventType: WebhookEventDelivery['eventType'];
    targetUrl: string;
    payload: Record<string, unknown>;
    simulateFailure?: boolean;
  }): WebhookEventDelivery {
    const timestamp = new Date().toISOString();
    const hmacSignature = signWebhookPayload(params.payload, timestamp, this.signingSecret);

    const delivery: WebhookEventDelivery = {
      id: `wh_evt_${crypto.randomBytes(5).toString('hex')}`,
      tenantId: params.tenantId,
      eventType: params.eventType,
      targetUrl: params.targetUrl,
      status: params.simulateFailure ? 'RETRY_SCHEDULED' : 'DELIVERED',
      attemptCount: 1,
      maxAttempts: 4,
      nextRetryDelaySeconds: params.simulateFailure ? computeBackoffSeconds(1) : 0,
      hmacSignature,
      payload: params.payload,
      lastHttpStatus: params.simulateFailure ? 503 : 200,
      updatedAt: timestamp,
    };

    this.deliveries.unshift(delivery);
    if (this.deliveries.length > 30) {
      this.deliveries.pop();
    }
    return delivery;
  }

  public retryDelivery(id: string, forceFailAgain: boolean = false): WebhookEventDelivery | undefined {
    const item = this.deliveries.find((d) => d.id === id);
    if (!item) return undefined;

    item.attemptCount += 1;
    item.updatedAt = new Date().toISOString();

    if (forceFailAgain) {
      if (item.attemptCount >= item.maxAttempts) {
        item.status = 'DEAD_LETTER_QUEUE';
        item.nextRetryDelaySeconds = 0;
        item.lastHttpStatus = 504;
      } else {
        item.status = 'RETRY_SCHEDULED';
        item.nextRetryDelaySeconds = computeBackoffSeconds(item.attemptCount);
        item.lastHttpStatus = 502;
      }
    } else {
      item.status = 'DELIVERED';
      item.nextRetryDelaySeconds = 0;
      item.lastHttpStatus = 200;
    }

    return item;
  }

  public replayDeadLetterQueue(): number {
    let replayed = 0;
    for (const d of this.deliveries) {
      if (d.status === 'DEAD_LETTER_QUEUE' || d.status === 'RETRY_SCHEDULED') {
        d.status = 'DELIVERED';
        d.lastHttpStatus = 200;
        d.nextRetryDelaySeconds = 0;
        d.attemptCount += 1;
        d.updatedAt = new Date().toISOString();
        replayed += 1;
      }
    }
    return replayed;
  }

  public getDeliveries(tenantId?: string): WebhookEventDelivery[] {
    if (!tenantId) return [...this.deliveries];
    return this.deliveries.filter((d) => d.tenantId === tenantId);
  }
}

