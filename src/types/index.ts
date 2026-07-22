/**
 * Domain types for the marketplace frontend.
 *
 * These are the shared shapes used by the API layer, feature modules, and UI.
 * When the backend is implemented, these should be kept in sync with the API
 * contract (see `src/api/contracts.md`).
 */

export type ISODateString = string;
export type UUID = string;

export type UserRole = "employer" | "provider" | "ops";
export type ProviderKind = "artisan" | "professional";
export type VerificationStatus =
  | "unverified"
  | "in_review"
  | "additional_info_requested"
  | "verified"
  | "rejected";

export interface AuthSession {
  token: string;
  userId: UUID;
  expiresAt: ISODateString;
}

export interface UserBase {
  id: UUID;
  email: string;
  role: UserRole;
  displayName: string;
  avatarUrl?: string;
  createdAt: ISODateString;
}

export interface Employer extends UserBase {
  role: "employer";
  organization?: string;
  location?: string;
}

export interface Skill {
  id: UUID;
  name: string;
  category: string;
}

export interface Experience {
  id: UUID;
  role: string;
  organization: string;
  startDate: ISODateString;
  endDate?: ISODateString;
  description?: string;
}

export interface Certification {
  id: UUID;
  name: string;
  issuer: string;
  issuedAt: ISODateString;
  expiresAt?: ISODateString;
  evidenceUrl?: string;
}

export interface PortfolioItem {
  id: UUID;
  title: string;
  description?: string;
  mediaUrl: string;
  mediaType: "image" | "video" | "document";
  createdAt: ISODateString;
}

export interface Review {
  id: UUID;
  authorName: string;
  rating: number; // 0..5
  body: string;
  createdAt: ISODateString;
}

export interface Provider extends UserBase {
  role: "provider";
  kind: ProviderKind;
  headline: string;
  about?: string;
  category: string;
  skills: Skill[];
  experience: Experience[];
  certifications: Certification[];
  portfolio: PortfolioItem[];
  verification: VerificationStatus;
  serviceArea?: string;
  availability?: "available" | "limited" | "unavailable";
  ratingAverage?: number;
  ratingCount?: number;
  reviews?: Review[];
  hourlyRate?: number;
  currency?: string;
}

export interface OpsUser extends UserBase {
  role: "ops";
}

export type User = Employer | Provider | OpsUser;

export interface Category {
  id: UUID;
  name: string;
  slug: string;
  kind: ProviderKind | "both";
  description?: string;
  icon?: string;
}

export interface SearchFilters {
  q?: string;
  category?: string;
  skill?: string;
  kind?: ProviderKind;
  verified?: boolean;
  location?: string;
  minExperience?: number;
  sort?: "relevance" | "rating" | "recent";
  /** Pagination */
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type SearchResult = Paginated<Provider>;

export interface VerificationApplication {
  id: UUID;
  providerId: UUID;
  status: VerificationStatus;
  submittedAt?: ISODateString;
  updatedAt: ISODateString;
  cvUrl?: string;
  evidence: PortfolioItem[];
  notes?: string;
  requestedInfo?: string[];
}

export interface Message {
  id: UUID;
  conversationId: UUID;
  senderId: UUID;
  body: string;
  createdAt: ISODateString;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
}

export interface ConversationParticipant {
  id: UUID;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
}

export interface Conversation {
  id: UUID;
  participants: ConversationParticipant[];
  lastMessage?: Message;
  unreadCount: number;
  updatedAt: ISODateString;
}

export interface Subscription {
  id: UUID;
  userId: UUID;
  plan: "free" | "pro" | "business";
  renewsAt?: ISODateString;
  entitlements: string[];
}
