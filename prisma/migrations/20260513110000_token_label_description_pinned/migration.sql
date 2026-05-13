-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "label"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN     "description"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN     "pinned_model" TEXT NOT NULL DEFAULT '';
