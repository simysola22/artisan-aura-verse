/**
 * In-process PubSub for Server-Sent Events transport.
 *
 * Architecture:
 *   - Each conversation has a Set of subscriber callbacks.
 *   - When a message is sent, the service publishes to the conversation's
 *     channel; all connected SSE handlers forward the event to their clients.
 *   - On SSE disconnect, the handler calls its unsubscribe function to clean up.
 *
 * Portability:
 *   - This is a single-process in-memory implementation — suitable for a
 *     single-instance Render deployment.
 *   - To scale horizontally, replace this module with a Redis Pub/Sub adapter
 *     that implements the same PubSub interface. No other file needs to change.
 *
 * Limitation (documented):
 *   Multiple backend instances will NOT share events between instances.
 *   For multi-instance deployments, swap this implementation for one backed
 *   by Redis Pub/Sub (SUBSCRIBE / PUBLISH commands) without changing the
 *   interface consumed by routes and services.
 */

export type MessageEvent = {
  conversationId: string;
  messageId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type MessageSubscriber = (event: MessageEvent) => void;

export interface PubSub {
  publish(conversationId: string, event: MessageEvent): void;
  subscribe(conversationId: string, subscriber: MessageSubscriber): () => void;
  subscriberCount(conversationId: string): number;
}

class InMemoryPubSub implements PubSub {
  private readonly channels = new Map<string, Set<MessageSubscriber>>();

  publish(conversationId: string, event: MessageEvent): void {
    const subs = this.channels.get(conversationId);
    if (!subs || subs.size === 0) return;
    for (const sub of subs) {
      try {
        sub(event);
      } catch {
        // A subscriber error must not prevent delivery to other subscribers
      }
    }
  }

  subscribe(conversationId: string, subscriber: MessageSubscriber): () => void {
    let subs = this.channels.get(conversationId);
    if (!subs) {
      subs = new Set();
      this.channels.set(conversationId, subs);
    }
    subs.add(subscriber);

    return () => {
      const channel = this.channels.get(conversationId);
      if (!channel) return;
      channel.delete(subscriber);
      if (channel.size === 0) {
        this.channels.delete(conversationId);
      }
    };
  }

  subscriberCount(conversationId: string): number {
    return this.channels.get(conversationId)?.size ?? 0;
  }
}

/** Singleton instance — shared across all route handlers in the same process. */
export const pubsub: PubSub = new InMemoryPubSub();
