import pino from "pino";

// Logger dung chung cho code KHONG co request context (job/scheduler/service goi tu background
// job) - route/handler co request thi PHAI dung request.log (da gan san redact/reqId cua chinh
// request do), khong dung logger nay. Cung redact config voi Fastify logger trong server.ts de
// dong nhat, tranh log lo password/token/cookie.
export const logger = pino({
  redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.token"],
});
