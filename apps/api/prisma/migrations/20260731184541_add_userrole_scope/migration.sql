-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'DEPARTMENT', 'DIRECT_REPORTS', 'OWN');

-- AlterTable
ALTER TABLE "user_roles" ADD COLUMN     "scope" "DataScope";
