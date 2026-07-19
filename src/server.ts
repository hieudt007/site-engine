import Fastify from "fastify";
import { config } from "./config.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  return { status: "ok" };
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
