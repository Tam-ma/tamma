/**
 * Cloudflare Worker entry point with Durable Objects
 */

// Export the Durable Object for real-time events
export { EventBroadcaster } from './lib/events/event-broadcaster';

// Re-export default handler from React Router
export { default } from '@react-router/cloudflare-pages/worker';