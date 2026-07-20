-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_authorId_fkey";

-- DropIndex
DROP INDEX "Post_slug_key";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "authorName",
DROP COLUMN "updatedByUserId",
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'post';

-- DropTable
DROP TABLE "Page";

-- CreateIndex
CREATE UNIQUE INDEX "Post_type_slug_key" ON "Post"("type", "slug");

