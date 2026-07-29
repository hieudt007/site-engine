-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "settings" JSONB;

-- Giu lai gia tri "stream" cu (nhet vao settings.stream) truoc khi xoa cot, tranh mat cau hinh
-- agent nao dang bat stream=true.
UPDATE "Agent" SET "settings" = jsonb_build_object('stream', "stream");

ALTER TABLE "Agent" DROP COLUMN "stream";
