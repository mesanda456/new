import * as crypto from 'crypto';

export interface AuditEventInput {
  tenantId: string;
  actorId: string;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM';
  action: string;
  resource: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  ipAddress: string;
  metadata: Record<string, unknown>;
}

export interface AuditLogEntry extends AuditEventInput {
  id: string;
  sequence: number;
  timestamp: string;
  previousHash: string;
  hash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  brokenAtSequence?: number;
  brokenEntryId?: string;
  expectedHash?: string;
  actualHash?: string;
  reason?: string;
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Deterministic canonical JSON serializer so SHA-256 hashes are reproducible across runtimes.
 */
export function canonicalizeMetadata(metadata: Record<string, unknown>): string {
  const sortedKeys = Object.keys(metadata).sort();
  const canonicalObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonicalObj[key] = metadata[key];
  }
  return JSON.stringify(canonicalObj);
}

/**
 * Computes the SHA-256 cryptographic digest of an audit log entry linked to its predecessor.
 */
export function computeAuditHash(
  payload: {
    sequence: number;
    timestamp: string;
    tenantId: string;
    actorId: string;
    actorType: string;
    action: string;
    resource: string;
    severity: string;
    ipAddress: string;
    metadata: Record<string, unknown>;
    previousHash: string;
  },
  hmacSecret?: string
): string {
  const canonicalPayload = [
    payload.sequence,
    payload.timestamp,
    payload.tenantId,
    payload.actorId,
    payload.actorType,
    payload.action,
    payload.resource,
    payload.severity,
    payload.ipAddress,
    canonicalizeMetadata(payload.metadata),
    payload.previousHash,
  ].join('|');

  if (hmacSecret) {
    return crypto.createHmac('sha256', hmacSecret).update(canonicalPayload).digest('hex');
  }
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Tamper-Evident Cryptographic Audit Ledger.
 * Links every state mutation to the previous entry via SHA-256 hash chaining (similar to AWS QLDB / Trillian).
 */
export class AuditLedger {
  private entries: AuditLogEntry[] = [];
  private readonly secret?: string;

  constructor(initialEntries: AuditLogEntry[] = [], secret?: string) {
    this.entries = [...initialEntries];
    this.secret = secret;
  }

  public append(input: AuditEventInput, customTimestamp?: string): AuditLogEntry {
    const sequence = this.entries.length + 1;
    const previousHash =
      this.entries.length > 0 ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
    const timestamp = customTimestamp ?? new Date().toISOString();
    const id = `aud_${crypto.randomBytes(8).toString('hex')}`;

    const hash = computeAuditHash(
      {
        sequence,
        timestamp,
        tenantId: input.tenantId,
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        resource: input.resource,
        severity: input.severity,
        ipAddress: input.ipAddress,
        metadata: input.metadata,
        previousHash,
      },
      this.secret
    );

    const entry: AuditLogEntry = {
      id,
      sequence,
      timestamp,
      ...input,
      previousHash,
      hash,
    };

    this.entries.push(entry);
    return entry;
  }

  public getEntries(tenantId?: string): AuditLogEntry[] {
    if (!tenantId) {
      return [...this.entries];
    }
    return this.entries.filter((e) => e.tenantId === tenantId);
  }

  /**
   * Simulates an unauthorized database mutation (for demonstrating tamper detection in the UI).
   */
  public unsafeTamperEntry(sequence: number, mutatedMetadata: Record<string, unknown>): boolean {
    const entry = this.entries.find((e) => e.sequence === sequence);
    if (!entry) return false;
    entry.metadata = { ...entry.metadata, ...mutatedMetadata };
    return true;
  }

  /**
   * Repairs the cryptographic hash chain from sequence 1..N (authorized re-seal).
   */
  public resealChain(): void {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      entry.sequence = i + 1;
      entry.previousHash = prevHash;
      entry.hash = computeAuditHash(
        {
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          tenantId: entry.tenantId,
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          resource: entry.resource,
          severity: entry.severity,
          ipAddress: entry.ipAddress,
          metadata: entry.metadata,
          previousHash: prevHash,
        },
        this.secret
      );
      prevHash = entry.hash;
    }
  }

  /**
   * Verifies the cryptographic integrity of the entire hash chain from Genesis to Head.
   */
  public verifyChain(): ChainVerificationResult {
    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (entry.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          verifiedEntries: i,
          brokenAtSequence: entry.sequence,
          brokenEntryId: entry.id,
          expectedHash: expectedPreviousHash,
          actualHash: entry.previousHash,
          reason: `Chain link broken at sequence #${entry.sequence}: previousHash mismatch.`,
        };
      }

      const recomputedHash = computeAuditHash(
        {
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          tenantId: entry.tenantId,
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          resource: entry.resource,
          severity: entry.severity,
          ipAddress: entry.ipAddress,
          metadata: entry.metadata,
          previousHash: entry.previousHash,
        },
        this.secret
      );

      if (entry.hash !== recomputedHash) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          verifiedEntries: i,
          brokenAtSequence: entry.sequence,
          brokenEntryId: entry.id,
          expectedHash: recomputedHash,
          actualHash: entry.hash,
          reason: `Cryptographic payload digest mismatch at sequence #${entry.sequence} (${entry.id}). Underlying record was modified after sealing.`,
        };
      }

      expectedPreviousHash = entry.hash;
    }

    return {
      valid: true,
      totalEntries: this.entries.length,
      verifiedEntries: this.entries.length,
    };
  }
}

