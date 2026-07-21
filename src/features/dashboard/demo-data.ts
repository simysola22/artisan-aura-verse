/**
 * Clearly-labelled demo data for the marketplace dashboard.
 *
 * IMPORTANT: This is placeholder data only. It is NOT fetched from the
 * backend and does NOT represent real marketplace listings. These sections
 * will be replaced with real API data once the marketplace listings feature
 * is implemented. The UI clearly labels this data as "Demo" to avoid confusion.
 */

export interface DemoTalent {
  id: string;
  displayName: string;
  category: string;
  skills: string[];
  location: string;
  verificationStatus: "verified" | "unverified" | "in_review";
  ratingAverage: number | null;
  ratingCount: number;
  yearsExperience: number;
  kind: "artisan" | "professional";
}

export interface DemoJob {
  id: string;
  title: string;
  category: string;
  location: string;
  budgetDisplay: string;
  postedAt: string; // relative label
  employerName: string;
}

export const DEMO_TALENTS: DemoTalent[] = [
  {
    id: "demo-t1",
    displayName: "Adaeze Okafor",
    category: "Electrical",
    skills: ["Wiring", "Solar installation", "Fault diagnosis"],
    location: "Lagos, Nigeria",
    verificationStatus: "verified",
    ratingAverage: 4.8,
    ratingCount: 32,
    yearsExperience: 7,
    kind: "artisan",
  },
  {
    id: "demo-t2",
    displayName: "Chukwuemeka Eze",
    category: "Plumbing",
    skills: ["Pipe fitting", "Drainage", "Borehole"],
    location: "Abuja, Nigeria",
    verificationStatus: "verified",
    ratingAverage: 4.6,
    ratingCount: 18,
    yearsExperience: 5,
    kind: "artisan",
  },
  {
    id: "demo-t3",
    displayName: "Ngozi Mensah",
    category: "Interior Design",
    skills: ["Space planning", "3D renders", "Procurement"],
    location: "Accra, Ghana",
    verificationStatus: "verified",
    ratingAverage: 4.9,
    ratingCount: 41,
    yearsExperience: 9,
    kind: "professional",
  },
  {
    id: "demo-t4",
    displayName: "Babatunde Adeyemi",
    category: "Carpentry",
    skills: ["Furniture making", "Roofing", "Joinery"],
    location: "Ibadan, Nigeria",
    verificationStatus: "in_review",
    ratingAverage: null,
    ratingCount: 0,
    yearsExperience: 4,
    kind: "artisan",
  },
  {
    id: "demo-t5",
    displayName: "Amaka Nwosu",
    category: "Architecture",
    skills: ["AutoCAD", "Structural design", "Project management"],
    location: "Port Harcourt, Nigeria",
    verificationStatus: "verified",
    ratingAverage: 4.7,
    ratingCount: 27,
    yearsExperience: 12,
    kind: "professional",
  },
  {
    id: "demo-t6",
    displayName: "Kofi Asante",
    category: "Welding & Fabrication",
    skills: ["MIG welding", "Gate fabrication", "Stainless steel"],
    location: "Kumasi, Ghana",
    verificationStatus: "unverified",
    ratingAverage: 4.3,
    ratingCount: 9,
    yearsExperience: 6,
    kind: "artisan",
  },
];

export const DEMO_JOBS: DemoJob[] = [
  {
    id: "demo-j1",
    title: "Electrical rewiring — 4-bedroom house",
    category: "Electrical",
    location: "Lagos Island, Lagos",
    budgetDisplay: "₦150,000 – ₦250,000",
    postedAt: "2 hours ago",
    employerName: "Greenview Estates",
  },
  {
    id: "demo-j2",
    title: "Kitchen plumbing & drainage overhaul",
    category: "Plumbing",
    location: "Wuse 2, Abuja",
    budgetDisplay: "₦80,000 – ₦120,000",
    postedAt: "5 hours ago",
    employerName: "Private homeowner",
  },
  {
    id: "demo-j3",
    title: "Office interior fit-out — 200 sqm open plan",
    category: "Interior Design",
    location: "Victoria Island, Lagos",
    budgetDisplay: "₦1,200,000 – ₦2,000,000",
    postedAt: "Yesterday",
    employerName: "Apex Fintech Ltd",
  },
  {
    id: "demo-j4",
    title: "Custom wardrobe & bedroom furniture",
    category: "Carpentry",
    location: "Lekki Phase 1, Lagos",
    budgetDisplay: "₦200,000 – ₦350,000",
    postedAt: "2 days ago",
    employerName: "Private homeowner",
  },
  {
    id: "demo-j5",
    title: "Compound gate fabrication & installation",
    category: "Welding & Fabrication",
    location: "Enugu, Nigeria",
    budgetDisplay: "₦120,000 – ₦180,000",
    postedAt: "3 days ago",
    employerName: "Heritage Homes",
  },
  {
    id: "demo-j6",
    title: "Solar system installation — residential",
    category: "Electrical",
    location: "Ikorodu, Lagos",
    budgetDisplay: "₦400,000 – ₦600,000",
    postedAt: "4 days ago",
    employerName: "Private homeowner",
  },
];
