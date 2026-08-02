import type { DiscoveredDeviceInput } from '@techpioasset/contracts';

/**
 * Device discovery behind a provider interface (v2.5, plan section H2).
 *
 * A provider *observes* — it returns what some external system (an agent
 * check-in, Intune, a future RMM) currently knows about devices, normalised to
 * the ingest contract. It never links devices to assets: reconciliation is the
 * DiscoveryService's job, and only an exact serial match (or a human) may
 * create a link. Every fetch says whether it was simulated.
 */

export interface DiscoveryFetchResult {
  devices: DiscoveredDeviceInput[];
  /** True when produced without contacting any external service. */
  simulated: boolean;
  provider: string;
}

export abstract class DiscoveryProvider {
  abstract readonly name: string;
  abstract fetchDevices(): Promise<DiscoveryFetchResult>;
}
