import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { demoRequestSchema, type DemoRequestInput } from '@techpioasset/contracts';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../auth/decorators.js';
import { MailProvider } from '../providers/mail/mail.provider.js';

/** Where pioassets.com demo requests land. */
const SALES_INBOX = 'dalbeir@techpio.com';

const LABELS: Record<string, string> = {
  UNDER_100: 'Under 100',
  FROM_100_TO_500: '100-500',
  FROM_500_TO_1000: '500-1,000',
  OVER_1000: '1,000+',
  ASSET_MANAGEMENT: 'Asset Management',
  HARDWARE_TRACKING: 'Hardware Tracking',
  WARRANTY_MANAGEMENT: 'Warranty Management',
  SOFTWARE_LICENSES: 'Software & License Management',
  IT_INVENTORY: 'IT Inventory',
  OTHER: 'Other',
};

@ApiTags('Marketing')
@Controller('marketing')
export class MarketingController {
  private readonly logger = new Logger(MarketingController.name);

  constructor(private readonly mail: MailProvider) {}

  @Post('demo-request')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Demo request from the public website',
    description:
      'Unauthenticated lead form. Throttled; the honeypot field silently drops ' +
      'bot submissions. Delivers to the sales inbox with reply-to the requester.',
  })
  async demoRequest(@Body(zodBody(demoRequestSchema)) body: DemoRequestInput) {
    // Honeypot tripped: acknowledge and do nothing, so bots learn nothing.
    if (body.website !== undefined && body.website !== '') return { received: true };

    const lines = [
      `Name:       ${body.fullName}`,
      `Email:      ${body.email}`,
      `Company:    ${body.company}`,
      `Phone:      ${body.phone || '-'}`,
      `Assets:     ${LABELS[body.assetCount]}`,
      `Interest:   ${LABELS[body.interest]}`,
      '',
      body.message || '(no message)',
    ];
    try {
      await this.mail.send({
        to: SALES_INBOX,
        replyTo: body.email,
        subject: `Demo request - ${body.company} (${LABELS[body.assetCount]} assets)`,
        text: lines.join('\n'),
      });
    } catch (error) {
      // The visitor should never see a mail-relay hiccup; log loudly instead.
      this.logger.error(`Demo request mail failed: ${(error as Error).message}`);
    }
    return { received: true };
  }
}
