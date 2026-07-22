import { PrismaClient, Prisma, type RequestType, type ApproverType } from '@prisma/client';

/**
 * Workflow definitions from spec section 11.
 *
 * Seeded as ordinary data, not code, because section 11 requires Super Admins to
 * reconfigure steps, approvers, thresholds and bypass rules at runtime. These are
 * starting points, not fixed rules.
 */

interface StepSeed {
  order: number;
  name: string;
  approverType: ApproverType;
  roleKey?: string;
  /** Step applies only above this figure (section 11's kitchen threshold). */
  costThreshold?: string;
  isSkippable?: boolean;
  slaHours?: number;
}

interface WorkflowSeed {
  key: string;
  name: string;
  description: string;
  /** null is the catch-all applied to any type without its own definition. */
  requestType: RequestType | null;
  steps: StepSeed[];
}

const WORKFLOWS: WorkflowSeed[] = [
  {
    key: 'it-equipment',
    name: 'IT equipment request',
    description:
      'Employee submits, manager reviews, HR confirms employment, IT checks inventory and ' +
      'specifications, Finance approves when a purchase is needed.',
    requestType: null, // catch-all; IT is the most common shape
    steps: [
      { order: 1, name: 'Manager review', approverType: 'LINE_MANAGER', slaHours: 48 },
      { order: 2, name: 'HR confirmation', approverType: 'ROLE', roleKey: 'HR', slaHours: 48 },
      { order: 3, name: 'IT review', approverType: 'ROLE', roleKey: 'IT_ADMIN', slaHours: 72 },
      {
        order: 4,
        name: 'Finance approval',
        approverType: 'ROLE',
        roleKey: 'FINANCE',
        // Section 11 step 5: finance approves "when a purchase is needed". Small
        // items come out of existing stock and do not need a finance signature.
        costThreshold: '250.00',
        isSkippable: true,
        slaHours: 72,
      },
    ],
  },
  {
    key: 'onboarding-equipment',
    name: 'New employee onboarding',
    description: 'HR-initiated onboarding equipment, reviewed by IT and Finance above threshold.',
    requestType: 'NEW_EMPLOYEE_ONBOARDING',
    steps: [
      { order: 1, name: 'HR confirmation', approverType: 'ROLE', roleKey: 'HR', slaHours: 24 },
      { order: 2, name: 'IT review', approverType: 'ROLE', roleKey: 'IT_ADMIN', slaHours: 48 },
      {
        order: 3,
        name: 'Finance approval',
        approverType: 'ROLE',
        roleKey: 'FINANCE',
        costThreshold: '1000.00',
        isSkippable: true,
      },
    ],
  },
  {
    key: 'furniture',
    name: 'Furniture request',
    description:
      'Employee submits, manager reviews, Office Admin checks availability, Finance approves ' +
      'when required.',
    requestType: 'OFFICE_REQUIREMENT',
    steps: [
      { order: 1, name: 'Manager review', approverType: 'LINE_MANAGER', slaHours: 48 },
      {
        order: 2,
        name: 'Office review',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        slaHours: 72,
      },
      {
        order: 3,
        name: 'Finance approval',
        approverType: 'ROLE',
        roleKey: 'FINANCE',
        costThreshold: '500.00',
        isSkippable: true,
      },
    ],
  },
  {
    key: 'kitchen',
    name: 'Kitchen and pantry request',
    description:
      'Office Admin reviews. Finance approval only above a configurable cost threshold ' +
      '(spec section 11).',
    requestType: 'KITCHEN_REQUIREMENT',
    steps: [
      {
        order: 1,
        name: 'Office review',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        slaHours: 48,
      },
      {
        order: 2,
        name: 'Finance approval',
        approverType: 'ROLE',
        roleKey: 'FINANCE',
        costThreshold: '200.00',
        isSkippable: true,
      },
    ],
  },
  {
    key: 'repair',
    name: 'Repair request',
    description: 'Straight to IT; repairs should not queue behind a manager signature.',
    requestType: 'REPAIR',
    steps: [
      { order: 1, name: 'IT review', approverType: 'ROLE', roleKey: 'IT_ADMIN', slaHours: 24 },
    ],
  },
];

const ONBOARDING_TEMPLATE = {
  key: 'engineer-standard',
  name: 'Engineer — standard kit',
  items: [
    { description: 'Laptop', quantity: 1, isRequired: true, categoryKey: 'it-assets' },
    { description: 'Monitor', quantity: 1, isRequired: true, categoryKey: 'it-assets' },
    { description: 'Keyboard and mouse', quantity: 1, isRequired: true, categoryKey: 'it-assets' },
    { description: 'Headset', quantity: 1, isRequired: false, categoryKey: 'it-assets' },
    { description: 'Office chair', quantity: 1, isRequired: true, categoryKey: 'furniture' },
    { description: 'Desk', quantity: 1, isRequired: false, categoryKey: 'furniture' },
  ],
};

export async function seedWorkflows(prisma: PrismaClient, companyId: string): Promise<void> {
  const roles = await prisma.role.findMany({ where: { companyId } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));

  for (const workflow of WORKFLOWS) {
    const definition = await prisma.workflowDefinition.upsert({
      where: { companyId_key: { companyId, key: workflow.key } },
      update: { name: workflow.name, description: workflow.description, isActive: true },
      create: {
        companyId,
        key: workflow.key,
        name: workflow.name,
        description: workflow.description,
        requestType: workflow.requestType,
      },
    });

    for (const step of workflow.steps) {
      await prisma.workflowStep.upsert({
        where: {
          workflowDefinitionId_stepOrder: {
            workflowDefinitionId: definition.id,
            stepOrder: step.order,
          },
        },
        update: {
          name: step.name,
          approverType: step.approverType,
          approverRoleId: step.roleKey ? (roleByKey.get(step.roleKey) ?? null) : null,
          costThreshold: step.costThreshold ? new Prisma.Decimal(step.costThreshold) : null,
          isSkippable: step.isSkippable ?? false,
          slaHours: step.slaHours ?? null,
        },
        create: {
          workflowDefinitionId: definition.id,
          stepOrder: step.order,
          name: step.name,
          approverType: step.approverType,
          approverRoleId: step.roleKey ? (roleByKey.get(step.roleKey) ?? null) : null,
          costThreshold: step.costThreshold ? new Prisma.Decimal(step.costThreshold) : null,
          isSkippable: step.isSkippable ?? false,
          slaHours: step.slaHours ?? null,
        },
      });
    }
  }

  const categories = await prisma.category.findMany({ where: { companyId } });
  const categoryByKey = new Map(categories.map((c) => [c.key, c.id]));

  const template = await prisma.onboardingTemplate.upsert({
    where: { companyId_key: { companyId, key: ONBOARDING_TEMPLATE.key } },
    update: { name: ONBOARDING_TEMPLATE.name, isActive: true },
    create: { companyId, key: ONBOARDING_TEMPLATE.key, name: ONBOARDING_TEMPLATE.name },
  });

  const existingItems = await prisma.onboardingTemplateItem.count({
    where: { templateId: template.id },
  });
  if (existingItems === 0) {
    await prisma.onboardingTemplateItem.createMany({
      data: ONBOARDING_TEMPLATE.items.map((item, index) => ({
        templateId: template.id,
        description: item.description,
        quantity: new Prisma.Decimal(item.quantity),
        isRequired: item.isRequired,
        sortOrder: index,
        categoryId: categoryByKey.get(item.categoryKey) ?? null,
      })),
    });
  }

  console.log(
    `  workflows             ${WORKFLOWS.length} definitions, ` +
      `${WORKFLOWS.reduce((n, w) => n + w.steps.length, 0)} steps`,
  );
  console.log(`  onboarding template   ${ONBOARDING_TEMPLATE.items.length} items`);
}
