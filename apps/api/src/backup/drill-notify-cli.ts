/**
 * v2.8 S2 — makes a failed restore drill shout.
 *
 * A drill whose result dies in a log file nobody opens has not run: the whole
 * point is to learn that recovery is broken BEFORE the day you need it. This
 * sends the outcome through the configured MailProvider — the same one the
 * application uses, so a deployment with real SMTP gets real mail and a
 * development box gets a readable .eml.
 *
 * Deliberately boots a MINIMAL Nest context (config + mail only): no database,
 * no scheduled sweeps. The drill often runs precisely when the database is the
 * thing in doubt, so the alerter must not depend on it.
 *
 *   node dist/backup/drill-notify-cli.js <passed|failed> "<detail>"
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfig, AppConfigModule } from '../config/config.module.js';
import { MailModule } from '../providers/mail/mail.module.js';
import { MailProvider } from '../providers/mail/mail.provider.js';

@Module({ imports: [AppConfigModule, MailModule] })
class DrillAlertModule {}

async function main(): Promise<void> {
  const status = (process.argv[2] ?? '').toLowerCase();
  const detail = process.argv[3] ?? '';
  if (status !== 'passed' && status !== 'failed') {
    throw new Error('usage: drill-notify-cli <passed|failed> "<detail>"');
  }

  const context = await NestFactory.createApplicationContext(DrillAlertModule, {
    logger: false,
  });
  try {
    const config = context.get(AppConfig);
    const recipient = config.get('OPS_ALERT_EMAIL');
    if (!recipient) {
      // Not an error: an operator who has not nominated an inbox still gets the
      // exit code and the log line. Say so rather than pretending we told them.
      console.log(
        JSON.stringify({ status: 'skipped', reason: 'OPS_ALERT_EMAIL is not configured' }),
      );
      return;
    }

    const mail = context.get(MailProvider);
    const failed = status === 'failed';
    const result = await mail.send({
      to: recipient,
      subject: failed
        ? 'ACTION NEEDED: TechpioAsset restore drill FAILED'
        : 'TechpioAsset restore drill passed',
      text: failed
        ? `The scheduled restore drill could not restore the latest backup.\n\n` +
          `${detail}\n\n` +
          `This means recovery is not currently proven. Investigate before the next\n` +
          `incident, not during one: deploy/RESTORE-DRILL.md documents the manual run.\n`
        : `The scheduled restore drill restored the latest backup successfully.\n\n${detail}\n`,
    });
    console.log(
      JSON.stringify({ status: 'notified', to: recipient, simulated: result.simulated }),
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'notify-failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
