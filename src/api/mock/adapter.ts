/**
 * Mock adapter. Simulates latency and returns typed data from `data.ts`.
 * This is the ONLY place where mock data touches the API surface. Feature
 * modules must never import from `./data` directly.
 */
import type {
  AuthSession,
  Conversation,
  Employer,
  Message,
  Provider,
  SearchFilters,
  SearchResult,
  User,
  VerificationApplication,
} from "@/types";
import { ApiError } from "../client";
import {
  categories,
  conversations,
  messages,
  providers,
  skills,
  verificationApplications,
} from "./data";

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const mockAuth = {
  async login(email: string, _password: string): Promise<{ session: AuthSession; user: User }> {
    await delay();
    if (!email) throw new ApiError("Email is required", { status: 400 });
    const user: Employer = {
      id: "me",
      email,
      role: "employer",
      displayName: email.split("@")[0] ?? "You",
      createdAt: new Date().toISOString(),
    };
    return {
      user,
      session: {
        token: `mock.${uid()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      },
    };
  },
  async register(input: {
    email: string;
    password: string;
    role: "employer" | "provider";
    displayName: string;
  }): Promise<{ session: AuthSession; user: User }> {
    await delay();
    const user: User =
      input.role === "employer"
        ? {
            id: uid(),
            email: input.email,
            role: "employer",
            displayName: input.displayName,
            createdAt: new Date().toISOString(),
          }
        : {
            id: uid(),
            email: input.email,
            role: "provider",
            kind: "artisan",
            displayName: input.displayName,
            headline: "New provider",
            category: "",
            skills: [],
            experience: [],
            certifications: [],
            portfolio: [],
            verification: "unverified",
            createdAt: new Date().toISOString(),
          };
    return {
      user,
      session: {
        token: `mock.${uid()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      },
    };
  },
  async logout() {
    await delay(60);
  },
  async recover(_email: string): Promise<{ ok: true }> {
    await delay();
    return { ok: true as const };
  },
};

// ---------------------------------------------------------------------------
// Providers & search
// ---------------------------------------------------------------------------
export const mockProviders = {
  async list(): Promise<Provider[]> {
    await delay();
    return providers;
  },
  async get(id: string): Promise<Provider> {
    await delay();
    const p = providers.find((x) => x.id === id);
    if (!p) throw new ApiError("Provider not found", { status: 404 });
    return p;
  },
  async search(filters: SearchFilters): Promise<SearchResult> {
    await delay();
    let items = [...providers];
    if (filters.q) {
      const q = filters.q.toLowerCase();
      items = items.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.headline.toLowerCase().includes(q) ||
          p.about?.toLowerCase().includes(q) ||
          p.skills.some((s) => s.name.toLowerCase().includes(q)),
      );
    }
    if (filters.category) items = items.filter((p) => p.category === filters.category);
    if (filters.skill) items = items.filter((p) => p.skills.some((s) => s.id === filters.skill));
    if (filters.kind) items = items.filter((p) => p.kind === filters.kind);
    if (filters.verified) items = items.filter((p) => p.verification === "verified");
    if (filters.location)
      items = items.filter((p) =>
        p.serviceArea?.toLowerCase().includes(filters.location!.toLowerCase()),
      );
    if (filters.sort === "rating")
      items.sort((a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0));
    if (filters.sort === "recent") items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items, page: 1, pageSize: items.length, total: items.length };
  },
};

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export const mockRef = {
  async categories() {
    await delay(80);
    return categories;
  },
  async skills() {
    await delay(80);
    return skills;
  },
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
export const mockVerification = {
  async status(providerId: string): Promise<VerificationApplication> {
    await delay();
    const v = verificationApplications.find((x) => x.providerId === providerId);
    if (!v) throw new ApiError("No application", { status: 404 });
    return v;
  },
  async submit(
    providerId: string,
    _payload: Partial<VerificationApplication>,
  ): Promise<VerificationApplication> {
    await delay(400);
    return {
      id: `va-${providerId}-${uid()}`,
      providerId,
      status: "in_review",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      evidence: [],
      requestedInfo: [],
    };
  },
};

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
export const mockMessaging = {
  async listConversations(): Promise<Conversation[]> {
    await delay();
    return conversations;
  },
  async listMessages(conversationId: string): Promise<Message[]> {
    await delay();
    return messages[conversationId] ?? [];
  },
  async sendMessage(conversationId: string, body: string): Promise<Message> {
    await delay(120);
    const msg: Message = {
      id: uid(),
      conversationId,
      senderId: "me",
      body,
      createdAt: new Date().toISOString(),
      status: "sent",
    };
    (messages[conversationId] ??= []).push(msg);
    return msg;
  },
  /**
   * Abstract subscription. In production this would be websockets/SSE.
   * The frontend depends only on this interface, not the transport.
   */
  subscribe(conversationId: string, onMessage: (m: Message) => void): () => void {
    void conversationId;
    void onMessage;
    // no-op in mock — polling could be added if needed by consumers
    return () => {};
  },
};
