-- AlterTable
ALTER TABLE "ExecutionRequest"
ADD COLUMN "authorizationSignature" TEXT,
ADD COLUMN "authorizationVerifiedAt" TIMESTAMP(3),
ADD COLUMN "authorizationExpiresAt" TIMESTAMP(3);
