import * as crypto from 'crypto';

export type TargetingOperator = 'IN' | 'EQUALS' | 'ENDS_WITH' | 'GREATER_THAN';

export interface TargetingRule {
  id: string;
  description: string;
  attribute: 'tenantTier' | 'region' | 'userEmail' | 'environment' | 'requestVersion';
  operator: TargetingOperator;
  values: string[];
  serveVariant: boolean;
}

export interface FeatureFlagConfig {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Percentage rollout from 0 to 100 */
  rolloutPercentage: number;
  /** Optional tenant allowlist that always receives true when flag is enabled */
  targetTenants: string[];
  /** Attribute-based targeting rules evaluated in priority order */
  rules: TargetingRule[];
  updatedAt: string;
}

export interface EvaluationContext {
  tenantId: string;
  subjectId: string;
  tenantTier?: 'FREE' | 'PRO' | 'ENTERPRISE';
  region?: string;
  userEmail?: string;
  environment?: 'production' | 'staging' | 'development';
  attributes?: Record<string, string | number>;
}

export interface FlagEvaluationResult {
  flagKey: string;
  value: boolean;
  reason:
    | 'FLAG_DISABLED'
    | 'TENANT_ALLOWLIST'
    | 'RULE_MATCH'
    | 'PERCENTAGE_ROLLOUT_INCLUDED'
    | 'PERCENTAGE_ROLLOUT_EXCLUDED';
  matchedRuleId?: string;
  bucketScore: number;
  evaluatedAt: string;
}

/**
 * Deterministic 0..99 bucketing score using SHA-256 hash of (flagKey + ":" + subjectId).
 * Guarantees sticky assignments across stateless gateway nodes without database lookups.
 */
export function computeDeterministicBucket(flagKey: string, subjectId: string): number {
  const digest = crypto.createHash('sha256').update(`${flagKey}:${subjectId}`).digest();
  const uint32 = digest.readUInt32BE(0);
  return uint32 % 100;
}

function matchesRule(rule: TargetingRule, context: EvaluationContext): boolean {
  const rawAttr =
    context[rule.attribute as keyof EvaluationContext] ??
    context.attributes?.[rule.attribute];

  if (rawAttr === undefined || rawAttr === null) return false;
  const attrValue = String(rawAttr);

  switch (rule.operator) {
    case 'EQUALS':
      return rule.values[0] === attrValue;
    case 'IN':
      return rule.values.includes(attrValue);
    case 'ENDS_WITH':
      return rule.values.some((suffix) => attrValue.endsWith(suffix));
    case 'GREATER_THAN': {
      const numericAttr = Number(attrValue);
      const numericThreshold = Number(rule.values[0]);
      return !Number.isNaN(numericAttr) && numericAttr > numericThreshold;
    }
    default:
      return false;
  }
}

/**
 * Deterministic Feature Flag & Progressive Rollout Evaluator.
 */
export class FeatureFlagEngine {
  private flags = new Map<string, FeatureFlagConfig>();

  constructor(initialFlags: FeatureFlagConfig[] = []) {
    for (const flag of initialFlags) {
      this.flags.set(flag.key, flag);
    }
  }

  public upsertFlag(flag: FeatureFlagConfig): FeatureFlagConfig {
    const updated = { ...flag, updatedAt: new Date().toISOString() };
    this.flags.set(flag.key, updated);
    return updated;
  }

  public getFlags(): FeatureFlagConfig[] {
    return Array.from(this.flags.values());
  }

  public getFlag(key: string): FeatureFlagConfig | undefined {
    return this.flags.get(key);
  }

  public evaluate(flagKey: string, context: EvaluationContext): FlagEvaluationResult {
    const flag = this.flags.get(flagKey);
    const bucketScore = computeDeterministicBucket(
      flagKey,
      `${context.tenantId}:${context.subjectId}`
    );
    const evaluatedAt = new Date().toISOString();

    if (!flag || !flag.enabled) {
      return {
        flagKey,
        value: false,
        reason: 'FLAG_DISABLED',
        bucketScore,
        evaluatedAt,
      };
    }

    if (flag.targetTenants.includes(context.tenantId)) {
      return {
        flagKey,
        value: true,
        reason: 'TENANT_ALLOWLIST',
        bucketScore,
        evaluatedAt,
      };
    }

    for (const rule of flag.rules) {
      if (matchesRule(rule, context)) {
        return {
          flagKey,
          value: rule.serveVariant,
          reason: 'RULE_MATCH',
          matchedRuleId: rule.id,
          bucketScore,
          evaluatedAt,
        };
      }
    }

    const included = bucketScore < flag.rolloutPercentage;
    return {
      flagKey,
      value: included,
      reason: included ? 'PERCENTAGE_ROLLOUT_INCLUDED' : 'PERCENTAGE_ROLLOUT_EXCLUDED',
      bucketScore,
      evaluatedAt,
    };
  }
}

