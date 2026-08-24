/**
 * Approval workflow templates (spec section 11).
 *
 * v2.7 R5: moved here from the seed so the demo seed AND tenant provisioning
 * build from ONE source - a tenant provisioned through the platform plane
 * must get the same real approval chains as a seeded one, not an empty
 * workflow table that silently skips approval.
 *
 * These are starting points, not fixed rules: section 11 requires Super Admins
 * to reconfigure steps, approvers and thresholds at runtime.
 */

/** Mirrors the Prisma RequestType/ApproverType enums as plain strings, so the
 *  domain stays free of a database dependency; consumers cast at the edge. */
export interface WorkflowStepTemplate {
  order: number;
  name: string;
  approverType: string;
  roleKey?: string;
  /** Step applies only above this figure (section 11's kitchen threshold). */
  costThreshold?: string;
  isSkippable?: boolean;
  slaHours?: number;
  /**
   * v2.25 - what the step asks of its holder. Assessment stages are completed
   * by recording the answer rather than by approving.
   */
  kind?: 'APPROVAL' | 'INVENTORY_CHECK' | 'COST_ASSESSMENT';
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  /** null is the catch-all applied to any type without its own definition. */
  requestType: string | null;
  steps: WorkflowStepTemplate[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
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
      // v2.25 - the commercial half, as two stages rather than one hidden
      // panel. The inventory check answers "do we already have one?"; only if
      // the answer is no does anything need pricing, so the cost stage stands
      // aside when it is yes.
      {
        order: 4,
        name: 'Inventory check',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        kind: 'INVENTORY_CHECK',
        slaHours: 48,
      },
      {
        order: 5,
        name: 'Cost assessment',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        kind: 'COST_ASSESSMENT',
        slaHours: 48,
      },
      {
        order: 6,
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
  {
    key: 'damage',
    name: 'Damage report',
    description:
      'Kit that is already issued and has broken. IT decides repair or replace, stock is ' +
      'checked, and only a purchase reaches Finance.',
    requestType: 'DAMAGE',
    /**
     * v2.27 - damage used to fall to the six-step catch-all, so reporting a
     * broken laptop travelled exactly as far as asking for a brand new one.
     *
     * Manager review and HR confirmation are dropped deliberately, and the
     * reason is the same for both: this device was already authorised once.
     * HR confirms employment before someone is given equipment - they already
     * have it. A manager authorises new spend for a report - restoring kit that
     * was already approved is not a new want. Control over money is not lost:
     * it moves to the Finance threshold, which is the step that actually
     * governs spending.
     *
     * In practice this is usually two steps, not four. If there is a spare on
     * the shelf, the inventory check answers yes and both the costing and
     * Finance stand aside - nothing is bought, so nothing needs pricing.
     */
    steps: [
      { order: 1, name: 'IT review', approverType: 'ROLE', roleKey: 'IT_ADMIN', slaHours: 24 },
      {
        order: 2,
        name: 'Inventory check',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        kind: 'INVENTORY_CHECK',
        slaHours: 48,
      },
      {
        order: 3,
        name: 'Cost assessment',
        approverType: 'ROLE',
        roleKey: 'OFFICE_ADMIN',
        kind: 'COST_ASSESSMENT',
        slaHours: 48,
      },
      {
        order: 4,
        name: 'Finance approval',
        approverType: 'ROLE',
        roleKey: 'FINANCE',
        costThreshold: '250.00',
        isSkippable: true,
        slaHours: 48,
      },
    ],
  },
];

export const ONBOARDING_TEMPLATE = {
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

