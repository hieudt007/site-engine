-- AlterTable: Agent - add columns for the new 'skill' type ('agent' | 'tool' | 'skill')
-- content: full skill body, returned to the agent when it calls USE_SKILL (type='skill' rows).
-- allowedSkills: keys of 'skill' rows this agent may call (type='agent' rows), same convention as allowedTools.
ALTER TABLE "Agent" ADD COLUMN "content" TEXT;
ALTER TABLE "Agent" ADD COLUMN "allowedSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
