/**
 * Messaging API — conversations, messages, and SSE realtime updates.
 *
 * Real mode: calls backend /v1/messaging/* endpoints; SSE via native fetch streaming.
 * Mock mode: delegates to in-memory mock adapter.
 *
 * Backend routes:
 *   GET  /v1/messaging/conversations                       List conversations
 *   POST /v1/messaging/conversations                       Create conversation
 *   GET  /v1/messaging/conversations/:id/messages          Paginated messages
 *   POST /v1/messaging/conversations/:id/messages          Send message
 *   GET  /v1/messaging/conversations/:id/stream            SSE stream
 */

import { USE_MOCK_API, API_BASE_URL, apiFetch, getAuthToken } from "./client";
import { mockMessaging } from "./mock/adapter";
import type { Conversation, Message } from "@/types";

/**
 * Get or create a 1:1 conversation with a recipient by their PMP user ID.
 * Returns the conversation (existing or newly created).
 */
export function createConversation(
  recipientId: string,
): Promise<{ id: string; [key: string]: unknown }> {
  if (USE_MOCK_API) return mockMessaging.listConversations().then(() => ({ id: "mock-conv" }));
  return apiFetch<{ id: string; [key: string]: unknown }>("/v1/messaging/conversations", {
    method: "POST",
    body: { recipientId },
  });
}

export function listConversations(): Promise<Conversation[]> {
  if (USE_MOCK_API) return mockMessaging.listConversations();
  // Backend returns { items: Conversation[], page, pageSize, total } — unwrap items.
  return apiFetch<{ items: Conversation[]; page: number; pageSize: number; total: number }>(
    "/v1/messaging/conversations",
  ).then((r) => r.items);
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

/**
 * Subscribe to real-time messages for a conversation.
 *
 * Mock mode: no-op (mock environment has no transport).
 * Real mode: opens an SSE connection to /v1/messaging/conversations/:id/stream
 *   using fetch streaming with a Bearer token in the Authorization header.
 *   The server sends `data: <JSON>` events; each event is a Message object.
 *
 * Returns an unsubscribe function — call it to close the connection.
 */
export function subscribe(conversationId: string, onMessage: (m: Message) => void): () => void {
  if (USE_MOCK_API) return mockMessaging.subscribe(conversationId, onMessage);

  // Use an AbortController so we can tear down cleanly.
  const controller = new AbortController();
  const { signal } = controller;

  async function connect() {
    try {
      const token = await getAuthToken();
      const url = `${API_BASE_URL.replace(/\/$/, "")}/v1/messaging/conversations/${conversationId}/stream`;

      const response = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
      });

      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines.
        const events = buffer.split(/\n\n/);
        // Last element may be an incomplete event — keep it in buffer.
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const msg = JSON.parse(json) as Message;
            onMessage(msg);
          } catch {
            // Skip malformed frames
          }
        }
      }
    } catch (err) {
      // Suppress AbortError — that's a clean close.
      if (err instanceof Error && err.name === "AbortError") return;
      // Reconnect after 3 s on unexpected errors (network blip, etc.)
      if (!signal.aborted) {
        setTimeout(() => { void connect(); }, 3000);
      }
    }
  }

  void connect();

  return () => controller.abort();
}
