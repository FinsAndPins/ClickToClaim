import { app, cleanupExpired } from "./app";
import type { Bindings } from "./types";

export default {
  // Pass ExecutionContext explicitly so finish can waitUntil without hanging the seller on Thanks.
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env));
  },
};
