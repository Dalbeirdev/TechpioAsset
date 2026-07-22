import { hash } from '@node-rs/argon2';
import { PrismaClient, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type { SystemRole } from '@techpioasset/domain';
import { ARGON2_PARAMS } from '../../src/auth/argon2-params.js';

/**
 * Demonstration data (spec section 25).
 *
 * DEVELOPMENT ONLY. Every account below shares one well-known password, which is
 * exactly why `NODE_ENV=production` refuses to run this and the API refuses to
 * boot with a development JWT secret.
 */

export const DEMO_PASSWORD = 'TechpioDemo!2026';

interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: SystemRole;
  department: string;
  managerEmail?: string;
}

const DEMO_USERS: DemoUser[] = [
  {
    email: 'admin@techpioasset.dev',
    firstName: 'Priya',
    lastName: 'Raman',
    jobTitle: 'Platform Owner',
    role: 'SUPER_ADMIN',
    department: 'IT',
  },
  {
    email: 'it@techpioasset.dev',
    firstName: 'Marcus',
    lastName: 'Bell',
    jobTitle: 'IT Administrator',
    role: 'IT_ADMIN',
    department: 'IT',
  },
  {
    email: 'hr@techpioasset.dev',
    firstName: 'Sofia',
    lastName: 'Almeida',
    jobTitle: 'HR Manager',
    role: 'HR',
    department: 'People',
  },
  {
    email: 'office@techpioasset.dev',
    firstName: 'Tom',
    lastName: 'Okafor',
    jobTitle: 'Office Administrator',
    role: 'OFFICE_ADMIN',
    department: 'Operations',
  },
  {
    email: 'finance@techpioasset.dev',
    firstName: 'Hannah',
    lastName: 'Lindqvist',
    jobTitle: 'Finance Lead',
    role: 'FINANCE',
    department: 'Finance',
  },
  {
    email: 'manager@techpioasset.dev',
    firstName: 'Daniel',
    lastName: 'Whyte',
    jobTitle: 'Engineering Manager',
    role: 'MANAGER',
    department: 'Engineering',
  },
  {
    email: 'auditor@techpioasset.dev',
    firstName: 'Grace',
    lastName: 'Ferreira',
    jobTitle: 'Internal Auditor',
    role: 'AUDITOR',
    department: 'Finance',
  },
  {
    email: 'employee@techpioasset.dev',
    firstName: 'Ravi',
    lastName: 'Menon',
    jobTitle: 'Software Engineer',
    role: 'EMPLOYEE',
    department: 'Engineering',
    managerEmail: 'manager@techpioasset.dev',
  },
  {
    email: 'employee2@techpioasset.dev',
    firstName: 'Lena',
    lastName: 'Fischer',
    jobTitle: 'Product Designer',
    role: 'EMPLOYEE',
    department: 'Engineering',
    managerEmail: 'manager@techpioasset.dev',
  },
  {
    email: 'employee3@techpioasset.dev',
    firstName: 'Ben',
    lastName: 'Carter',
    jobTitle: 'Support Specialist',
    role: 'EMPLOYEE',
    department: 'Operations',
    managerEmail: 'manager@techpioasset.dev',
  },
];

const DEPARTMENTS = [
  { code: 'IT', name: 'IT' },
  { code: 'PEOPLE', name: 'People' },
  { code: 'OPS', name: 'Operations' },
  { code: 'FIN', name: 'Finance' },
  { code: 'ENG', name: 'Engineering' },
];

const VENDORS = [
  { code: 'DELL', name: 'Dell Technologies', contactEmail: 'orders@dell.example' },
  { code: 'APPLE', name: 'Apple Business', contactEmail: 'business@apple.example' },
  { code: 'HERMAN', name: 'Herman Miller', contactEmail: 'sales@hermanmiller.example' },
  { code: 'NESPRESSO', name: 'Nespresso Pro', contactEmail: 'pro@nespresso.example' },
  { code: 'OFFICEDEPOT', name: 'Office Depot', contactEmail: 'b2b@officedepot.example' },
];

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

export async function seedDemo(prisma: PrismaClient, companyId: string): Promise<void> {
  console.log('\nSeeding demonstration data (development only)...');

  // ── Office, buildings, floors, rooms ──────────────────────────────────────
  const office = await prisma.office.upsert({
    where: { companyId_code: { companyId, code: 'HQ' } },
    update: {},
    create: {
      companyId,
      code: 'HQ',
      name: 'Bengaluru HQ',
      city: 'Bengaluru',
      country: 'India',
      timezone: 'Asia/Kolkata',
    },
  });

  const building = await prisma.building.upsert({
    where: { officeId_name: { officeId: office.id, name: 'Tower A' } },
    update: {},
    create: { officeId: office.id, name: 'Tower A', code: 'TA' },
  });

  const floors = [];
  for (const [level, name] of [
    [1, 'Level 1'],
    [2, 'Level 2'],
  ] as const) {
    floors.push(
      await prisma.floor.upsert({
        where: { buildingId_name: { buildingId: building.id, name } },
        update: {},
        create: { buildingId: building.id, name, level },
      }),
    );
  }

  const rooms: Record<string, string> = {};
  const roomSpecs = [
    { floor: 0, name: 'Engineering Bay', code: 'L1-ENG', storage: false },
    { floor: 0, name: 'Kitchen', code: 'L1-KIT', storage: false },
    { floor: 1, name: 'IT Store', code: 'L2-STORE', storage: true },
    { floor: 1, name: 'Meeting Room Kestrel', code: 'L2-MR1', storage: false },
  ];
  for (const spec of roomSpecs) {
    const floor = floors[spec.floor]!;
    const room = await prisma.room.upsert({
      where: { floorId_name: { floorId: floor.id, name: spec.name } },
      update: {},
      create: {
        floorId: floor.id,
        name: spec.name,
        code: spec.code,
        isStorageLocation: spec.storage,
      },
    });
    rooms[spec.name] = room.id;
  }

  // ── Departments ───────────────────────────────────────────────────────────
  const departments: Record<string, string> = {};
  for (const dept of DEPARTMENTS) {
    const record = await prisma.department.upsert({
      where: { companyId_code: { companyId, code: dept.code } },
      update: { name: dept.name },
      create: { companyId, code: dept.code, name: dept.name, officeId: office.id },
    });
    departments[dept.name] = record.id;
  }

  // ── Vendors ───────────────────────────────────────────────────────────────
  const vendors: Record<string, string> = {};
  for (const vendor of VENDORS) {
    const record = await prisma.vendor.upsert({
      where: { companyId_code: { companyId, code: vendor.code } },
      update: { name: vendor.name },
      create: { companyId, ...vendor },
    });
    vendors[vendor.code] = record.id;
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await hash(DEMO_PASSWORD, ARGON2_PARAMS);
  const roles = await prisma.role.findMany({ where: { companyId } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));
  const userIds: Record<string, string> = {};

  for (const spec of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId, email: spec.email } },
      update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      create: {
        companyId,
        email: spec.email,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    userIds[spec.email] = user.id;

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {
        firstName: spec.firstName,
        lastName: spec.lastName,
        jobTitle: spec.jobTitle,
        departmentId: departments[spec.department] ?? null,
        officeId: office.id,
      },
      create: {
        userId: user.id,
        firstName: spec.firstName,
        lastName: spec.lastName,
        displayName: `${spec.firstName} ${spec.lastName}`,
        jobTitle: spec.jobTitle,
        employeeNumber: `EMP-${String(Object.keys(userIds).length).padStart(4, '0')}`,
        departmentId: departments[spec.department] ?? null,
        officeId: office.id,
        hireDate: daysFromNow(-400),
      },
    });

    const roleId = roleByKey.get(spec.role);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
    }
  }

  // Line-manager links drive the MANAGER role's DIRECT_REPORTS scope.
  for (const spec of DEMO_USERS) {
    if (!spec.managerEmail) continue;
    await prisma.userProfile.update({
      where: { userId: userIds[spec.email]! },
      data: { managerId: userIds[spec.managerEmail] ?? null },
    });
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  const categories = await prisma.category.findMany({
    where: { companyId },
    include: { subcategories: true },
  });
  const catByKey = new Map(categories.map((c) => [c.key, c]));
  const subId = (categoryKey: string, subKey: string) =>
    catByKey.get(categoryKey)?.subcategories.find((s) => s.key === subKey)?.id ?? null;

  interface AssetSpec {
    tag: string;
    name: string;
    categoryKey: string;
    subKey: string;
    brand: string;
    model: string;
    serial: string;
    cost: string;
    vendor: string;
    status: 'AVAILABLE' | 'ASSIGNED' | 'UNDER_REPAIR' | 'IN_STORAGE' | 'DAMAGED';
    assignTo?: string;
    room?: string;
    warrantyEndsInDays?: number;
    condition?: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED';
  }

  const assetSpecs: AssetSpec[] = [
    // Assigned laptops - exercise the assignment path and employee isolation.
    {
      tag: 'LAP-0001',
      name: 'MacBook Pro 14"',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Apple',
      model: 'M3 Pro',
      serial: 'C02X1001AB',
      cost: '2399.00',
      vendor: 'APPLE',
      status: 'ASSIGNED',
      assignTo: 'employee@techpioasset.dev',
      room: 'Engineering Bay',
      warrantyEndsInDays: 400,
    },
    {
      tag: 'LAP-0002',
      name: 'MacBook Air 13"',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Apple',
      model: 'M3',
      serial: 'C02X1002CD',
      cost: '1499.00',
      vendor: 'APPLE',
      status: 'ASSIGNED',
      assignTo: 'employee2@techpioasset.dev',
      room: 'Engineering Bay',
      warrantyEndsInDays: 25,
    },
    {
      tag: 'LAP-0003',
      name: 'Dell Latitude 7450',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Dell',
      model: '7450',
      serial: 'DL7450X003',
      cost: '1699.00',
      vendor: 'DELL',
      status: 'ASSIGNED',
      assignTo: 'manager@techpioasset.dev',
      room: 'Engineering Bay',
      warrantyEndsInDays: 200,
    },
    // Available stock.
    {
      tag: 'LAP-0004',
      name: 'Dell Latitude 7450',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Dell',
      model: '7450',
      serial: 'DL7450X004',
      cost: '1699.00',
      vendor: 'DELL',
      status: 'AVAILABLE',
      room: 'IT Store',
      warrantyEndsInDays: 500,
    },
    {
      tag: 'LAP-0005',
      name: 'Dell Latitude 5450',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Dell',
      model: '5450',
      serial: 'DL5450X005',
      cost: '1199.00',
      vendor: 'DELL',
      status: 'AVAILABLE',
      room: 'IT Store',
      warrantyEndsInDays: 55,
    },
    // Warranty expiring inside 30 days - drives the dashboard alert.
    {
      tag: 'MON-0001',
      name: 'Dell UltraSharp 27"',
      categoryKey: 'it-assets',
      subKey: 'monitor',
      brand: 'Dell',
      model: 'U2723QE',
      serial: 'MON27X001',
      cost: '549.00',
      vendor: 'DELL',
      status: 'ASSIGNED',
      assignTo: 'employee@techpioasset.dev',
      room: 'Engineering Bay',
      warrantyEndsInDays: 18,
    },
    {
      tag: 'MON-0002',
      name: 'Dell UltraSharp 27"',
      categoryKey: 'it-assets',
      subKey: 'monitor',
      brand: 'Dell',
      model: 'U2723QE',
      serial: 'MON27X002',
      cost: '549.00',
      vendor: 'DELL',
      status: 'AVAILABLE',
      room: 'IT Store',
      warrantyEndsInDays: 300,
    },
    // Under repair.
    {
      tag: 'LAP-0006',
      name: 'MacBook Pro 16"',
      categoryKey: 'it-assets',
      subKey: 'laptop',
      brand: 'Apple',
      model: 'M2 Max',
      serial: 'C02X1006EF',
      cost: '3199.00',
      vendor: 'APPLE',
      status: 'UNDER_REPAIR',
      room: 'IT Store',
      condition: 'POOR',
      warrantyEndsInDays: -30,
    },
    // Damaged.
    {
      tag: 'MON-0003',
      name: 'LG 24" Monitor',
      categoryKey: 'it-assets',
      subKey: 'monitor',
      brand: 'LG',
      model: '24QP550',
      serial: 'LG24X003',
      cost: '229.00',
      vendor: 'DELL',
      status: 'DAMAGED',
      room: 'IT Store',
      condition: 'DAMAGED',
    },
    // Furniture - Office Admin territory.
    {
      tag: 'CHR-0001',
      name: 'Aeron Chair',
      categoryKey: 'furniture',
      subKey: 'office-chair',
      brand: 'Herman Miller',
      model: 'Aeron B',
      serial: 'HM-AER-001',
      cost: '1395.00',
      vendor: 'HERMAN',
      status: 'ASSIGNED',
      assignTo: 'employee@techpioasset.dev',
      room: 'Engineering Bay',
    },
    {
      tag: 'CHR-0002',
      name: 'Aeron Chair',
      categoryKey: 'furniture',
      subKey: 'office-chair',
      brand: 'Herman Miller',
      model: 'Aeron B',
      serial: 'HM-AER-002',
      cost: '1395.00',
      vendor: 'HERMAN',
      status: 'AVAILABLE',
      room: 'Engineering Bay',
    },
    {
      tag: 'DSK-0001',
      name: 'Sit-stand Desk',
      categoryKey: 'furniture',
      subKey: 'desk',
      brand: 'Herman Miller',
      model: 'Nevi',
      serial: 'HM-NEV-001',
      cost: '899.00',
      vendor: 'HERMAN',
      status: 'AVAILABLE',
      room: 'Engineering Bay',
    },
    // Kitchen.
    {
      tag: 'KIT-0001',
      name: 'Nespresso Momento',
      categoryKey: 'kitchen-and-pantry',
      subKey: 'coffee-machine',
      brand: 'Nespresso',
      model: 'Momento 200',
      serial: 'NES-MOM-001',
      cost: '2199.00',
      vendor: 'NESPRESSO',
      status: 'AVAILABLE',
      room: 'Kitchen',
      warrantyEndsInDays: 75,
    },
    {
      tag: 'KIT-0002',
      name: 'Samsung Refrigerator',
      categoryKey: 'kitchen-and-pantry',
      subKey: 'refrigerator',
      brand: 'Samsung',
      model: 'RT42',
      serial: 'SAM-RT42-001',
      cost: '649.00',
      vendor: 'OFFICEDEPOT',
      status: 'AVAILABLE',
      room: 'Kitchen',
    },
  ];

  let created = 0;
  for (const spec of assetSpecs) {
    const category = catByKey.get(spec.categoryKey);
    if (!category) continue;

    const existing = await prisma.asset.findFirst({
      where: { companyId, assetTag: spec.tag },
    });
    if (existing) continue;

    const asset = await prisma.asset.create({
      data: {
        companyId,
        assetTag: spec.tag,
        name: spec.name,
        categoryId: category.id,
        subcategoryId: subId(spec.categoryKey, spec.subKey),
        trackingType: 'INDIVIDUAL',
        brand: spec.brand,
        model: spec.model,
        serialNumber: spec.serial,
        qrToken: ulid(),
        purchaseDate: daysFromNow(-300),
        purchaseCost: new Prisma.Decimal(spec.cost),
        currency: 'USD',
        currentValue: new Prisma.Decimal(spec.cost).times(0.7).toDecimalPlaces(2),
        vendorId: vendors[spec.vendor] ?? null,
        warrantyStartDate: daysFromNow(-300),
        warrantyEndDate:
          spec.warrantyEndsInDays === undefined ? null : daysFromNow(spec.warrantyEndsInDays),
        officeId: office.id,
        buildingId: building.id,
        roomId: spec.room ? (rooms[spec.room] ?? null) : null,
        departmentId: departments.Engineering ?? null,
        condition: spec.condition ?? 'GOOD',
        status: spec.status,
      },
    });
    created += 1;

    if (spec.status === 'ASSIGNED' && spec.assignTo) {
      const holderId = userIds[spec.assignTo]!;
      const assignment = await prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          userId: holderId,
          assignedById: userIds['it@techpioasset.dev']!,
          assignedAt: daysFromNow(-90),
          conditionOut: 'GOOD',
          // One assignment is left unacknowledged so the receipt-confirmation
          // flow has something to act on.
          acknowledgedAt: spec.tag === 'LAP-0002' ? null : daysFromNow(-89),
          acknowledgementMethod: spec.tag === 'LAP-0002' ? null : 'IN_APP',
        },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          assignedUserId: holderId,
          assignmentDate: assignment.assignedAt,
          departmentId:
            departments[DEMO_USERS.find((u) => u.email === spec.assignTo)?.department ?? ''] ??
            null,
        },
      });
    }
  }

  // ── Quantity-tracked consumables ──────────────────────────────────────────
  const consumables = catByKey.get('consumables');
  if (consumables) {
    const stock = [
      {
        sku: 'CON-PAPER-A4',
        name: 'A4 paper (ream)',
        sub: 'paper',
        qty: 120,
        min: 40,
        reorder: 60,
        cost: '4.20',
      },
      {
        sku: 'CON-TONER-HP',
        name: 'HP 26X toner',
        sub: 'printer-toner',
        qty: 6,
        min: 4,
        reorder: 6,
        cost: '148.00',
      },
      {
        sku: 'CON-COFFEE',
        name: 'Coffee capsules (box of 50)',
        sub: 'pantry-products',
        qty: 18,
        min: 20,
        reorder: 25,
        cost: '32.50',
      },
      {
        sku: 'CON-BATT-AA',
        name: 'AA batteries (pack of 10)',
        sub: 'batteries',
        qty: 45,
        min: 20,
        reorder: 30,
        cost: '9.90',
      },
    ];

    for (const item of stock) {
      const existing = await prisma.inventoryItem.findFirst({
        where: { companyId, sku: item.sku },
      });
      if (existing) continue;
      await prisma.inventoryItem.create({
        data: {
          companyId,
          sku: item.sku,
          name: item.name,
          categoryId: consumables.id,
          subcategoryId: subId('consumables', item.sub),
          unit: 'unit',
          quantityOnHand: new Prisma.Decimal(item.qty),
          minStock: new Prisma.Decimal(item.min),
          // CON-COFFEE is deliberately below its reorder level so the low-stock
          // dashboard tile has a real row to show.
          reorderLevel: new Prisma.Decimal(item.reorder),
          unitCost: new Prisma.Decimal(item.cost),
          averageCost: new Prisma.Decimal(item.cost),
          currency: 'USD',
          officeId: office.id,
          roomId: rooms['IT Store'] ?? null,
          lastPurchaseDate: daysFromNow(-45),
        },
      });
    }
  }

  console.log(`  users                 ${DEMO_USERS.length}`);
  console.log(`  offices/rooms         1 office, ${roomSpecs.length} rooms`);
  console.log(`  departments           ${DEPARTMENTS.length}`);
  console.log(`  vendors               ${VENDORS.length}`);
  console.log(`  assets                ${created} created (${assetSpecs.length} defined)`);
  console.log(`  inventory items       4`);
  console.log(`\n  Demo password for every account: ${DEMO_PASSWORD}`);
  console.log('  DEVELOPMENT ONLY - never load this data into a production environment.');
}
