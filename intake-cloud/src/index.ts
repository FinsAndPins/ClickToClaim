import { app, cleanupExpired } from "./app";
import type { Bindings } from "./types";

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env));
  },
};
