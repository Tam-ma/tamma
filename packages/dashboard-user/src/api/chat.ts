/**
 * Story 39-19 — REST client for the read-only chat history projection endpoints:
 *   GET /api/chat/conversations
 *   GET /api/chat/conversations/{conversationId}
 */

import { apiClient, type ApiClient } from './client';

export interface ChatConversationSummary {
  conversationId: string;
  lastActivityAt: string;
  lastSnippet: string;
  messageCount: number;
}

export interface ChatConversationListResponse {
  items: ChatConversationSummary[];
  count: number;
}

export interface ChatMessageItem {
  eventId: string;
  sequenceNumber: number;
  conversationId: string;
  turnId: string | null;
  direction: 'user->agent' | 'agent->user' | string;
  content: string;
  timestamp: string;
}

export interface ChatConversationPage {
  conversationId: string;
  messages: ChatMessageItem[];
  nextCursor: number | null;
  hasMore: boolean;
}

export async function listConversations(
  limit?: number,
  client: ApiClient = apiClient,
): Promise<ChatConversationListResponse> {
  const qs = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return client.get<ChatConversationListResponse>(`/api/chat/conversations${qs}`);
}

export async function getConversation(
  conversationId: string,
  options: { cursor?: number; limit?: number } = {},
  client: ApiClient = apiClient,
): Promise<ChatConversationPage> {
  const params = new URLSearchParams();
  if (options.cursor !== undefined) params.set('cursor', String(options.cursor));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const qs = params.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '';
  return client.get<ChatConversationPage>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}${suffix}`,
  );
}
