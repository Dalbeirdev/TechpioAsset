import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AuditAction } from '@prisma/client';
import { AppConfig } from '../config/config.module.js';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';

/**
 * Condition photos for an asset (v2.32).
 *
 * The point is not a picture of a laptop. It is evidence of what condition a
 * specific laptop was in at the two moments that are ever disputed: when it was
 * handed to someone, and when they gave it back. "It already had that dent" is
 * unanswerable without them, and the argument always happens months later.
 *
 * So a photo is not filed against the asset in general - it is filed against a
 * custody event:
 *
 *   HANDOVER - the open AssetAssignment. What it looked like going out.
 *   RETURN   - the AssetReturn that closed one. What came back.
 *
 * That is what makes the pair comparable. A flat gallery on the asset would
 * hold the same images and answer none of the question, because nobody could
 * say which visit each one belonged to.
 *
 * Reuses the existing Attachment table rather than adding one. It already
 * carries the hash, the size, the scan status and the uploader, and its
 * entityType/entityId pair is indexed for exactly this.
 */

/** The two moments worth photographing. */
export type PhotoStage = 'HANDOVER' | 'RETURN';

const ENTITY_TYPE: Record<PhotoStage, string> = {
  HANDOVER: 'AssetAssignment',
  RETURN: 'AssetReturn',
};

/**
 * Photos only. The generic attachment endpoint takes spreadsheets and PDFs;
 * this one is evidence a person will look at and compare, and a PDF cannot be
 * put side by side with a photograph.
 *
 * HEIC is deliberately in the list: it is what an iPhone produces by default,
 * and the people photographing equipment at a desk are using their phones.
 */
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

@Injectable()
export class AssetPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
    private readonly config: AppConfig,
  ) {}

  /** The asset, scoped to the caller's tenant. 404 rather than 403 for another company's id. */
  private async assetOr404(actor: AuthUser, assetId: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, deletedAt: null, ...tenantFilter(actor) },
      select: { id: true, assetTag: true, name: true },
    });
    if (!asset) throw AppError.notFound('Asset not found');
    return asset;
  }

  /**
   * The custody event a photo of this stage belongs to.
   *
   * Resolved on the server from the asset's current state rather than taken
   * from the client. A client that has to name the assignment id can name the
   * wrong one, and a photo filed against the previous holder's handover is
   * worse than no photo - it is evidence pointing at the wrong person.
   */
  private async resolveEvent(assetId: string, stage: PhotoStage) {
    if (stage === 'HANDOVER') {
      const open = await this.prisma.client.assetAssignment.findFirst({
        where: { assetId, returnedAt: null },
        orderBy: { assignedAt: 'desc' },
        select: { id: true, assignedAt: true },
      });
      if (!open) {
        throw new AppError('VALIDATION_FAILED', 'This asset is not currently assigned to anyone', {
          detail: 'Handover photos belong to an active assignment. Assign the asset first.',
        });
      }
      return { id: open.id, at: open.assignedAt };
    }

    const latest = await this.prisma.client.assetReturn.findFirst({
      where: { assignment: { assetId } },
      orderBy: { returnedAt: 'desc' },
      select: { id: true, returnedAt: true },
    });
    if (!latest) {
      throw new AppError('VALIDATION_FAILED', 'This asset has never been returned', {
        detail: 'Return photos belong to a return record. Complete the return first.',
      });
    }
    return { id: latest.id, at: latest.returnedAt };
  }

  async add(
    actor: AuthUser,
    assetId: string,
    stage: PhotoStage,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    caption?: string,
  ) {
    const asset = await this.assetOr404(actor, assetId);
    const event = await this.resolveEvent(assetId, stage);

    // Intersected with the tenant's configured allow-list, so a deployment that
    // narrows uploads narrows these too - this cannot widen what is accepted.
    const configured = this.config.get('ALLOWED_UPLOAD_MIME');
    const allowed = PHOTO_MIMES.filter((m) => configured.includes(m));

    const { contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: allowed,
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    const stored = await this.storage.put({
      prefix: `asset-photos/${actor.companyId}/${assetId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    const photo = await this.prisma.client.attachment.create({
      data: {
        companyId: actor.companyId,
        entityType: ENTITY_TYPE[stage],
        entityId: event.id,
        // Also hung off the asset, so the whole history is one query from the
        // asset page without walking every assignment it has ever had.
        assetId,
        storageKey: stored.key,
        originalName: file.originalname,
        mimeType: contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        scanStatus: 'SKIPPED',
        caption: caption?.trim() || null,
        uploadedById: actor.id,
      },
      select: { id: true, originalName: true, caption: true, createdAt: true, sizeBytes: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      newValues: {
        conditionPhoto: photo.id,
        stage,
        event: event.id,
        asset: asset.assetTag,
        sha256: stored.sha256,
      },
    });

    return { ...photo, stage };
  }

  /**
   * Every condition photo for an asset, newest custody event first.
   *
   * Returned grouped by event rather than as a flat list, because the question
   * this answers is always "what did it look like at THAT handover, and at the
   * return that closed it" - and the condition recorded in words at each of
   * those moments belongs beside the pictures of it.
   */
  async list(actor: AuthUser, assetId: string) {
    await this.assetOr404(actor, assetId);

    const [photos, assignments] = await Promise.all([
      this.prisma.client.attachment.findMany({
        where: {
          assetId,
          deletedAt: null,
          entityType: { in: [ENTITY_TYPE.HANDOVER, ENTITY_TYPE.RETURN] },
          ...tenantFilter(actor),
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          originalName: true,
          caption: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          uploadedById: true,
        },
      }),
      this.prisma.client.assetAssignment.findMany({
        where: { assetId },
        orderBy: { assignedAt: 'desc' },
        select: {
          id: true,
          assignedAt: true,
          returnedAt: true,
          conditionOut: true,
          user: { select: { profile: { select: { firstName: true, lastName: true } } } },
          assetReturn: { select: { id: true, returnedAt: true, conditionIn: true } },
        },
      }),
    ]);

    // Attachment carries only the uploader's id, so the names are resolved in
    // one extra query rather than N joins - a photo list is small, and the
    // person who took the picture is part of the evidence.
    const uploaderIds = [...new Set(photos.map((p) => p.uploadedById).filter(Boolean))] as string[];
    const uploaders = uploaderIds.length
      ? await this.prisma.client.userProfile.findMany({
          where: { userId: { in: uploaderIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(
      uploaders.map((u) => [u.userId, `${u.firstName} ${u.lastName}`.trim()]),
    );

    const shape = (a: (typeof photos)[number]) => ({
      id: a.id,
      originalName: a.originalName,
      caption: a.caption,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      takenAt: a.createdAt,
      by: a.uploadedById ? (nameOf.get(a.uploadedById) ?? null) : null,
    });

    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      holder: assignment.user?.profile
        ? `${assignment.user.profile.firstName} ${assignment.user.profile.lastName}`.trim()
        : null,
      assignedAt: assignment.assignedAt,
      conditionOut: assignment.conditionOut,
      returnedAt: assignment.assetReturn?.returnedAt ?? null,
      conditionIn: assignment.assetReturn?.conditionIn ?? null,
      open: assignment.returnedAt === null,
      handover: photos
        .filter((p) => p.entityType === ENTITY_TYPE.HANDOVER && p.entityId === assignment.id)
        .map(shape),
      returned: assignment.assetReturn
        ? photos
            .filter(
              (p) =>
                p.entityType === ENTITY_TYPE.RETURN && p.entityId === assignment.assetReturn?.id,
            )
            .map(shape)
        : [],
    }));
  }

  /** The bytes, for inline display. */
  async read(actor: AuthUser, assetId: string, photoId: string) {
    await this.assetOr404(actor, assetId);

    const photo = await this.prisma.client.attachment.findFirst({
      where: { id: photoId, assetId, deletedAt: null, ...tenantFilter(actor) },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!photo) throw AppError.notFound('Photo not found');

    return { ...photo, data: await this.storage.get(photo.storageKey) };
  }

  /**
   * Remove a photo - but only while its custody event is still open.
   *
   * A photo taken at handover stops being an ordinary upload the moment the
   * asset comes back: it is then the "before" half of a comparison somebody may
   * be held to. Deleting it at that point removes one side of an argument, and
   * it is precisely when someone would most want to. So the window is: while
   * the assignment is still open, anyone with custody rights can clear a bad
   * shot; after the return, nobody can, through this route.
   *
   * Soft delete, so the row and its hash survive for the audit trail even
   * though the photo stops being served.
   */
  async remove(actor: AuthUser, assetId: string, photoId: string) {
    await this.assetOr404(actor, assetId);

    const photo = await this.prisma.client.attachment.findFirst({
      where: { id: photoId, assetId, deletedAt: null, ...tenantFilter(actor) },
      select: { id: true, entityType: true, entityId: true },
    });
    if (!photo) throw AppError.notFound('Photo not found');

    if (photo.entityType === ENTITY_TYPE.RETURN) {
      throw new AppError('FORBIDDEN', 'A return photo cannot be removed', {
        detail: 'It is the record of what came back. Ask a Super Admin if it is genuinely wrong.',
      });
    }

    const assignment = await this.prisma.client.assetAssignment.findUnique({
      where: { id: photo.entityId },
      select: { returnedAt: true },
    });
    if (assignment?.returnedAt) {
      throw new AppError('FORBIDDEN', 'This handover has already been closed by a return', {
        detail:
          'Its photos are the "before" side of the return comparison and can no longer be removed.',
      });
    }

    await this.prisma.client.attachment.update({
      where: { id: photo.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      previousValues: { conditionPhoto: photo.id },
      newValues: { conditionPhotoRemoved: true },
    });

    return { id: photo.id, removed: true };
  }
}

/** Custody rights, which is who may add condition evidence. */
export const PHOTO_WRITE_PERMISSIONS = [PERMISSIONS.ASSETS_ASSIGN, PERMISSIONS.ASSETS_RETURN];
