import { PrismaClient, Prisma, type RequestType, type ApproverType } from '@prisma/client';
import { WORKFLOW_TEMPLATES, ONBOARDING_TEMPLATE } from '@techpioasset/domain';

/**
 * Workflow definitions from spec section 11.
 *
 * Seeded as ordinary data, not code, because section 11 requires Super Admins to
 * reconfigure steps, approvers, thresholds and bypass rules at runtime. These are
 * starting points, not fixed rules.
 */

export async function seedWorkflows(prisma: PrismaClient, companyId: string): Promise<void> {
  const roles = await prisma.role.findMany({ where: { companyId } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));

  for (const workflow of WORKFLOW_TEMPLATES) {
    const definition = await prisma.workflowDefinition.upsert({
      where: { companyId_key: { companyId, key: workflow.key } },
      update: { name: workflow.name, description: workflow.description, isActive: true },
      create: {
        companyId,
        key: workflow.key,
        name: workflow.name,
        description: workflow.description,
        requestType: workflow.requestType as RequestType | null,
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
          approverType: step.approverType as ApproverType,
          approverRoleId: step.roleKey ? (roleByKey.get(step.roleKey) ?? null) : null,
          costThreshold: step.costThreshold ? new Prisma.Decimal(step.costThreshold) : null,
          isSkippable: step.isSkippable ?? false,
          slaHours: step.slaHours ?? null,
        },
        create: {
          workflowDefinitionId: definition.id,
          stepOrder: step.order,
          name: step.name,
          approverType: step.approverType as ApproverType,
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
    `  workflows             ${WORKFLOW_TEMPLATES.length} definitions, ` +
      `${WORKFLOW_TEMPLATES.reduce((n, w) => n + w.steps.length, 0)} steps`,
  );
  console.log(`  onboarding template   ${ONBOARDING_TEMPLATE.items.length} items`);
}
