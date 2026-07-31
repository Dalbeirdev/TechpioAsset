import { z } from 'zod';

/** v2.2 Workstream D — approval delegation contracts. */

export const createDelegationSchema = z
  .object({
    delegateId: z.string().min(1),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt >= v.startsAt, {
    message: 'endsAt must be on or after startsAt',
    path: ['endsAt'],
  });
export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;
