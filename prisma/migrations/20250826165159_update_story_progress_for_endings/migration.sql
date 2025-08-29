/*
  Warnings:

  - You are about to drop the column `completedAt` on the `StoryProgress` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StoryProgress" DROP COLUMN "completedAt",
ADD COLUMN     "unlockedEndings" TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
