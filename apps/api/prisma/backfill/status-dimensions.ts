/**
 * v2.1 Workstream A — backfill the four status dimensions from the legacy
 * `AssetStatus` (+ existing `AssetCondition`) using the pure domain mapper.
 *
 * Idempotent: only touches assets whose `lifecycleState` is still NULL, so it is
 * safe to re-run and safe to run before `STATUS_MODEL_V2` dual-write is enabled.
 * This is a DATA migration run out-of-band (not part of `migrate deploy`):
 *
 *     pnpm --filter @techpioasset/api backfill:status-dimensions
 *
 * See docs/IMPLEMENTATION-PLAN-v2.1.md §4.2 step 3 and issue #9.
 */
import { PrismaClient } from '@prisma/client';
import { deriveDimensionsFromLegacy, type ConditionGrade } from '@techpioasset/domain';

const prisma = new PrismaClient();
const BATCH = 500;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let processed = 0;
  let updated = 0;

  for (;;) {
    // Include soft-deleted rows too (raw findMany bypasses no soft-delete filter here
    // because we query the model directly; deletedAt rows still need dimensions for history).
    const assets = await prisma.asset.findMany({
      where: { lifecycleState: null },
      select: { id: true, status: true, condition: true },
      take: BATCH,
    });
    if (assets.length === 0) break;

    for (const a of assets) {
      const dims = deriveDimensionsFromLegacy(a.status, {
        existingCondition: a.condition as ConditionGrade,
      });
      processed += 1;
      if (!dryRun) {
        await prisma.asset.update({
          where: { id: a.id },
          data: {
            lifecycleState: dims.lifecycle,
            availabilityState: dims.availability,
            ownershipType: dims.ownership,
            // Persist END_OF_LIFE when the legacy condition was UNUSABLE; otherwise
            // leave the existing condition untouched.
            ...(a.condition === 'UNUSABLE' ? { condition: 'END_OF_LIFE' } : {}),
          },
        });
        updated += 1;
      }
    }
    // Guard against an infinite loop in dry-run (rows are never updated, so the
    // `lifecycleState: null` filter keeps returning the same page).
    if (dryRun) {
      console.log(`[dry-run] would update ${assets.length} in this page; stopping after one page.`);
      break;
    }
  }

  console.log(
    `Status-dimension backfill complete: processed ${processed}, updated ${updated}${
      dryRun ? ' (dry-run, no writes)' : ''
    }.`,
  );
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
