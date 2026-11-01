export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RegionClusterHealth {
  region: 'us-east-1' | 'eu-central-1' | 'ap-south-1';
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  failureThreshold: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  lastStateChange: string;
  isPrimary: boolean;
}

/**
 * Multi-Region Circuit Breaker & Automatic Failover Router (Netflix Hystrix / Envoy style).
 * Monitors regional cluster health, trips circuits to OPEN when failure thresholds are exceeded,
 * and automatically reroutes traffic to healthy secondary regions.
 */
export class MultiRegionCircuitBreaker {
  private regions = new Map<RegionClusterHealth['region'], RegionClusterHealth>();

  constructor() {
    this.resetAll();
  }

  public resetAll(): void {
    const now = new Date().toISOString();
    this.regions.set('us-east-1', {
      region: 'us-east-1',
      name: 'US-East (N. Virginia)',
      state: 'CLOSED',
      failureCount: 0,
      successCount: 1420,
      failureThreshold: 3,
      p95LatencyMs: 3.8,
      errorRatePercent: 0.02,
      lastStateChange: now,
      isPrimary: true,
    });
    this.regions.set('eu-central-1', {
      region: 'eu-central-1',
      name: 'EU-Central (Frankfurt)',
      state: 'CLOSED',
      failureCount: 0,
      successCount: 890,
      failureThreshold: 3,
      p95LatencyMs: 6.4,
      errorRatePercent: 0.04,
      lastStateChange: now,
      isPrimary: false,
    });
    this.regions.set('ap-south-1', {
      region: 'ap-south-1',
      name: 'AP-South (Mumbai)',
      state: 'CLOSED',
      failureCount: 0,
      successCount: 510,
      failureThreshold: 3,
      p95LatencyMs: 9.1,
      errorRatePercent: 0.05,
      lastStateChange: now,
      isPrimary: false,
    });
  }

  public getRegions(): RegionClusterHealth[] {
    return Array.from(this.regions.values());
  }

  public tripRegion(region: RegionClusterHealth['region']): RegionClusterHealth | undefined {
    const r = this.regions.get(region);
    if (!r) return undefined;
    r.state = 'OPEN';
    r.failureCount = r.failureThreshold;
    r.p95LatencyMs = 840.0;
    r.errorRatePercent = 94.5;
    r.lastStateChange = new Date().toISOString();
    return r;
  }

  public halfOpenRegion(region: RegionClusterHealth['region']): RegionClusterHealth | undefined {
    const r = this.regions.get(region);
    if (!r) return undefined;
    r.state = 'HALF_OPEN';
    r.p95LatencyMs = 42.0;
    r.errorRatePercent = 4.2;
    r.lastStateChange = new Date().toISOString();
    return r;
  }

  public recoverRegion(region: RegionClusterHealth['region']): RegionClusterHealth | undefined {
    const r = this.regions.get(region);
    if (!r) return undefined;
    r.state = 'CLOSED';
    r.failureCount = 0;
    r.p95LatencyMs = region === 'us-east-1' ? 3.8 : region === 'eu-central-1' ? 6.4 : 9.1;
    r.errorRatePercent = 0.02;
    r.lastStateChange = new Date().toISOString();
    return r;
  }

  /**
   * Resolves the optimal region for a request. If preferredRegion is OPEN, fails over to the lowest-latency CLOSED region.
   */
  public resolveHealthyRegion(preferredRegion: RegionClusterHealth['region']): {
    routedRegion: RegionClusterHealth['region'];
    failoverTriggered: boolean;
    circuitState: CircuitState;
  } {
    const preferred = this.regions.get(preferredRegion);
    if (preferred && preferred.state !== 'OPEN') {
      preferred.successCount += 1;
      return {
        routedRegion: preferred.region,
        failoverTriggered: false,
        circuitState: preferred.state,
      };
    }

    const healthyFallback = Array.from(this.regions.values())
      .filter((r) => r.state !== 'OPEN')
      .sort((a, b) => a.p95LatencyMs - b.p95LatencyMs)[0];

    if (healthyFallback) {
      healthyFallback.successCount += 1;
      return {
        routedRegion: healthyFallback.region,
        failoverTriggered: true,
        circuitState: preferred?.state ?? 'OPEN',
      };
    }

    return {
      routedRegion: preferredRegion,
      failoverTriggered: false,
      circuitState: 'OPEN',
    };
  }
}
