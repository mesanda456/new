export interface CanaryTrafficDeployment {
  serviceId: string;
  serviceName: string;
  stableVersion: string;
  canaryVersion: string;
  canaryWeightPercent: number;
  stableMetrics: {
    requests: number;
    p95LatencyMs: number;
    errorRatePercent: number;
  };
  canaryMetrics: {
    requests: number;
    p95LatencyMs: number;
    errorRatePercent: number;
  };
  autoRollbackThresholdPercent: number;
  status: 'HEALTHY_SPLIT' | 'CANARY_PROMOTED' | 'AUTO_ROLLED_BACK';
  lastUpdated: string;
}

/**
 * Progressive Canary Traffic Splitter & Automated Rollback Engine (Argo Rollouts / Envoy style).
 * Splits traffic between Stable (v1) and Canary (v2) revisions and automatically rolls back
 * Canary weight to 0% if the Canary error rate breaches the SLO threshold.
 */
export class CanaryTrafficSplitter {
  private deployments = new Map<string, CanaryTrafficDeployment>();

  constructor() {
    this.deployments.set('svc_payment_settlement', {
      serviceId: 'svc_payment_settlement',
      serviceName: 'Payment Settlement Engine',
      stableVersion: 'v2.4.0-stable',
      canaryVersion: 'v2.5.0-canary',
      canaryWeightPercent: 20,
      stableMetrics: {
        requests: 14_820,
        p95LatencyMs: 4.2,
        errorRatePercent: 0.03,
      },
      canaryMetrics: {
        requests: 3_705,
        p95LatencyMs: 3.9,
        errorRatePercent: 0.08,
      },
      autoRollbackThresholdPercent: 2.5,
      status: 'HEALTHY_SPLIT',
      lastUpdated: new Date().toISOString(),
    });
  }

  public getDeployment(serviceId: string = 'svc_payment_settlement'): CanaryTrafficDeployment {
    return this.deployments.get(serviceId)!;
  }

  public setCanaryWeight(
    weightPercent: number,
    serviceId: string = 'svc_payment_settlement'
  ): CanaryTrafficDeployment {
    const dep = this.deployments.get(serviceId)!;
    dep.canaryWeightPercent = Math.min(100, Math.max(0, weightPercent));
    dep.status = dep.canaryWeightPercent === 100 ? 'CANARY_PROMOTED' : 'HEALTHY_SPLIT';
    dep.lastUpdated = new Date().toISOString();
    return dep;
  }

  /**
   * Simulates an error spike in the Canary revision and triggers an automatic SLO rollback to 0%.
   */
  public simulateCanaryRegression(
    serviceId: string = 'svc_payment_settlement'
  ): CanaryTrafficDeployment {
    const dep = this.deployments.get(serviceId)!;
    dep.canaryMetrics.errorRatePercent = 6.8;
    dep.canaryMetrics.p95LatencyMs = 410.0;

    if (dep.canaryMetrics.errorRatePercent > dep.autoRollbackThresholdPercent) {
      dep.canaryWeightPercent = 0;
      dep.status = 'AUTO_ROLLED_BACK';
    }
    dep.lastUpdated = new Date().toISOString();
    return dep;
  }

  public promoteCanary(serviceId: string = 'svc_payment_settlement'): CanaryTrafficDeployment {
    const dep = this.deployments.get(serviceId)!;
    dep.canaryWeightPercent = 100;
    dep.canaryMetrics.errorRatePercent = 0.04;
    dep.canaryMetrics.p95LatencyMs = 3.7;
    dep.status = 'CANARY_PROMOTED';
    dep.lastUpdated = new Date().toISOString();
    return dep;
  }
}
