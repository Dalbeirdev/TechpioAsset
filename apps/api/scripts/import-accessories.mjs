/**
 * Turn the spreadsheet's accessory columns into real assets (v2.21).
 *
 * The original import captured one laptop per row and dropped the rest: every
 * row carried a line like
 *
 *   "Screens: 2 dell screens; Mouse: Logitech M171 (SN:2446APEA9V8); Other: Logitech Headphones"
 *
 * and none of it reached the database, so a person's screens, mouse and headset
 * were untrackable. This parses that text into individual asset records
 * assigned to the same holder, with brand, model and serial pulled out where
 * the sheet recorded them.
 *
 * Deliberately conservative:
 *  - "NA", "Personal", "Using My Own ..." create nothing; they are not company
 *    assets, and inventing a row for them would be worse than the gap.
 *  - The original cell text is kept on every created asset, so a bad parse can
 *    always be checked against what the sheet actually said.
 *  - Reruns are safe: an accessory is skipped when the same holder already has
 *    one with that serial, or - for serial-less items - the same name.
 *
 * Usage:  node scripts/import-accessories.mjs            (dry run, prints a plan)
 *         node scripts/import-accessories.mjs --apply    (writes)
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const BRANDS = [
  ['logitech', 'Logitech'], ['logi', 'Logitech'], ['dell', 'Dell'], ['hp', 'HP'],
  ['samsung', 'Samsung'], ['benq', 'BenQ'], ['acer', 'Acer'], ['lenovo', 'Lenovo'],
  ['apple', 'Apple'], ['jabra', 'Jabra'], ['epos', 'EPOS'], ['lg', 'LG'],
  ['viewsonic', 'ViewSonic'], ['zebronics', 'Zebronics'], ['redmi', 'Redmi'],
  ['pixel', 'Google'], ['alhua', 'Dahua'], ['elitedisplay', 'HP'],
];

/** Phrases that mean "nothing here" or "not ours". */
const NOTHING = /^(na|n\/?a|nil|none|-|personal|expired|no|not working now)$/i;
const NOT_OURS = /using my own|personal|employee'?s own|own headphone/i;

/** Section label -> asset type key from the catalogue. */
function typeForSection(label, text) {
  const t = text.toLowerCase();
  if (/head\s?phone|headset|earphone/.test(t)) return 'headset';
  if (/web\s?cam|camera/.test(t)) return 'webcam';
  if (/key\s?board/.test(t)) return 'keyboard';
  if (/mouse/.test(t)) return 'mouse';
  if (/screen|monitor|display/.test(t)) return 'monitor';
  if (/phone|redmi|pixel|iphone/.test(t)) return 'mobile-phone';
  if (/charger|type c|converter|adapter|hdmi/.test(t)) return 'adapter';
  if (/light|lamp/.test(t)) return null; // desk light is not IT kit
  if (/sim\b/.test(t)) return null;
  if (label === 'screens') return 'monitor';
  if (label === 'mouse') return 'mouse';
  return null;
}

function extractSerial(text) {
  // "S/N: ABC123", "SN:ABC123", "Sr. no, 1427LJ2", "(CN-0TGP8R-...)"
  const labelled = text.match(/s\/?\s?n\.?\s*(?:no)?[:.,]?\s*[-]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/i);
  if (labelled) return labelled[1].replace(/[.,;]$/, '');
  const bracketed = text.match(/\(([A-Z0-9][A-Z0-9-]{7,})\)/);
  if (bracketed) return bracketed[1];
  return null;
}

function extractBrand(text) {
  const t = text.toLowerCase();
  for (const [needle, brand] of BRANDS) {
    if (new RegExp(`\\b${needle}`, 'i').test(t)) return brand;
  }
  return null;
}

function extractModel(text, brand) {
  // Logitech M171 / M90 / M550 / K380, HP E242 / E424, Dell P2422H
  const m = text.match(/\b([MKE]\d{2,4}[A-Z]?)\b/);
  if (m) return m[1].toUpperCase();
  const elite = text.match(/elite\s?display\s+([A-Z]\d{3,4})/i);
  if (elite) return `EliteDisplay ${elite[1].toUpperCase()}`;
  const size = text.match(/\b(\d{2})\s*inch\b/i);
  if (size) return `${size[1]}"`;
  return brand ? null : null;
}

function extractQuantity(text) {
  const m = text.match(/^\s*(\d+)\s+(?!inch)/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 10 ? n : 1;
  }
  return 1;
}

/** One cell -> a list of {type, brand, model, serial, quantity, source}. */
function parseAccessories(cell) {
  const out = [];
  if (!cell || NOTHING.test(cell.trim())) return out;

  for (const section of cell.split(';')) {
    const [rawLabel, ...rest] = section.split(':');
    const hasLabel = rest.length > 0 && /^(screens?|mouse|other)$/i.test(rawLabel.trim());
    const label = hasLabel ? rawLabel.trim().toLowerCase() : '';
    const body = hasLabel ? rest.join(':').trim() : section.trim();
    if (!body || NOTHING.test(body)) continue;

    // Commas and " and " separate items - but a bracketed serial can contain a
    // comma of its own, so those are parked behind a sentinel while we split.
    const guarded = body.replace(/\([^)]*\)/g, (m) => m.replace(/,/g, '\u0001'));
    for (const piece of guarded.split(/,| and /i)) {
      const item = piece.split('\u0001').join(',').trim();
      if (!item || NOTHING.test(item)) continue;
      if (NOT_OURS.test(item)) continue;

      const type = typeForSection(label, item);
      if (!type) continue;

      out.push({
        type,
        brand: extractBrand(item),
        model: extractModel(item, extractBrand(item)),
        serial: extractSerial(item),
        quantity: extractQuantity(item),
        source: item,
      });
    }
  }
  return out;
}

const TYPE_NAMES = {
  monitor: 'Monitor', mouse: 'Mouse', keyboard: 'Keyboard', headset: 'Headset',
  webcam: 'Webcam', 'mobile-phone': 'Mobile phone', adapter: 'Adapter',
};

async function main() {
  const data = JSON.parse(readFileSync(new URL('./import-real-data.json', import.meta.url), 'utf8'));
  const company = await prisma.company.findFirst({
    where: { name: { not: { contains: 'Demo' } } },
    select: { id: true, name: true },
  });
  if (!company) throw new Error('No live company found');

  const category = await prisma.category.findFirst({
    where: { companyId: company.id, key: 'it-assets' },
    select: { id: true },
  });
  const subs = await prisma.subcategory.findMany({
    where: { categoryId: category.id },
    select: { id: true, key: true },
  });
  const subByKey = Object.fromEntries(subs.map((s) => [s.key, s.id]));

  let seq = 0;
  const nextTag = async () => {
    for (;;) {
      seq += 1;
      const tag = `ACC-${String(seq).padStart(4, '0')}`;
      const clash = await prisma.asset.findFirst({
        where: { companyId: company.id, assetTag: tag },
        select: { id: true },
      });
      if (!clash) return tag;
    }
  };

  const plan = [];
  const skipped = [];

  for (const row of data.assets) {
    if (!row.accessories) continue;
    const holder = row.holderEmail
      ? await prisma.user.findFirst({
          where: { companyId: company.id, email: row.holderEmail },
          select: { id: true, email: true },
        })
      : null;

    for (const item of parseAccessories(row.accessories)) {
      const subcategoryId = subByKey[item.type] ?? null;
      if (!subcategoryId) {
        skipped.push({ tag: row.assetTag, reason: `no type '${item.type}'`, text: item.source });
        continue;
      }
      for (let n = 0; n < item.quantity; n++) {
        plan.push({
          holderId: holder?.id ?? null,
          holderEmail: holder?.email ?? row.holderName ?? '(unassigned)',
          parentTag: row.assetTag,
          subcategoryId,
          type: item.type,
          brand: item.brand,
          model: item.model,
          // Only the first unit of a multi-quantity line can claim the serial.
          serial: n === 0 ? item.serial : null,
          name: [item.brand, item.model, TYPE_NAMES[item.type]].filter(Boolean).join(' '),
          source: item.source,
        });
      }
    }
  }

  console.log(`Company: ${company.name}`);
  console.log(`Accessories parsed into ${plan.length} asset records`);
  const byType = {};
  for (const p of plan) byType[p.type] = (byType[p.type] ?? 0) + 1;
  console.log('By type:', byType);
  console.log(`With a serial: ${plan.filter((p) => p.serial).length}`);
  console.log(`Unassigned (holder not matched): ${plan.filter((p) => !p.holderId).length}`);
  if (skipped.length) console.log(`Skipped: ${skipped.length}`, skipped.slice(0, 5));

  console.log('\nFirst 12 planned records:');
  for (const p of plan.slice(0, 12)) {
    console.log(
      `  ${p.type.padEnd(13)} ${(p.brand ?? '-').padEnd(9)} ${(p.model ?? '-').padEnd(16)} ` +
        `${(p.serial ?? '-').padEnd(22)} -> ${p.holderEmail}`,
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these records.');
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  let skippedExisting = 0;
  for (const p of plan) {
    // Idempotent: same serial anywhere, or same name already on this holder.
    const existing = await prisma.asset.findFirst({
      where: {
        companyId: company.id,
        deletedAt: null,
        ...(p.serial
          ? { serialNumber: p.serial }
          : { name: p.name, assignedUserId: p.holderId, subcategoryId: p.subcategoryId }),
      },
      select: { id: true },
    });
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const assetTag = await nextTag();
    await prisma.asset.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        subcategoryId: p.subcategoryId,
        assetTag,
        name: p.name,
        brand: p.brand,
        model: p.model,
        serialNumber: p.serial,
        qrToken: `acc${assetTag}${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        status: p.holderId ? 'ASSIGNED' : 'AVAILABLE',
        assignedUserId: p.holderId,
        assignmentDate: p.holderId ? new Date() : null,
        condition: 'GOOD',
        notes: `Imported from the asset sheet (accessory column of ${p.parentTag}).\nSheet text: ${p.source}`,
      },
    });
    created += 1;
  }
  console.log(`\nCreated ${created} accessory assets; ${skippedExisting} already existed.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
