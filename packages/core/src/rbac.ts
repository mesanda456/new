import * as crypto from 'crypto';

export type PermissionScope =
  | 'gateway:proxy'
  | 'flags:read'
  | 'flags:write'
  | 'audit:read'
  | 'audit:verify'
  | 'keys:manage'
  | 'tenants:admin';

export type RoleName = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'AUDITOR' | 'SERVICE_CLIENT';

export const ROLE_PERMISSIONS: Record<RoleName, PermissionScope[]> = {
  OWNER: [
    'gateway:proxy',
    'flags:read',
    'flags:write',
    'audit:read',
    'audit:verify',
    'keys:manage',
    'tenants:admin',
  ],
  ADMIN: [
    'gateway:proxy',
    'flags:read',
    'flags:write',
    'audit:read',
    'audit:verify',
    'keys:manage',
  ],
  DEVELOPER: ['gateway:proxy', 'flags:read', 'flags:write', 'audit:read'],
  AUDITOR: ['audit:read', 'audit:verify', 'flags:read'],
  SERVICE_CLIENT: ['gateway:proxy', 'flags:read'],
};

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  keyHash: string;
  role: RoleName;
  scopes: PermissionScope[];
  rateLimitPerMinute: number;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  lastUsedAt?: string;
}

export interface IssuedApiKey {
  record: ApiKeyRecord;
  /** Raw secret only returned once at creation time */
  rawKey: string;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates an enterprise-prefixed API key (`aegis_live_<tenant>_<random>`) and stores only its SHA-256 hash.
 */
export function generateApiKey(params: {
  tenantId: string;
  name: string;
  role: RoleName;
  rateLimitPerMinute: number;
  customRawKey?: string;
}): IssuedApiKey {
  const randomPart = crypto.randomBytes(16).toString('hex');
  const cleanTenant = params.tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const rawKey = params.customRawKey ?? `aegis_live_${cleanTenant}_${randomPart}`;
  const prefix = rawKey.slice(0, 20) + '...';
  const keyHash = hashApiKey(rawKey);

  const record: ApiKeyRecord = {
    id: `key_${crypto.randomBytes(6).toString('hex')}`,
    tenantId: params.tenantId,
    name: params.name,
    prefix,
    keyHash,
    role: params.role,
    scopes: ROLE_PERMISSIONS[params.role],
    rateLimitPerMinute: params.rateLimitPerMinute,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  };

  return { record, rawKey };
}

export function hasScope(scopes: PermissionScope[], required: PermissionScope): boolean {
  return scopes.includes('tenants:admin') || scopes.includes(required);
}

