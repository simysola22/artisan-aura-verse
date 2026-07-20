/**
 * In-memory mock data. Clearly synthetic — intended only for the frontend
 * development/demo layer. Replace with real API responses when backend lands.
 */
import type {
  Category,
  Conversation,
  Message,
  Provider,
  Skill,
  VerificationApplication,
} from "@/types";

export const categories: Category[] = [
  { id: "c1", name: "Carpentry", slug: "carpentry", kind: "artisan" },
  { id: "c2", name: "Electrical", slug: "electrical", kind: "artisan" },
  { id: "c3", name: "Plumbing", slug: "plumbing", kind: "artisan" },
  { id: "c4", name: "Interior Design", slug: "interior-design", kind: "both" },
  { id: "c5", name: "Legal", slug: "legal", kind: "professional" },
  { id: "c6", name: "Accounting", slug: "accounting", kind: "professional" },
  { id: "c7", name: "Software Engineering", slug: "software", kind: "professional" },
  { id: "c8", name: "Photography", slug: "photography", kind: "both" },
];

export const skills: Skill[] = [
  { id: "s1", name: "Framing", category: "carpentry" },
  { id: "s2", name: "Cabinet making", category: "carpentry" },
  { id: "s3", name: "Wiring", category: "electrical" },
  { id: "s4", name: "Solar install", category: "electrical" },
  { id: "s5", name: "Contract law", category: "legal" },
  { id: "s6", name: "Corporate tax", category: "accounting" },
  { id: "s7", name: "React", category: "software" },
  { id: "s8", name: "TypeScript", category: "software" },
];

const now = new Date().toISOString();

export const providers: Provider[] = [
  {
    id: "p1",
    role: "provider",
    kind: "artisan",
    email: "amara@example.com",
    displayName: "Amara Nwosu",
    headline: "Master carpenter — bespoke joinery & fitted interiors",
    about:
      "Twenty years crafting bespoke cabinetry, staircases and fitted interiors for private residences and boutique hospitality projects.",
    category: "carpentry",
    skills: [skills[0]!, skills[1]!],
    experience: [
      {
        id: "e1",
        role: "Lead Joiner",
        organization: "Oak & Grain Studio",
        startDate: "2015-03-01",
        description: "Led a team of six on 40+ residential fit-outs.",
      },
    ],
    certifications: [
      { id: "ct1", name: "City & Guilds Advanced Carpentry", issuer: "City & Guilds", issuedAt: "2010-06-01" },
    ],
    portfolio: [
      { id: "pf1", title: "Walnut library wall", mediaUrl: "", mediaType: "image", createdAt: now },
      { id: "pf2", title: "Oak floating staircase", mediaUrl: "", mediaType: "image", createdAt: now },
    ],
    verification: "verified",
    serviceArea: "London & South East",
    availability: "available",
    ratingAverage: 4.9,
    ratingCount: 42,
    hourlyRate: 65,
    currency: "GBP",
    createdAt: "2023-01-14T00:00:00Z",
  },
  {
    id: "p2",
    role: "provider",
    kind: "professional",
    email: "jules@example.com",
    displayName: "Jules Okafor",
    headline: "Senior product engineer — React, TypeScript, design systems",
    about:
      "Product-minded engineer building resilient interfaces for regulated industries. Formerly at two YC companies.",
    category: "software",
    skills: [skills[6]!, skills[7]!],
    experience: [
      { id: "e2", role: "Senior Engineer", organization: "Northwind Health", startDate: "2021-09-01" },
    ],
    certifications: [],
    portfolio: [{ id: "pf3", title: "Clinical intake platform", mediaUrl: "", mediaType: "image", createdAt: now }],
    verification: "verified",
    serviceArea: "Remote — EU & UK",
    availability: "limited",
    ratingAverage: 4.8,
    ratingCount: 27,
    hourlyRate: 120,
    currency: "GBP",
    createdAt: "2023-05-02T00:00:00Z",
  },
  {
    id: "p3",
    role: "provider",
    kind: "artisan",
    email: "mira@example.com",
    displayName: "Mira Patel",
    headline: "Licensed electrician — residential & light commercial",
    category: "electrical",
    skills: [skills[2]!, skills[3]!],
    experience: [
      { id: "e3", role: "Electrician", organization: "Brightline Electrical", startDate: "2018-01-01" },
    ],
    certifications: [{ id: "ct2", name: "NICEIC Approved", issuer: "NICEIC", issuedAt: "2019-04-01" }],
    portfolio: [],
    verification: "in_review",
    serviceArea: "Manchester",
    availability: "available",
    ratingAverage: 4.7,
    ratingCount: 18,
    hourlyRate: 55,
    currency: "GBP",
    createdAt: "2024-02-11T00:00:00Z",
  },
  {
    id: "p4",
    role: "provider",
    kind: "professional",
    email: "sam@example.com",
    displayName: "Samir El-Amin",
    headline: "Corporate & commercial lawyer — startups and scaleups",
    category: "legal",
    skills: [skills[4]!],
    experience: [{ id: "e4", role: "Partner", organization: "Meridian Legal", startDate: "2016-06-01" }],
    certifications: [],
    portfolio: [],
    verification: "verified",
    serviceArea: "London",
    availability: "limited",
    ratingAverage: 5,
    ratingCount: 11,
    hourlyRate: 240,
    currency: "GBP",
    createdAt: "2022-11-01T00:00:00Z",
  },
  {
    id: "p5",
    role: "provider",
    kind: "artisan",
    email: "theo@example.com",
    displayName: "Theo Marchetti",
    headline: "Plumber & heating engineer — Gas Safe registered",
    category: "plumbing",
    skills: [],
    experience: [],
    certifications: [{ id: "ct3", name: "Gas Safe", issuer: "Gas Safe Register", issuedAt: "2020-02-01" }],
    portfolio: [],
    verification: "unverified",
    serviceArea: "Bristol",
    availability: "available",
    ratingAverage: 4.6,
    ratingCount: 9,
    hourlyRate: 60,
    currency: "GBP",
    createdAt: "2024-06-01T00:00:00Z",
  },
];

export const verificationApplications: VerificationApplication[] = providers.map((p) => ({
  id: `va-${p.id}`,
  providerId: p.id,
  status: p.verification,
  updatedAt: now,
  evidence: p.portfolio,
  requestedInfo:
    p.verification === "additional_info_requested"
      ? ["Please upload a clearer photo of your certification."]
      : [],
}));

export const conversations: Conversation[] = [
  {
    id: "cv1",
    participants: [
      { id: "me", displayName: "You", role: "employer" },
      { id: "p1", displayName: providers[0]!.displayName, role: "provider" },
    ],
    unreadCount: 2,
    updatedAt: now,
    lastMessage: {
      id: "m2",
      conversationId: "cv1",
      senderId: "p1",
      body: "Happy to visit next Tuesday to take measurements.",
      createdAt: now,
      status: "delivered",
    },
  },
  {
    id: "cv2",
    participants: [
      { id: "me", displayName: "You", role: "employer" },
      { id: "p2", displayName: providers[1]!.displayName, role: "provider" },
    ],
    unreadCount: 0,
    updatedAt: now,
    lastMessage: {
      id: "m5",
      conversationId: "cv2",
      senderId: "me",
      body: "Sounds great — I'll send the brief across today.",
      createdAt: now,
      status: "read",
    },
  },
];

export const messages: Record<string, Message[]> = {
  cv1: [
    { id: "m1", conversationId: "cv1", senderId: "me", body: "Hi Amara, would you be free to quote a walk-in wardrobe fit-out?", createdAt: now, status: "read" },
    { id: "m2", conversationId: "cv1", senderId: "p1", body: "Happy to visit next Tuesday to take measurements.", createdAt: now, status: "delivered" },
  ],
  cv2: [
    { id: "m3", conversationId: "cv2", senderId: "me", body: "Jules — we're looking for a lead engineer on a 6-week engagement.", createdAt: now, status: "read" },
    { id: "m4", conversationId: "cv2", senderId: "p2", body: "Sounds interesting. What's the tech stack?", createdAt: now, status: "read" },
    { id: "m5", conversationId: "cv2", senderId: "me", body: "Sounds great — I'll send the brief across today.", createdAt: now, status: "read" },
  ],
};
