/*
  Warnings:

  - The `authorId` column on the `Post` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updatedByUserId` column on the `Post` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.
  - Changed the type of `userId` on the `AuditLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `lastLoginAt` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `leadbaseUserId` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_authorId_fkey";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "userId",
ADD COLUMN     "userId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "authorId",
ADD COLUMN     "authorId" INTEGER,
DROP COLUMN "updatedByUserId",
ADD COLUMN     "updatedByUserId" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
DROP COLUMN "id",
DROP COLUMN "passwordHash",
ADD COLUMN     "lastLoginAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "leadbaseUserId" INTEGER NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "permissions" DROP DEFAULT,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("leadbaseUserId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("leadbaseUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("leadbaseUserId") ON DELETE SET NULL ON UPDATE CASCADE;
