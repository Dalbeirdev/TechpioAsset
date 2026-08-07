import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/config.module.js';
import { MfaService } from '../../auth/mfa.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailProvider, type MailMessage, type MailResult } from './mail.provider.js';
import { LocalMailProvider } from './local-mail.provider.js';
import { SmtpMailProvider } from './smtp-mail.provider.js';

/**
 * Mail routing (v2.12): SMTP became configurable from the operator console, so
 * the provider can no longer be chosen once at boot. Order of preference:
 *
 *  1. Database settings (Platform → Mail) - editable without a server login.
 *  2. Environment SMTP (MAIL_PROVIDER=smtp) - the original path, still honoured.
 *  3. Simulated delivery (.eml files on disk) - the honest default.
 *
 * DB settings are re-read at most every 30 seconds; a settings save is
 * effective on the next send without a restart. The transport is rebuilt only
 * when the row's updatedAt changes.
 */
@Injectable()
export class RoutingMailProvider extends MailProvider {
  readonly name = 'routing';
  private readonly logger = new Logger(RoutingMailProvider.name);

  private readonly envProvider: MailProvider;
  private cachedAt = 0;
  private cachedStamp: string | null = null;
  private transporter: Transporter | null = null;
  private fromAddress = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    config: AppConfig,
  ) {
    super();
    this.envProvider =
      config.get('MAIL_PROVIDER') === 'smtp'
        ? new SmtpMailProvider(config)
        : new LocalMailProvider(config);
  }

  async send(message: MailMessage): Promise<MailResult> {
    const transport = await this.dbTransport();
    if (!transport) return this.envProvider.send(message);

    const info = await transport.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }
        : {}),
    });
    this.logger.log(`Sent email to ${message.to} — "${message.subject}"`);
    return { messageId: info.messageId, simulated: false };
  }

  /** True when sends would actually leave the machine (DB or env SMTP). */
  async isLive(): Promise<boolean> {
    if (await this.dbTransport()) return true;
    return this.envProvider.name === 'smtp';
  }

  private async dbTransport(): Promise<Transporter | null> {
    const now = Date.now();
    if (now - this.cachedAt > 30_000) {
      this.cachedAt = now;
      const settings = await this.prisma.client.mailSettings
        .findUnique({ where: { id: 'default' } })
        .catch(() => null);
      const stamp = settings ? settings.updatedAt.toISOString() : null;
      if (stamp !== this.cachedStamp) {
        this.cachedStamp = stamp;
        if (!settings) {
          this.transporter = null;
        } else {
          // The MFA service's AES-256-GCM helper is deliberately reused: one
          // encryption discipline, one key, for every credential at rest.
          const password = this.mfa.decryptSecret(settings.passwordEncrypted);
          this.fromAddress = settings.fromAddress;
          this.transporter = createTransport({
            host: settings.host,
            port: settings.port,
            secure: settings.secure,
            ...(settings.username
              ? { auth: { user: settings.username, pass: password ?? '' } }
              : {}),
          });
        }
      }
    }
    return this.transporter;
  }
}
