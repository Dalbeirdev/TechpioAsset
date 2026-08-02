import { Logger } from '@nestjs/common';
import type { DiscoveredDeviceInput } from '@techpioasset/contracts';
import type { AppConfig } from '../../config/config.module.js';
import { DiscoveryFetchResult, DiscoveryProvider } from './discovery.provider.js';

/**
 * Microsoft Intune connector, built to contract (plan section H2).
 *
 * Client-credentials flow against Entra ID, then Graph
 * `/v1.0/deviceManagement/managedDevices` mapped onto the ingest contract.
 * HONEST LIMIT: written against the documented Graph API but not verified
 * against a live tenant — there is none in this environment. It is selected
 * only when DISCOVERY_PROVIDER=intune and all three INTUNE_* vars are set,
 * and any failure is surfaced, never swallowed into fake devices.
 */
export class IntuneDiscoveryProvider extends DiscoveryProvider {
  readonly name = 'intune';
  private readonly logger = new Logger(IntuneDiscoveryProvider.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  async fetchDevices(): Promise<DiscoveryFetchResult> {
    const token = await this.acquireToken();
    const devices: DiscoveredDeviceInput[] = [];
    let url =
      'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices' +
      '?$select=id,serialNumber,deviceName,manufacturer,model,operatingSystem,osVersion,' +
      'totalStorageSpaceInBytes,freeStorageSpaceInBytes,physicalMemoryInBytes,lastSyncDateTime';

    // Graph pages with @odata.nextLink; follow it to the end.
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new Error(`Intune managedDevices request failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        value: Array<Record<string, unknown>>;
        '@odata.nextLink'?: string;
      };
      for (const d of body.value) devices.push(this.mapDevice(d));
      url = body['@odata.nextLink'] ?? '';
    }

    this.logger.log(`Intune returned ${devices.length} managed device(s)`);
    return { devices, simulated: false, provider: this.name };
  }

  private mapDevice(d: Record<string, unknown>): DiscoveredDeviceInput {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const bytes = (v: unknown) => (typeof v === 'number' && v > 0 ? v / 1024 ** 3 : null);
    const totalGb = bytes(d.totalStorageSpaceInBytes);
    const freeGb = bytes(d.freeStorageSpaceInBytes);
    return {
      externalId: str(d.id),
      serialNumber: str(d.serialNumber),
      hostname: str(d.deviceName),
      hardware: {
        manufacturer: str(d.manufacturer),
        modelName: str(d.model),
        ramGb: bytes(d.physicalMemoryInBytes),
        storageTotalGb: totalGb,
        storageFreeGb: freeGb,
      },
      os: {
        osName: str(d.operatingSystem),
        osVersion: str(d.osVersion),
      },
      // Intune's software inventory needs a per-device call; deferred until a
      // live tenant exists to validate throttling behaviour against.
    };
  }

  private async acquireToken(): Promise<string> {
    const tenantId = this.config.get('INTUNE_TENANT_ID');
    const clientId = this.config.get('INTUNE_CLIENT_ID');
    const clientSecret = this.config.get('INTUNE_CLIENT_SECRET');
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'DISCOVERY_PROVIDER=intune needs INTUNE_TENANT_ID, INTUNE_CLIENT_ID and INTUNE_CLIENT_SECRET',
      );
    }
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    if (!res.ok) {
      throw new Error(`Entra token request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }
}
