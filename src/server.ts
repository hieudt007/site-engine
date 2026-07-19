import Fastify from "fastify";
import { config } from "./config.js";
import { registerSession } from "./plugins/session.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerOAuthRoutes } from "./routes/admin/oauth.js";
import { registerPostRoutes } from "./routes/admin/posts.js";
import { registerPostsUiRoutes } from "./routes/admin/postsUi.js";
import { registerBlogRoutes } from "./routes/public/blog.js";

const app = Fastify({ logger: true, trustProxy: true });

app.get("/health", async () => {
  return { status: "ok" };
});

async function start(): Promise<void> {
  await registerSession(app);
  await registerOAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerPostRoutes(app);
  await registerPostsUiRoutes(app);
  await registerBlogRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
