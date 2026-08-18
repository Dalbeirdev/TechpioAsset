/**
 * Give the untyped laptops a type (v2.23).
 *
 * Asset types arrived after these records did. The accessories imported later
 * were created with a type, but the machines people actually work on - every
 * Latitude, ThinkPad, EliteBook and MacBook in the fleet - carry none, so the
 * new Type filter finds nothing under "Laptop" while listing 51 monitors.
 *
 * Deliberately conservative:
 *  - only assets with NO type at all are touched; anything already typed is
 *    left exactly as it is, so a rerun cannot reclassify a monitor
 *  - only names that read as a laptop are matched, against an explicit list of
 *    makes and model families. A name this cannot place is reported and
 *    skipped rather than guessed at
 *  - dry run by default; --apply is required to write
 *
 * Usage:  node scripts/backfill-laptop-type.mjs            (prints the plan)
 *         node scripts/backfill-laptop-type.mjs --apply    (writes)
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** Makes and model families that identify a laptop by name. */
const LAPTOP_PATTERNS = [
  /\blatitude\b/i,
  /\bthinkpad\b/i,
  /\bideapad\b/i,
  /\belitebook\b/i,
  /\bprobook\b/i,
  /\bzbook\b/i,
  /\bpavilion\b/i,
  /\bvictus\b/i,
  /\binspiron\b/i,
  /\bmacbook\b/i,
  /\bpredator\b/i,
  /\bsurface\s*pro\b/i,
  /\bnotebook\b/i,
  /\blaptop\b/i,
  /\bg15\b/i,
  /\bt470\b|\bt480\b|\bp50\b|\bp52s\b|\bp14s\b|\bl14\b/i,
  // Bare maker names: in this fleet an asset called just "Dell" or "HP" with a
  // person's machine tag is their laptop. Kept last so a more specific pattern
  // wins first, and still only ever applied to untyped assets.
  /^(dell|hp|acer|lenovo|lenevo|asus)\b/i,
];

const looksLikeLaptop = (name) => LAPTOP_PATTERNS.some((re) => re.test(name ?? ''));

async function main() {
  const untyped = await prisma.asset.findMany({
    where: { deletedAt: null, subcategoryId: null },
    select: { id: true, name: true, assetTag: true, companyId: true },
    orderBy: { name: 'asc' },
  });

  if (untyped.length === 0) {
    console.log('Nothing to do: every asset already has a type.');
    return;
  }

  const matched = untyped.filter((a) => looksLikeLaptop(a.name));
  const skipped = untyped.filter((a) => !looksLikeLaptop(a.name));

  // The Laptop type is per company, so resolve it for each company involved.
  const companyIds = [...new Set(matched.map((a) => a.companyId))];
  const laptopByCompany = new Map();
  for (const companyId of companyIds) {
    // A subcategory belongs to a category, and the category carries the company.
    const sub = await prisma.subcategory.findFirst({
      where: {
        category: { companyId },
        OR: [{ key: 'laptop' }, { name: { equals: 'Laptop', mode: 'insensitive' } }],
      },
      select: { id: true, name: true },
    });
    if (!sub) {
      console.error(`! company ${companyId} has no "Laptop" type - its assets are skipped`);
      continue;
    }
    laptopByCompany.set(companyId, sub.id);
  }

  const writable = matched.filter((a) => laptopByCompany.has(a.companyId));

  console.log(`untyped assets      : ${untyped.length}`);
  console.log(`read as a laptop    : ${matched.length}`);
  console.log(`will be updated     : ${writable.length}`);
  console.log(`left alone (unclear): ${skipped.length}`);
  for (const a of skipped) console.log(`   skip  ${a.assetTag.padEnd(30)} ${a.name}`);
  for (const a of writable) console.log(`   set   ${a.assetTag.padEnd(30)} ${a.name}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
    return;
  }

  let updated = 0;
  for (const asset of writable) {
    // subcategoryId null is re-checked in the update itself, so a row typed by
    // someone else between the read above and here is not overwritten.
    const res = await prisma.asset.updateMany({
      where: { id: asset.id, subcategoryId: null },
      data: { subcategoryId: laptopByCompany.get(asset.companyId) },
    });
    updated += res.count;
  }
  console.log(`\nUpdated ${updated} asset${updated === 1 ? '' : 's'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
