/**
 * Retention policy per model (spec section 22).
 *
 * Kept free of Nest and Prisma imports so it can be asserted against
 * schema.prisma directly in a unit test - the lists and the schema drifting apart
 * is exactly the failure that would silently disable a soft-delete filter.
 */

/** Models carrying `deletedAt`; reads exclude soft-deleted rows by default. */
export const SOFT_DELETABLE_MODELS = new Set<string>([
  'Company',
  'User',
  'Role',
  'Office',
  'Building',
  'Floor',
  'Room',
  'Department',
  'Category',
  'Subcategory',
  'Asset',
  'InventoryItem',
  'Vendor',
  'PurchaseOrder',
  'Invoice',
  'InvoiceDocument',
  'AssetRequest',
  'RequestComment',
  'MaintenanceRecord',
  'Attachment',
  'WorkflowDefinition',
  'OnboardingTemplate',
  'SavedFilter',
  'ScheduledReport',
]);

/**
 * Models with no delete path at all. Financial records, assignment history and
 * audit rows are retained; removing one is a data-integrity incident, not a
 * routine operation, so the ORM refuses rather than relying on reviewer vigilance.
 */
export const UNDELETABLE_MODELS = new Set<string>([
  'AuditLog',
  'AssetAssignment',
  'AssetReturn',
  'AssetTransfer',
  'AssetConditionLog',
  'InventoryTransaction',
  'InvoiceExtraction',
  'InvoiceVerification',
  'DisposalRecord',
  'AIUsageRecord',
]);

export class UndeletableModelError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only and cannot be ${operation}d. ` +
        'Financial, assignment and audit history are retained (spec section 22).',
    );
    this.name = 'UndeletableModelError';
  }
}
