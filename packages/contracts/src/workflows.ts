import { z } from 'zod';
import { moneyString } from './money';

/**
 * Approval-workflow configuration (v2.24).
 *
 * Spec section 11 has always required Super Admins to configure approval
 * steps, approvers, thresholds and bypass rules. The permission
 * (`workflows:configure`) and the data model both existed; nothing ever read
 * or wrote them, so a chain could only be changed by editing the database by
 * hand - which is exactly the kind of change that should leave an audit trail.
 *
 * This covers the per-step rules that decide WHEN a step applies. Adding,
 * removing or reordering steps, and changing who approves them, is a larger
 * surface (ordering, approver types, role validity) and is deliberately not
 * here: those restructure the chain, while these tune one already in place.
 */

export const updateWorkflowStepSchema = z
  .object({
    /**
     * Only requests estimated at or above this amount include the step. Null
     * means the step always applies - which is how "Finance sees everything"
     * is expressed.
     */
    costThreshold: moneyString.nullable().optional(),
    /** Whether the chain may skip this step when its threshold is not met. */
    isSkippable: z.boolean().optional(),
    /** Hours before the step is considered overdue and escalates. */
    slaHours: z.number().int().min(1).max(2160).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export type UpdateWorkflowStepInput = z.infer<typeof updateWorkflowStepSchema>;

export const workflowStepSchema = z.object({
  id: z.string(),
  stepOrder: z.number(),
  name: z.string(),
  approverType: z.string(),
  approverRoleKey: z.string().nullable(),
  approverRoleName: z.string().nullable(),
  costThreshold: z.string().nullable(),
  isSkippable: z.boolean(),
  slaHours: z.number().nullable(),
  /** How many active accounts could actually decide this step today. */
  eligibleApprovers: z.number(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Null is the catch-all definition, used by any type without its own. */
  requestType: z.string().nullable(),
  isActive: z.boolean(),
  steps: z.array(workflowStepSchema),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
