import type { TrackingType } from '@prisma/client';

/**
 * Asset catalogue from spec section 4, verbatim.
 *
 * `defaultTrackingType` encodes section 5: individually tracked items get their
 * own asset ID, QR code and lifecycle; quantity-tracked stock carries a balance.
 * Consumables and pantry supplies are QUANTITY; everything with a serial is
 * INDIVIDUAL.
 */

export interface SubcategorySeed {
  key: string;
  name: string;
}

export interface CategorySeed {
  key: string;
  name: string;
  icon: string;
  defaultTrackingType: TrackingType;
  subcategories: SubcategorySeed[];
}

const sub = (name: string): SubcategorySeed => ({
  key: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  name,
});

export const CATEGORY_SEED: CategorySeed[] = [
  {
    key: 'it-assets',
    name: 'IT assets',
    icon: 'Laptop',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'Laptop',
      'Desktop',
      'Monitor',
      'Docking station',
      'Keyboard',
      'Mouse',
      'Headset',
      'Mobile phone',
      'Tablet',
      'Printer',
      'Scanner',
      'Server',
      'Firewall',
      'Network switch',
      'Wireless access point',
      'UPS',
      'Charger',
      'Adapter',
      'External storage',
    ].map(sub),
  },
  {
    key: 'furniture',
    name: 'Furniture',
    icon: 'Armchair',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'Desk',
      'Office chair',
      'Conference table',
      'Cabinet',
      'Storage rack',
      'Bookshelf',
      'Reception furniture',
      'Whiteboard',
      'Office partition',
    ].map(sub),
  },
  {
    key: 'kitchen-and-pantry',
    name: 'Kitchen and pantry',
    icon: 'CookingPot',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'Refrigerator',
      'Microwave',
      'Coffee machine',
      'Water dispenser',
      'Dishwasher',
      'Kettle',
      'Toaster',
      'Kitchen cabinet',
      'Cups',
      'Plates',
      'Cutlery',
      'Pantry supplies',
      'Cleaning supplies',
    ].map(sub),
  },
  {
    key: 'office-equipment',
    name: 'Office equipment',
    icon: 'Projector',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'Projector',
      'Television',
      'Conference-room device',
      'Camera',
      'Speaker',
      'Shredder',
      'Binding machine',
      'Label printer',
      'Attendance device',
    ].map(sub),
  },
  {
    key: 'facilities-and-safety',
    name: 'Facilities and safety',
    icon: 'ShieldCheck',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'CCTV camera',
      'Access-control device',
      'Fire extinguisher',
      'First-aid kit',
      'Emergency light',
      'Generator',
      'Air conditioner',
      'Electrical equipment',
    ].map(sub),
  },
  {
    key: 'software-and-subscriptions',
    name: 'Software and subscriptions',
    icon: 'KeyRound',
    defaultTrackingType: 'INDIVIDUAL',
    subcategories: [
      'Microsoft 365 license',
      'Antivirus license',
      'Accounting software',
      'HR software',
      'Design software',
      'SaaS subscription',
      'Domain registration',
      'SSL certificate',
    ].map(sub),
  },
  {
    key: 'consumables',
    name: 'Consumables',
    icon: 'Package',
    defaultTrackingType: 'QUANTITY',
    subcategories: [
      'Printer toner',
      'Paper',
      'Stationery',
      'Cleaning products',
      'Pantry products',
      'Batteries',
      'Cables',
      'Small accessories',
    ].map(sub),
  },
];
