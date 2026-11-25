-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo';

-- CreateIndex
CREATE INDEX "Service_active_createdAt_idx" ON "Service"("active", "createdAt");
