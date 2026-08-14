/**
 * Asset type catalogue (v2.20).
 *
 * The Category -> Type chain existed in the schema and the form from day one,
 * but no types were ever defined, so the Type box sat permanently disabled.
 * This file is the missing layer: the types a company can register, and the
 * fields each type actually needs.
 *
 * Two kinds of extra field, deliberately kept apart:
 *
 *  - IDENTITY (serial number, MAC address, IMEI) lives in real columns with
 *    database-enforced uniqueness, because "is this the same phone?" must be a
 *    guarantee, not a convention.
 *  - SPECIFICATION (screen size, cable length, DPI) lives in the `specs` JSON
 *    column, because the list will keep growing and none of it needs a unique
 *    index. Adding a field here is a code change with no migration.
 *
 * Types marked QUANTITY are counted, not serialised: nobody maintains 40 rows
 * of "HDMI Cable" with blank serials, so those are stock instead.
 */

export type AssetIdentityField = 'serialNumber' | 'macAddress' | 'imei';

export interface AssetFieldDef {
  /** Key inside the asset's `specs` object. */
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  /** Choices for `select`; free text is never blocked elsewhere. */
  options?: readonly string[];
  /** Shown after the input - "in", "GB", "m". */
  unit?: string;
  placeholder?: string;
}

export interface AssetTypeDef {
  /** Subcategory key, unique within its category. */
  key: string;
  name: string;
  /** Parent category key - the Type list filters on this. */
  categoryKey: string;
  tracking: 'INDIVIDUAL' | 'QUANTITY';
  /** Identity columns to surface for this type, in display order. */
  identity: readonly AssetIdentityField[];
  /** Suggestions only - the brand box always accepts anything typed. */
  brands: readonly string[];
  fields: readonly AssetFieldDef[];
}

const CONNECTION = ['Wired', 'Wireless (USB receiver)', 'Bluetooth', 'Wired + Bluetooth'] as const;

export const ASSET_TYPES: readonly AssetTypeDef[] = [
  {
    key: 'laptop',
    name: 'Laptop',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Lenovo', 'Dell', 'HP', 'Acer', 'Apple', 'ASUS', 'MSI'],
    fields: [
      { key: 'cpu', label: 'Processor', kind: 'text', placeholder: 'Intel Core i5-1240P' },
      { key: 'ramGb', label: 'RAM', kind: 'number', unit: 'GB', placeholder: '16' },
      { key: 'storage', label: 'Storage', kind: 'text', placeholder: '512 GB SSD' },
      { key: 'screenSize', label: 'Screen size', kind: 'number', unit: 'in', placeholder: '14' },
      { key: 'os', label: 'Operating system', kind: 'text', placeholder: 'Windows 11 Pro' },
    ],
  },
  {
    key: 'desktop',
    name: 'Desktop',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Dell', 'HP', 'Lenovo', 'Acer', 'Apple', 'Custom build'],
    fields: [
      { key: 'cpu', label: 'Processor', kind: 'text', placeholder: 'Intel Core i7-12700' },
      { key: 'ramGb', label: 'RAM', kind: 'number', unit: 'GB', placeholder: '16' },
      { key: 'storage', label: 'Storage', kind: 'text', placeholder: '1 TB SSD' },
      { key: 'formFactor', label: 'Form factor', kind: 'select', options: ['Tower', 'Small form factor', 'Mini PC', 'All-in-one'] },
      { key: 'os', label: 'Operating system', kind: 'text', placeholder: 'Windows 11 Pro' },
    ],
  },
  {
    key: 'monitor',
    name: 'Monitor / Screen',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Samsung', 'LG', 'Dell', 'HP', 'BenQ', 'Acer', 'ASUS', 'ViewSonic'],
    fields: [
      { key: 'screenSize', label: 'Screen size', kind: 'number', unit: 'in', placeholder: '24' },
      { key: 'resolution', label: 'Resolution', kind: 'select', options: ['1366 x 768', '1920 x 1080 (FHD)', '2560 x 1440 (QHD)', '3440 x 1440 (UWQHD)', '3840 x 2160 (4K)'] },
      { key: 'panel', label: 'Panel type', kind: 'select', options: ['IPS', 'VA', 'TN', 'OLED'] },
      { key: 'refreshHz', label: 'Refresh rate', kind: 'number', unit: 'Hz', placeholder: '60' },
      { key: 'ports', label: 'Ports', kind: 'text', placeholder: 'HDMI, DisplayPort, VGA' },
      { key: 'mountable', label: 'VESA mount', kind: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'mobile-phone',
    name: 'Mobile Phone',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['imei', 'serialNumber', 'macAddress'],
    brands: ['Samsung', 'Apple', 'OnePlus', 'Xiaomi', 'Realme', 'Motorola', 'Nothing', 'Google'],
    fields: [
      { key: 'storage', label: 'Storage', kind: 'text', placeholder: '128 GB' },
      { key: 'ramGb', label: 'RAM', kind: 'number', unit: 'GB', placeholder: '8' },
      { key: 'colour', label: 'Colour', kind: 'text', placeholder: 'Phantom Black' },
      { key: 'imei2', label: 'IMEI 2 (dual SIM)', kind: 'text', placeholder: '359874102345678' },
      { key: 'carrier', label: 'Carrier / SIM', kind: 'text', placeholder: 'Airtel' },
      { key: 'os', label: 'Operating system', kind: 'text', placeholder: 'Android 15' },
    ],
  },
  {
    key: 'tablet',
    name: 'Tablet',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'imei', 'macAddress'],
    brands: ['Apple', 'Samsung', 'Lenovo', 'Xiaomi', 'Microsoft'],
    fields: [
      { key: 'screenSize', label: 'Screen size', kind: 'number', unit: 'in', placeholder: '11' },
      { key: 'storage', label: 'Storage', kind: 'text', placeholder: '128 GB' },
      { key: 'connectivity', label: 'Connectivity', kind: 'select', options: ['Wi-Fi only', 'Wi-Fi + Cellular'] },
      { key: 'stylus', label: 'Stylus included', kind: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'keyboard',
    name: 'Keyboard',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Logitech', 'Dell', 'HP', 'Lenovo', 'Microsoft', 'Zebronics', 'Keychron'],
    fields: [
      { key: 'connection', label: 'Connection', kind: 'select', options: CONNECTION },
      { key: 'layout', label: 'Layout', kind: 'select', options: ['Full size', 'TKL (no numpad)', 'Compact 75%', 'Laptop style'] },
      { key: 'switchType', label: 'Switch type', kind: 'select', options: ['Membrane', 'Mechanical', 'Scissor'] },
      { key: 'receiverId', label: 'Receiver / dongle ID', kind: 'text', placeholder: 'Unifying receiver code' },
    ],
  },
  {
    key: 'mouse',
    name: 'Mouse',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Logitech', 'Dell', 'HP', 'Lenovo', 'Microsoft', 'Zebronics'],
    fields: [
      { key: 'connection', label: 'Connection', kind: 'select', options: CONNECTION },
      { key: 'dpi', label: 'DPI', kind: 'number', placeholder: '1600' },
      { key: 'buttons', label: 'Buttons', kind: 'number', placeholder: '3' },
      { key: 'receiverId', label: 'Receiver / dongle ID', kind: 'text', placeholder: 'Unifying receiver code' },
    ],
  },
  {
    key: 'headset',
    name: 'Headset',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Logitech', 'Jabra', 'Sony', 'boAt', 'HP', 'Dell'],
    fields: [
      { key: 'connection', label: 'Connection', kind: 'select', options: CONNECTION },
      { key: 'microphone', label: 'Microphone', kind: 'select', options: ['Yes', 'No'] },
      { key: 'noiseCancelling', label: 'Noise cancelling', kind: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'docking-station',
    name: 'Docking Station',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Dell', 'Lenovo', 'HP', 'Anker', 'Targus'],
    fields: [
      { key: 'connection', label: 'Host connection', kind: 'select', options: ['USB-C', 'Thunderbolt', 'USB-A', 'Proprietary'] },
      { key: 'displayOutputs', label: 'Display outputs', kind: 'text', placeholder: '2 x HDMI, 1 x DisplayPort' },
      { key: 'powerDeliveryW', label: 'Power delivery', kind: 'number', unit: 'W', placeholder: '90' },
    ],
  },
  {
    key: 'printer',
    name: 'Printer',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['HP', 'Canon', 'Epson', 'Brother', 'Xerox', 'Ricoh'],
    fields: [
      { key: 'printerType', label: 'Type', kind: 'select', options: ['Laser', 'Inkjet', 'Dot matrix', 'Thermal'] },
      { key: 'colour', label: 'Colour', kind: 'select', options: ['Monochrome', 'Colour'] },
      { key: 'functions', label: 'Functions', kind: 'select', options: ['Print only', 'Print + Scan', 'Print + Scan + Copy', 'Print + Scan + Copy + Fax'] },
      { key: 'connectivity', label: 'Connectivity', kind: 'text', placeholder: 'USB, Ethernet, Wi-Fi' },
      { key: 'ipAddress', label: 'IP address', kind: 'text', placeholder: '192.168.1.50' },
      { key: 'tonerModel', label: 'Toner / cartridge model', kind: 'text', placeholder: 'CF217A' },
    ],
  },
  {
    key: 'network-switch',
    name: 'Network Switch',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Cisco', 'TP-Link', 'D-Link', 'Netgear', 'Ubiquiti', 'HP Aruba'],
    fields: [
      { key: 'ports', label: 'Port count', kind: 'number', placeholder: '24' },
      { key: 'speed', label: 'Speed', kind: 'select', options: ['100 Mbps', '1 Gbps', '2.5 Gbps', '10 Gbps'] },
      { key: 'managed', label: 'Managed', kind: 'select', options: ['Managed', 'Unmanaged', 'Smart / web-managed'] },
      { key: 'poe', label: 'PoE', kind: 'select', options: ['Yes', 'No'] },
      { key: 'ipAddress', label: 'Management IP', kind: 'text', placeholder: '192.168.1.2' },
    ],
  },
  {
    key: 'firewall',
    name: 'Firewall',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Cisco', 'Fortinet', 'SonicWall', 'MikroTik', 'TP-Link', 'Ubiquiti'],
    fields: [
      { key: 'wanPorts', label: 'WAN ports', kind: 'number', placeholder: '2' },
      { key: 'throughput', label: 'Throughput', kind: 'text', placeholder: '1 Gbps' },
      { key: 'ipAddress', label: 'Management IP', kind: 'text', placeholder: '192.168.1.1' },
      { key: 'licenseExpiry', label: 'Security licence expiry', kind: 'text', placeholder: '2027-03-31' },
    ],
  },
  {
    key: 'ups',
    name: 'UPS / Power Backup',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['APC', 'Luminous', 'Microtek', 'Eaton', 'V-Guard'],
    fields: [
      { key: 'capacityVa', label: 'Capacity', kind: 'number', unit: 'VA', placeholder: '1000' },
      { key: 'backupMinutes', label: 'Backup time', kind: 'number', unit: 'min', placeholder: '20' },
      { key: 'batteryType', label: 'Battery type', kind: 'text', placeholder: 'Sealed lead acid' },
      { key: 'batteryInstalled', label: 'Battery installed on', kind: 'text', placeholder: '2026-01-15' },
    ],
  },
  {
    key: 'external-storage',
    name: 'External storage',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Seagate', 'Western Digital', 'Samsung', 'SanDisk', 'Crucial', 'Kingston'],
    fields: [
      { key: 'storageType', label: 'Type', kind: 'select', options: ['External HDD', 'External SSD', 'Internal SSD', 'NAS', 'USB drive'] },
      { key: 'capacity', label: 'Capacity', kind: 'text', placeholder: '1 TB' },
      { key: 'interface', label: 'Interface', kind: 'select', options: ['USB 3.0', 'USB-C', 'Thunderbolt', 'SATA', 'NVMe'] },
      { key: 'encrypted', label: 'Encrypted', kind: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'projector',
    name: 'Projector',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber'],
    brands: ['Epson', 'BenQ', 'ViewSonic', 'Sony', 'Optoma'],
    fields: [
      { key: 'resolution', label: 'Resolution', kind: 'select', options: ['1280 x 800 (WXGA)', '1920 x 1080 (FHD)', '3840 x 2160 (4K)'] },
      { key: 'brightness', label: 'Brightness', kind: 'number', unit: 'lumens', placeholder: '3600' },
      { key: 'lampHours', label: 'Lamp hours used', kind: 'number', placeholder: '450' },
      { key: 'ports', label: 'Ports', kind: 'text', placeholder: 'HDMI, VGA, USB' },
    ],
  },
  /* ── counted, not serialised ─────────────────────────────────────────────
     Anything below is bought by the box. Forcing a serial on a cable produces
     rows nobody maintains, so these are quantity-tracked stock. */
  {
    key: 'cable',
    name: 'Cable',
    categoryKey: 'it-assets',
    tracking: 'QUANTITY',
    identity: [],
    brands: ['Amazon Basics', 'Anker', 'Belkin', 'Zebronics', 'Portronics', 'Generic'],
    fields: [
      { key: 'cableType', label: 'Cable type', kind: 'select', options: ['HDMI', 'DisplayPort', 'VGA', 'USB-A', 'USB-C', 'Ethernet (Cat 6)', 'Power', 'Audio', 'Adapter / converter'] },
      { key: 'lengthM', label: 'Length', kind: 'number', unit: 'm', placeholder: '1.5' },
      { key: 'version', label: 'Version / standard', kind: 'text', placeholder: 'HDMI 2.1' },
      { key: 'connectors', label: 'Connectors', kind: 'text', placeholder: 'HDMI-A to HDMI-A' },
    ],
  },
  {
    key: 'charger',
    name: 'Charger',
    categoryKey: 'it-assets',
    tracking: 'QUANTITY',
    identity: [],
    brands: ['Dell', 'HP', 'Lenovo', 'Apple', 'Anker', 'Generic'],
    fields: [
      { key: 'wattage', label: 'Wattage', kind: 'number', unit: 'W', placeholder: '65' },
      { key: 'connector', label: 'Connector', kind: 'text', placeholder: 'USB-C' },
      { key: 'compatibleWith', label: 'Compatible with', kind: 'text', placeholder: 'Latitude 5420' },
    ],
  },
  {
    key: 'adapter',
    name: 'Adapter',
    categoryKey: 'it-assets',
    tracking: 'QUANTITY',
    identity: [],
    brands: ['Anker', 'Belkin', 'Dell', 'HP', 'Portronics', 'Generic'],
    fields: [
      { key: 'adapterType', label: 'Adapter type', kind: 'text', placeholder: 'USB-C to HDMI' },
      { key: 'connectors', label: 'Connectors', kind: 'text', placeholder: 'USB-C male to HDMI female' },
    ],
  },
  {
    key: 'scanner',
    name: 'Scanner',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Canon', 'Epson', 'HP', 'Brother', 'Fujitsu'],
    fields: [
      { key: 'scannerType', label: 'Type', kind: 'select', options: ['Flatbed', 'Sheet-fed', 'Handheld', 'Document scanner'] },
      { key: 'dpi', label: 'Optical resolution', kind: 'number', unit: 'dpi', placeholder: '600' },
      { key: 'duplex', label: 'Duplex scanning', kind: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'server',
    name: 'Server',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Dell', 'HP', 'Lenovo', 'IBM', 'Supermicro'],
    fields: [
      { key: 'cpu', label: 'Processor', kind: 'text', placeholder: '2 x Xeon Silver 4310' },
      { key: 'ramGb', label: 'RAM', kind: 'number', unit: 'GB', placeholder: '64' },
      { key: 'storage', label: 'Storage', kind: 'text', placeholder: '4 x 960 GB SSD, RAID 10' },
      { key: 'formFactor', label: 'Form factor', kind: 'select', options: ['Rack 1U', 'Rack 2U', 'Tower', 'Blade'] },
      { key: 'ipAddress', label: 'Management IP', kind: 'text', placeholder: '192.168.1.10' },
      { key: 'os', label: 'Operating system', kind: 'text', placeholder: 'Windows Server 2022' },
    ],
  },
  {
    key: 'wireless-access-point',
    name: 'Wireless access point',
    categoryKey: 'it-assets',
    tracking: 'INDIVIDUAL',
    identity: ['serialNumber', 'macAddress'],
    brands: ['Ubiquiti', 'Cisco', 'TP-Link', 'Netgear', 'Aruba'],
    fields: [
      { key: 'wifiStandard', label: 'Wi-Fi standard', kind: 'select', options: ['Wi-Fi 5 (ac)', 'Wi-Fi 6 (ax)', 'Wi-Fi 6E', 'Wi-Fi 7'] },
      { key: 'bands', label: 'Bands', kind: 'select', options: ['2.4 GHz', '5 GHz', 'Dual band', 'Tri band'] },
      { key: 'poe', label: 'PoE powered', kind: 'select', options: ['Yes', 'No'] },
      { key: 'ipAddress', label: 'Management IP', kind: 'text', placeholder: '192.168.1.20' },
    ],
  },
] as const;

export const ASSET_TYPES_BY_KEY: Readonly<Record<string, AssetTypeDef>> = Object.fromEntries(
  ASSET_TYPES.map((t) => [t.key, t]),
);

/** Types offered under a category, in catalogue order. */
export function assetTypesForCategory(categoryKey: string): AssetTypeDef[] {
  return ASSET_TYPES.filter((t) => t.categoryKey === categoryKey);
}

/**
 * Keep only the fields this type declares, drop blanks, and cap length so a
 * crafted payload cannot turn `specs` into a document store. Returns undefined
 * when nothing survives, so the column stays null rather than holding `{}`.
 */
export function sanitizeAssetSpecs(
  typeKey: string | null | undefined,
  specs: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (!typeKey || !specs) return undefined;
  const def = ASSET_TYPES_BY_KEY[typeKey];
  if (!def) return undefined;

  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const raw = specs[field.key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    out[field.key] = value.slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Label lookup for rendering a stored specs object on a detail page. */
export function assetSpecLabel(typeKey: string, fieldKey: string): string {
  return ASSET_TYPES_BY_KEY[typeKey]?.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey;
}

/** MAC in any common notation -> AA:BB:CC:DD:EE:FF, or null when unusable. */
export function normalizeMacAddress(input: string | null | undefined): string | null {
  if (!input) return null;
  const hex = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return (hex.match(/.{2}/g) ?? []).join(':');
}

/** IMEI is 15 digits; 14 is accepted and left as typed (some labels omit the check digit). */
export function normalizeImei(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 14 || digits.length > 16) return null;
  return digits;
}
