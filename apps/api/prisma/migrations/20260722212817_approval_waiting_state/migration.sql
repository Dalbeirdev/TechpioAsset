-- AlterEnum
--
-- PostgreSQL refuses to use a newly added enum value inside the same transaction
-- that adds it ("unsafe use of new value"). Prisma wraps each migration in a
-- transaction, so adding the value and setting it as a column default must be
-- two separate migrations. This one only adds the value.
ALTER TYPE "ApprovalDecision" ADD VALUE 'WAITING';
