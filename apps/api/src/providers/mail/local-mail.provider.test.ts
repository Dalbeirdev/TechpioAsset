import { readFile, rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalMailProvider } from './local-mail.provider.js';

const config = { get: (key: string) => (key === 'MAIL_FROM' ? 'PioAssets <help@pioasset.com>' : '') };
const provider = new LocalMailProvider(config as never);
const written: string[] = [];

async function send(message: Parameters<LocalMailProvider['send']>[0]) {
  const result = await provider.send(message);
  written.push(result.storedAt!);
  return readFile(result.storedAt!, 'utf8');
}

afterAll(async () => {
  await Promise.all(written.map((file) => rm(file, { force: true })));
});

const logo = {
  filename: 'pioassets.png',
  content: Buffer.from('not-really-a-png').toString('base64'),
  contentType: 'image/png',
  encoding: 'base64' as const,
  cid: 'pioassets-logo',
};

describe('local .eml assembly', () => {
  it('nests an inline image in multipart/related beside the body', async () => {
    const eml = await send({
      to: 'someone@techpio.com',
      subject: 'Welcome',
      text: 'plain',
      html: '<p><img src="cid:pioassets-logo"></p>',
      attachments: [logo],
    });

    expect(eml).toContain('Content-Type: multipart/related');
    expect(eml).toContain('Content-ID: <pioassets-logo>');
    expect(eml).toContain('Content-Disposition: inline; filename="pioassets.png"');
    // multipart/mixed would offer the logo as a file to save and leave the
    // HTML showing a broken box, which is the bug this structure avoids.
    expect(eml).not.toContain('multipart/mixed');
    // The HTML must survive: an attachment used to replace it outright.
    expect(eml).toContain('<img src="cid:pioassets-logo">');
    expect(eml).toContain('plain');
  });

  it('does not re-encode content that is already base64', async () => {
    const eml = await send({
      to: 'someone@techpio.com',
      subject: 'Welcome',
      text: 'plain',
      html: '<p>hi</p>',
      attachments: [logo],
    });

    expect(eml).toContain(logo.content);
  });

  it('still offers a real file to save, alongside the inline part', async () => {
    const eml = await send({
      to: 'someone@techpio.com',
      subject: 'Monthly report',
      text: 'plain',
      html: '<p>hi</p>',
      attachments: [logo, { filename: 'report.csv', content: 'a,b\n1,2', contentType: 'text/csv' }],
    });

    expect(eml).toContain('multipart/mixed');
    expect(eml).toContain('multipart/related');
    expect(eml).toContain('Content-Disposition: attachment; filename="report.csv"');
    expect(eml).toContain(Buffer.from('a,b\n1,2', 'utf8').toString('base64'));
  });

  it('leaves a plain message plain', async () => {
    const eml = await send({ to: 'someone@techpio.com', subject: 'Ping', text: 'plain' });

    expect(eml).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(eml).not.toContain('multipart');
  });
});
