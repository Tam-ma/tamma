// @ts-nocheck
import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "../build/server";

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    const handleRequest = createRequestHandler({
      build,
      mode: process.env.NODE_ENV ?? "production",
    });
    return handleRequest(request, env, ctx);
  },
};
