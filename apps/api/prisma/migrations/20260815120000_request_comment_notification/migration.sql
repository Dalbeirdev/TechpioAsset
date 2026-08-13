-- v2.17: request thread messages notify the other side.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_COMMENT';
