import Fastify from "fastify";
import { config } from "./config.js";
import { registerSession } from "./plugins/session.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAuthRoutes } from "./routes/admin/auth.js";
import { seedAdmin } from "./services/seedAdmin.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  return { status: "ok" };
});

async function start(): Promise<void> {
  await seedAdmin();

  await registerSession(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
