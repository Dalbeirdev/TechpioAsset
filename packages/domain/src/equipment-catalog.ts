/**
 * Equipment catalog baseline + dynamic-request vocabularies (v2.17).
 *
 * The request form's equipment picker is DB-driven: the API merges this
 * baseline with the distinct asset names the company actually owns, so the
 * list grows with the register instead of being a frozen hardcode. This file
 * only guarantees a sensible floor for brand-new tenants.
 */

export const EQUIPMENT_CATALOG: { group: string; items: string[] }[] = [
  { group: 'Computers', items: ['Laptop', 'Desktop', 'Workstation', 'MacBook'] },
  { group: 'Displays', items: ['Monitor', 'Projector'] },
  {
    group: 'Peripherals',
    items: ['Keyboard', 'Mouse', 'Wireless Keyboard', 'Wireless Mouse', 'Headset', 'Webcam', 'Speakers'],
  },
  {
    group: 'Cables & Adapters',
    items: [
      'HDMI Cable',
      'DisplayPort Cable',
      'USB Cable',
      'USB-C Cable',
      'Ethernet Cable',
      'USB Adapter',
      'Network Adapter',
      'Projector Cable',
      'USB Hub',
    ],
  },
  { group: 'Power', items: ['Laptop Charger', 'Power Adapter', 'Power Strip', 'UPS'] },
  { group: 'Storage & Memory', items: ['SSD', 'External Hard Drive', 'USB Drive', 'RAM'] },
  { group: 'Networking', items: ['Wi-Fi Adapter', 'Switch', 'Access Point'] },
  { group: 'Mobile Devices', items: ['Mobile Phone', 'Tablet'] },
  { group: 'Office Equipment', items: ['Printer', 'Scanner'] },
  { group: 'Accessories', items: ['Docking Station', 'Laptop Bag'] },
];

export const UPGRADE_TYPES = [
  ['RAM', 'RAM upgrade'],
  ['STORAGE', 'SSD / storage upgrade'],
  ['CPU_PERFORMANCE', 'CPU / performance upgrade'],
  ['DISPLAY', 'Display upgrade'],
  ['WARRANTY', 'Warranty upgrade'],
  ['DOCKING_CONNECTIVITY', 'Docking / connectivity upgrade'],
  ['OPERATING_SYSTEM', 'Operating system upgrade'],
  ['OTHER', 'Other'],
] as const;
export type UpgradeType = (typeof UPGRADE_TYPES)[number][0];

export const REPLACEMENT_REASONS = [
  ['DAMAGED', 'Damaged'],
  ['LOST', 'Lost'],
  ['END_OF_LIFE', 'End of life'],
  ['PERFORMANCE_ISSUE', 'Performance issue'],
  ['WARRANTY_ISSUE', 'Warranty issue'],
  ['UPGRADE_REQUIRED', 'Upgrade required'],
  ['OTHER', 'Other'],
] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number][0];

export const RAM_UPGRADE_OPTIONS = ['16 GB', '32 GB', '64 GB'];
export const STORAGE_UPGRADE_OPTIONS = ['512 GB SSD', '1 TB SSD', '2 TB SSD'];

/** Request types whose form asks "which of your assets is this about?". */
export const ASSET_LINKED_REQUEST_TYPES = [
  'UPGRADE',
  'REPLACEMENT',
  'REPAIR',
  'DAMAGE',
  'LOSS',
] as const;
