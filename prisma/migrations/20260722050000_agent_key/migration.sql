ALTER TABLE "Agent" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");
