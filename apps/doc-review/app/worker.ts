/**
 * Cloudflare Worker entry point with Durable Objects
 */
import { createRequestListener } from "@react-router/cloudflare";
// @ts-expect-error - virtual module provided by React Router compiler
import * as build from "virtual:react-router/server-build";

// Export the Durable Object for real-time events
export { EventBroadcaster } from './lib/events/event-broadcaster';

const requestListener = createRequestListener(build);

export default {
  fetch: requestListener,
};