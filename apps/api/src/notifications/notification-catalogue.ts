import type { NotificationType } from '@prisma/client';

/**
 * Notification catalogue (spec section 19).
 *
 * `mandatory` marks the ones a user may not switch off. Spec section 19: "Allow
 * users to configure notification preferences while preserving mandatory
 * security and workflow notifications." A user who has muted approval requests
 * silently stalls everyone else's work, and muting a security alert defeats the
 * alert, so those are not preferences.
 */
export interface NotificationDefinition {
  type: NotificationType;
  title: string;
  mandatory: boolean;
  /** Channels this type may use, subject to preference. */
  channels: readonly ('IN_APP' | 'EMAIL' | 'PUSH')[];
}

export const NOTIFICATION_CATALOGUE: Readonly<Record<NotificationType, NotificationDefinition>> = {
  NEW_REQUEST: {
    type: 'NEW_REQUEST',
    title: 'New request',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  APPROVAL_REQUIRED: {
    type: 'APPROVAL_REQUIRED',
    title: 'Approval required',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  REQUEST_APPROVED: {
    type: 'REQUEST_APPROVED',
    title: 'Request approved',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  REQUEST_REJECTED: {
    type: 'REQUEST_REJECTED',
    title: 'Request rejected',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  ASSET_ORDERED: {
    type: 'ASSET_ORDERED',
    title: 'Asset ordered',
    mandatory: false,
    channels: ['IN_APP'],
  },
  ASSET_RECEIVED: {
    type: 'ASSET_RECEIVED',
    title: 'Asset received',
    mandatory: false,
    channels: ['IN_APP'],
  },
  ASSET_READY: {
    type: 'ASSET_READY',
    title: 'Asset ready for collection',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  ASSET_ASSIGNED: {
    type: 'ASSET_ASSIGNED',
    title: 'Asset assigned to you',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RECEIPT_CONFIRMATION: {
    type: 'RECEIPT_CONFIRMATION',
    title: 'Confirm receipt',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RETURN_REQUIRED: {
    type: 'RETURN_REQUIRED',
    title: 'Return required',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RETURN_OVERDUE: {
    type: 'RETURN_OVERDUE',
    title: 'Return overdue',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  DAMAGE_REPORTED: {
    type: 'DAMAGE_REPORTED',
    title: 'Damage reported',
    mandatory: false,
    channels: ['IN_APP'],
  },
  INVOICE_UPLOADED: {
    type: 'INVOICE_UPLOADED',
    title: 'Invoice uploaded',
    mandatory: false,
    channels: ['IN_APP'],
  },
  AI_PROCESSING_COMPLETED: {
    type: 'AI_PROCESSING_COMPLETED',
    title: 'AI processing completed',
    mandatory: false,
    channels: ['IN_APP'],
  },
  AI_PROCESSING_FAILED: {
    type: 'AI_PROCESSING_FAILED',
    title: 'AI processing failed',
    mandatory: false,
    channels: ['IN_APP'],
  },
  INVOICE_MISMATCH: {
    type: 'INVOICE_MISMATCH',
    title: 'Invoice mismatch',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  WARRANTY_EXPIRATION: {
    type: 'WARRANTY_EXPIRATION',
    title: 'Warranty expiring',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  MAINTENANCE_DUE: {
    type: 'MAINTENANCE_DUE',
    title: 'Maintenance due',
    mandatory: false,
    channels: ['IN_APP'],
  },
  LOW_STOCK: { type: 'LOW_STOCK', title: 'Low stock', mandatory: false, channels: ['IN_APP'] },
  REPLACEMENT_DUE: {
    type: 'REPLACEMENT_DUE',
    title: 'Replacement due',
    mandatory: false,
    channels: ['IN_APP'],
  },
  SECURITY_ALERT: {
    type: 'SECURITY_ALERT',
    title: 'Security alert',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
};

export function isMandatory(type: NotificationType): boolean {
  return NOTIFICATION_CATALOGUE[type].mandatory;
}
