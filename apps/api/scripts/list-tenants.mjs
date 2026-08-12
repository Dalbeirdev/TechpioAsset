import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
config({ path: path.resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();
console.log(await prisma.$queryRawUnsafe(
  `SELECT name, count(*)::int AS n FROM companies GROUP BY name ORDER BY n DESC LIMIT 10`,
));
await prisma.$disconnect();
