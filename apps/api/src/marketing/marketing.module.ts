import { Module } from '@nestjs/common';
import { MailModule } from '../providers/mail/mail.module.js';
import { MarketingController } from './marketing.controller.js';

@Module({
  imports: [MailModule],
  controllers: [MarketingController],
})
export class MarketingModule {}
