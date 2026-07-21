import { USE_MOCK_API, apiFetch } from "./client";
import { mockMessaging } from "./mock/adapter";
import type { Conversation, Message } from "@/types";

export function listConversations(): Promise<Conversation[]> {
  if (USE_MOCK_API) return mockMessaging.listConversations();
  return apiFetch<Conversation[]>("/v1/messaging/conversations");
}
export function listMessages(conversationId: string): Promise<Message[]> {
  if (USE_MOCK_API) return mockMessaging.listMessages(conversationId);
  return apiFetch<Message[]>(`/v1/messaging/conversations/${conversationId}/messages`);
}
export function sendMessage(conversationId: string, body: string): Promise<Message> {
  if (USE_MOCK_API) return mockMessaging.sendMessage(conversationId, body);
  return apiFetch<Message>(`/v1/messaging/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { body },
  });
}
export const subscribe = mockMessaging.subscribe;
