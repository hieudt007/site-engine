import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db.js";
import { runDueAutomations } from "../services/automationScheduler.js";
import { publishDueContent } from "../services/publishScheduler.js";

describe("runDueAutomations", () => {
  const suffix = Date.now();
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.automation.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  });

  it("runs a due 'function' automation, records the result, and marks it done (recurrence=once)", async () => {
    const automation = await prisma.automation.create({
      data: {
        name: `Test Automation ${suffix}`,
        actionType: "function",
        targetFunction: "test_function",
        scheduledAt: new Date(Date.now() - 60_000), // da qua han 1 phut
        recurrence: "once",
      },
    });
    createdIds.push(automation.id);

    await runDueAutomations();

    const after = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } });
    expect(after.status).toBe("done");
    expect(after.result).toContain("Test function executed successfully");
  });

  it("does not touch an automation that isn't due yet", async () => {
    const automation = await prisma.automation.create({
      data: {
        name: `Future Automation ${suffix}`,
        actionType: "function",
        targetFunction: "test_function",
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // 1 gio nua
        recurrence: "once",
      },
    });
    createdIds.push(automation.id);

    await runDueAutomations();

    const after = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } });
    expect(after.status).toBe("pending");
  });

  // Chan regression: recurrence != "once" (vd "daily") phai QUAY VE "pending" voi scheduledAt moi
  // (khong phai "done" vinh vien) de lan sau tiep tuc chay lai.
  it("reschedules a recurring automation back to pending with a later scheduledAt", async () => {
    const originalScheduledAt = new Date(Date.now() - 60_000);
    const automation = await prisma.automation.create({
      data: {
        name: `Recurring Automation ${suffix}`,
        actionType: "function",
        targetFunction: "test_function",
        scheduledAt: originalScheduledAt,
        recurrence: "daily",
      },
    });
    createdIds.push(automation.id);

    await runDueAutomations();

    const after = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } });
    expect(after.status).toBe("pending");
    expect(after.scheduledAt.getTime()).toBeGreaterThan(originalScheduledAt.getTime());
  });

  it("marks an automation referencing an unknown function as 'error'", async () => {
    const automation = await prisma.automation.create({
      data: {
        name: `Bad Automation ${suffix}`,
        actionType: "function",
        targetFunction: "this_function_does_not_exist",
        scheduledAt: new Date(Date.now() - 60_000),
        recurrence: "once",
      },
    });
    createdIds.push(automation.id);

    await runDueAutomations();

    const after = await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } });
    expect(after.status).toBe("error");
  });
});

describe("publishDueContent", () => {
  const suffix = Date.now();
  let duePostId: string;
  let futurePostId: string;

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { id: { in: [duePostId, futurePostId] } } }).catch(() => {});
  });

  it("publishes a scheduled post whose scheduledAt has passed, and leaves a future one alone", async () => {
    const due = await prisma.post.create({
      data: { type: "post", title: `Due Post ${suffix}`, slug: `due-post-${suffix}`, body: "x", status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) },
    });
    duePostId = due.id;
    const future = await prisma.post.create({
      data: { type: "post", title: `Future Post ${suffix}`, slug: `future-post-${suffix}`, body: "x", status: "scheduled", scheduledAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    futurePostId = future.id;

    await publishDueContent();

    const dueAfter = await prisma.post.findUniqueOrThrow({ where: { id: duePostId } });
    expect(dueAfter.status).toBe("published");
    expect(dueAfter.publishedAt).not.toBeNull();

    const futureAfter = await prisma.post.findUniqueOrThrow({ where: { id: futurePostId } });
    expect(futureAfter.status).toBe("scheduled");
  });
});
