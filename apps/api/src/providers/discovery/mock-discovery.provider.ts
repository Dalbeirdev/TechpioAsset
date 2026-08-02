import type { DiscoveredDeviceInput } from '@techpioasset/contracts';
import { DiscoveryFetchResult, DiscoveryProvider } from './discovery.provider.js';

/**
 * The default provider: a small, deterministic fleet that exercises every
 * reconciliation outcome without touching the network. Serial numbers are
 * deliberately synthetic — in a demo tenant they land as UNMATCHED/PROPOSED
 * queue items for the review UI, which is exactly what the mock is for.
 */
export class MockDiscoveryProvider extends DiscoveryProvider {
  readonly name = 'mock';

  async fetchDevices(): Promise<DiscoveryFetchResult> {
    const devices: DiscoveredDeviceInput[] = [
      {
        externalId: 'mock-agent-001',
        serialNumber: 'MOCK-SN-0001',
        hostname: 'FIN-LAPTOP-01',
        hardware: {
          manufacturer: 'Dell',
          modelName: 'Latitude 5440',
          cpu: 'Intel Core i5-1345U',
          cpuCores: 10,
          ramGb: 16,
          storageTotalGb: 512,
          storageFreeGb: 210,
          smartStatus: 'HEALTHY',
          batteryHealthPct: 88,
          batteryCycleCount: 240,
        },
        os: {
          osName: 'Windows 11 Pro',
          osVersion: '24H2',
          osSupported: true,
          osActivated: true,
          diskEncrypted: true,
          defenderEnabled: true,
          firewallEnabled: true,
          tpmPresent: true,
          localAdminCount: 1,
          missingCriticalPatches: 0,
        },
        software: [
          { name: 'Google Chrome', version: '126.0', publisher: 'Google LLC' },
          { name: '7-Zip', version: '24.06', publisher: 'Igor Pavlov' },
        ],
      },
      {
        externalId: 'mock-agent-002',
        serialNumber: 'MOCK-SN-0002',
        hostname: 'ENG-DESKTOP-07',
        hardware: {
          manufacturer: 'HP',
          modelName: 'EliteDesk 800 G9',
          cpu: 'Intel Core i7-13700',
          cpuCores: 16,
          ramGb: 32,
          storageTotalGb: 1024,
          storageFreeGb: 80,
          smartStatus: 'WARNING',
        },
        os: {
          osName: 'Windows 11 Pro',
          osVersion: '23H2',
          osSupported: true,
          osActivated: true,
          diskEncrypted: false,
          defenderEnabled: true,
          firewallEnabled: true,
          tpmPresent: true,
          localAdminCount: 3,
          missingCriticalPatches: 4,
        },
        software: [{ name: 'Visual Studio Code', version: '1.91', publisher: 'Microsoft' }],
      },
      {
        externalId: 'mock-agent-003',
        hostname: 'MEETING-ROOM-PC',
        os: { osName: 'Windows 10 Pro', osVersion: '22H2', osSupported: false },
      },
    ];
    return { devices, simulated: true, provider: this.name };
  }
}
