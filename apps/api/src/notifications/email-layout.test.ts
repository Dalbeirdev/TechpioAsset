import { describe, expect, it } from 'vitest';
import { BRAND_LOGO_BASE64, BRAND_LOGO_CID } from './brand-logo.generated.js';
import { renderBrandedEmail } from './email-layout.js';

const base = {
  heading: 'An invited user just activated their account',
  paragraphs: ['Sudanshu Aggarwal accepted their invitation.'],
  companyName: 'TechPIO Services LLP',
  productUrl: 'https://pioassets.com',
};

describe('branded email header', () => {
  it('addresses the logo by Content-ID, never by URL', () => {
    const html = renderBrandedEmail({
      ...base,
      logo: { cid: BRAND_LOGO_CID, width: 196, height: 51 },
    });

    expect(html).toContain(`src="cid:${BRAND_LOGO_CID}"`);
    // A remote src is the whole bug: mail clients refuse to fetch it from a
    // sender the reader has not trusted, and the header renders as a broken box.
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it('keeps a readable header when the logo is not attached', () => {
    const html = renderBrandedEmail(base);

    expect(html).not.toContain('<img');
    expect(html).toContain('Pio<span style="color:#0038a8;">Assets</span>');
  });

  it('carries the brand name as alt text, so a blocked image still names the sender', () => {
    const html = renderBrandedEmail({
      ...base,
      logo: { cid: BRAND_LOGO_CID, width: 196, height: 51 },
    });

    expect(html).toMatch(/<img[^>]+alt="PioAssets"/);
  });

  it('links the header to the product only when the URL is absolute', () => {
    expect(renderBrandedEmail(base)).toContain('href="https://pioassets.com"');
    expect(renderBrandedEmail({ ...base, productUrl: '' })).not.toContain('href=""');
  });

  it('ships a decodable PNG as the logo', () => {
    const bytes = Buffer.from(BRAND_LOGO_BASE64, 'base64');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // Width and height live in the IHDR chunk, bytes 16-24.
    expect(bytes.readUInt32BE(16)).toBe(392);
    expect(bytes.readUInt32BE(20)).toBe(102);
  });
});
