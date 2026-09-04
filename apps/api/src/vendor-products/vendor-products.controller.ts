import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  AuthUser,
  CreateVendorProductInput,
  ReviewVendorProductInput,
  UpdateVendorProductInput,
} from '@techpioasset/contracts';
import {
  createVendorProductSchema,
  reviewVendorProductSchema,
  updateVendorProductSchema,
} from '@techpioasset/contracts';
import { PERMISSIONS, PRODUCT_IMAGE_RULES } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { VendorProductImagesService } from './vendor-product-images.service.js';
import { VendorProductsService } from './vendor-products.service.js';

/**
 * The vendor catalogue (v2.42).
 *
 * Reachable by two different kinds of caller: a supplier working on its own
 * offers, and internal staff working across every supplier. They share these
 * endpoints deliberately - one code path means one set of isolation rules, and
 * a separate "vendor portal API" would be a second place for those rules to
 * drift out of step.
 *
 * What separates them is the scope filter in the service, not the route.
 */
@ApiTags('vendor-products')
@Controller('vendor-products')
export class VendorProductsController {
  constructor(
    private readonly products: VendorProductsService,
    private readonly images: VendorProductImagesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'Catalogue',
    description:
      'A supplier sees only its own offers, in any state, because it works on its drafts here. ' +
      'Internal staff see every vendor. Pass liveOnly=true for offers that can actually be bought today.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('liveOnly') liveOnly?: string,
    @Query('take') take?: string,
  ) {
    return this.products.list(actor, {
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(vendorId ? { vendorId } : {}),
      liveOnly: liveOnly === 'true',
      ...(take ? { take: Number(take) } : {}),
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'One offer, with its images, specification and review history' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Create an offer as a draft',
    description:
      'A supplier may not name a vendor - the offer is always its own. Internal staff must name one.',
  })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createVendorProductSchema)) body: CreateVendorProductInput,
  ) {
    return this.products.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Edit an offer',
    description:
      'A supplier editing the price or specification of an approved offer sends it back for review: ' +
      'the reviewer approved those values, not the row.',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateVendorProductSchema)) body: UpdateVendorProductInput,
  ) {
    return this.products.update(actor, id, body);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Send a draft for internal review; needs at least one image' })
  submit(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.submitForReview(actor, id);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({
    summary: 'Approve, reject or return an offer',
    description: 'Internal only. A rejection must say why, or the vendor cannot act on it.',
  })
  review(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reviewVendorProductSchema)) body: ReviewVendorProductInput,
  ) {
    return this.products.review(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Withdraw an offer; it stays readable so past purchases stay explicable' })
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.remove(actor, id);
  }

  // ── Images ────────────────────────────────────────────────────────────────

  @Post(':id/images')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  // The multer ceiling is deliberately above the 500 KB rule: a file rejected
  // by the framework produces a generic error, while one that reaches the
  // service is rejected with a message naming the actual limit.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add an image',
    description:
      'One to three per product, 500 KB each, JPG/PNG/WEBP. The type is decided by the file ' +
      'signature, not by its name or declared MIME.',
  })
  addImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.images.add(actor, id, file);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Remove an image',
    description: 'Deleting the primary promotes the next, so a product is never left without one.',
  })
  removeImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.remove(actor, id, imageId);
  }

  @Post(':id/images/:imageId/primary')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Choose which image leads' })
  setPrimary(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setPrimary(actor, id, imageId);
  }

  @Get(':id/images/:imageId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'The image bytes' })
  async readImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ) {
    const image = await this.images.read(actor, id, imageId);
    res.setHeader('Content-Type', image.mimeType);
    // Private: an offer's images are commercial information, not public assets.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(image.data);
  }

  @Get('meta/image-rules')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'The image limits, so clients state the same numbers the server enforces',
  })
  imageRules() {
    return PRODUCT_IMAGE_RULES;
  }
}
