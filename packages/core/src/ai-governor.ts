export type AiModelId = 'claude-3-7-sonnet' | 'gpt-4o-enterprise' | 'gemini-2-5-pro';

export interface AiModelPricing {
  modelId: AiModelId;
  provider: 'Anthropic' | 'OpenAI' | 'Google DeepMind';
  inputCostPer1kTokensUsd: number;
  outputCostPer1kTokensUsd: number;
  avgLatencyMs: number;
}

export const AI_MODEL_CATALOG: Record<AiModelId, AiModelPricing> = {
  'claude-3-7-sonnet': {
    modelId: 'claude-3-7-sonnet',
    provider: 'Anthropic',
    inputCostPer1kTokensUsd: 0.003,
    outputCostPer1kTokensUsd: 0.015,
    avgLatencyMs: 320,
  },
  'gpt-4o-enterprise': {
    modelId: 'gpt-4o-enterprise',
    provider: 'OpenAI',
    inputCostPer1kTokensUsd: 0.0025,
    outputCostPer1kTokensUsd: 0.01,
    avgLatencyMs: 290,
  },
  'gemini-2-5-pro': {
    modelId: 'gemini-2-5-pro',
    provider: 'Google DeepMind',
    inputCostPer1kTokensUsd: 0.00125,
    outputCostPer1kTokensUsd: 0.005,
    avgLatencyMs: 210,
  },
};

export interface TenantAiBudget {
  tenantId: string;
  monthlyBudgetUsd: number;
  currentSpendUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  semanticCacheHits: number;
  totalRequests: number;
}

export interface AiGatewayExecution {
  id: string;
  tenantId: string;
  modelId: AiModelId;
  promptPreview: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  semanticCacheHit: boolean;
  budgetExceeded: boolean;
  latencyMs: number;
  timestamp: string;
}

/**
 * AI Token Metering, Semantic Cache & FinOps Budget Governor.
 * Meters prompt/completion tokens per tenant, enforces hard USD budget ceilings,
 * and caches deterministic prompt hashes at the edge for 0-cost semantic cache hits.
 */
export class AiTokenGovernor {
  private budgets = new Map<string, TenantAiBudget>();
  private promptCache = new Map<string, { outputTokens: number; responseText: string }>();
  private executions: AiGatewayExecution[] = [];

  constructor() {
    this.budgets.set('tenant_stripe_fin', {
      tenantId: 'tenant_stripe_fin',
      monthlyBudgetUsd: 50.0,
      currentSpendUsd: 18.42,
      totalInputTokens: 1_420_000,
      totalOutputTokens: 690_000,
      semanticCacheHits: 312,
      totalRequests: 1180,
    });
    this.budgets.set('tenant_medcore_ai', {
      tenantId: 'tenant_medcore_ai',
      monthlyBudgetUsd: 25.0,
      currentSpendUsd: 11.15,
      totalInputTokens: 890_000,
      totalOutputTokens: 410_000,
      semanticCacheHits: 194,
      totalRequests: 740,
    });
    this.budgets.set('tenant_orbital_dev', {
      tenantId: 'tenant_orbital_dev',
      monthlyBudgetUsd: 5.0,
      currentSpendUsd: 4.85,
      totalInputTokens: 320_000,
      totalOutputTokens: 180_000,
      semanticCacheHits: 42,
      totalRequests: 290,
    });
  }

  public meterInference(params: {
    tenantId: string;
    modelId: AiModelId;
    prompt: string;
    estimatedOutputTokens?: number;
  }): AiGatewayExecution {
    const pricing = AI_MODEL_CATALOG[params.modelId] ?? AI_MODEL_CATALOG['claude-3-7-sonnet'];
    const budget =
      this.budgets.get(params.tenantId) ??
      ({
        tenantId: params.tenantId,
        monthlyBudgetUsd: 10.0,
        currentSpendUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        semanticCacheHits: 0,
        totalRequests: 0,
      } satisfies TenantAiBudget);

    this.budgets.set(params.tenantId, budget);

    const normalizedPromptKey = `${params.modelId}:${params.prompt.trim().toLowerCase()}`;
    const cached = this.promptCache.get(normalizedPromptKey);

    const inputTokens = Math.max(24, Math.ceil(params.prompt.length * 1.8));
    const outputTokens = cached?.outputTokens ?? (params.estimatedOutputTokens || 380);

    const rawCostUsd =
      (inputTokens / 1000) * pricing.inputCostPer1kTokensUsd +
      (outputTokens / 1000) * pricing.outputCostPer1kTokensUsd;

    const semanticCacheHit = Boolean(cached);
    const effectiveCostUsd = semanticCacheHit ? 0 : Number(rawCostUsd.toFixed(5));

    if (!semanticCacheHit && budget.currentSpendUsd + effectiveCostUsd > budget.monthlyBudgetUsd) {
      const blockedExec: AiGatewayExecution = {
        id: `ai_req_${Math.random().toString(36).slice(2, 9)}`,
        tenantId: params.tenantId,
        modelId: params.modelId,
        promptPreview: params.prompt.slice(0, 60),
        inputTokens,
        outputTokens: 0,
        costUsd: 0,
        semanticCacheHit: false,
        budgetExceeded: true,
        latencyMs: 1.4,
        timestamp: new Date().toISOString(),
      };
      this.executions.unshift(blockedExec);
      return blockedExec;
    }

    budget.totalRequests += 1;
    if (semanticCacheHit) {
      budget.semanticCacheHits += 1;
    } else {
      budget.totalInputTokens += inputTokens;
      budget.totalOutputTokens += outputTokens;
      budget.currentSpendUsd = Number((budget.currentSpendUsd + effectiveCostUsd).toFixed(4));
      this.promptCache.set(normalizedPromptKey, {
        outputTokens,
        responseText: 'Cached deterministic completion vector',
      });
    }

    const exec: AiGatewayExecution = {
      id: `ai_req_${Math.random().toString(36).slice(2, 9)}`,
      tenantId: params.tenantId,
      modelId: params.modelId,
      promptPreview: params.prompt.slice(0, 60),
      inputTokens,
      outputTokens,
      costUsd: effectiveCostUsd,
      semanticCacheHit,
      budgetExceeded: false,
      latencyMs: semanticCacheHit ? 2.1 : pricing.avgLatencyMs,
      timestamp: new Date().toISOString(),
    };

    this.executions.unshift(exec);
    if (this.executions.length > 25) {
      this.executions.pop();
    }
    return exec;
  }

  public getBudget(tenantId: string): TenantAiBudget | undefined {
    return this.budgets.get(tenantId);
  }

  public getAllBudgets(): TenantAiBudget[] {
    return Array.from(this.budgets.values());
  }

  public updateBudgetCeiling(tenantId: string, monthlyBudgetUsd: number): TenantAiBudget | undefined {
    const b = this.budgets.get(tenantId);
    if (!b) return undefined;
    b.monthlyBudgetUsd = monthlyBudgetUsd;
    return b;
  }

  public getRecentExecutions(): AiGatewayExecution[] {
    return [...this.executions];
  }
}
