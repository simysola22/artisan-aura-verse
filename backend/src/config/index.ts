import { z } from "zod";

/**
 * SESSION_SECRET audit (Stage 2):
 * SESSION_SECRET was listed as an available secret but was NEVER referenced
 * anywhere in the backend source. Clerk now owns session lifecycle entirely.
 * SESSION_SECRET is NOT required by any backend component and must not be added.
 *
 * JWT_SECRET audit (Stage 2):
 * JWT_SECRET was used in Stage 1 for signing/verifying custom JWTs with jose.
 * Clerk now owns authentication tokens. The backend no longer signs or verifies
 * JWTs independently. JWT_SECRET has been removed from the required config.
 */

const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // Database — validated as a string only; the postgres driver gives a clear
  // error on malformed URLs. z.string().url() rejects postgres:// scheme.
  DATABASE_URL: z.string().optional(),

  // Clerk authentication
  // CLERK_SECRET_KEY: backend only — never exposed to frontend, never VITE_ prefix.
  // Optional in schema so test environments that inject a mock adapter don't need it.
  // Required at runtime when creating a real ClerkAuthAdapter (enforced in lib/clerk.ts).
  CLERK_SECRET_KEY: z.string().optional(),

  // CLERK_PUBLISHABLE_KEY: frontend public config (VITE_CLERK_PUBLISHABLE_KEY is the
  // frontend var). The backend does not use the publishable key directly — it uses
  // CLERK_SECRET_KEY for server-side token verification.

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:5000"),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Cache
  REDIS_URL: z.string().optional(),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Email
  EMAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@example.com"),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${errors.join("\n")}`);
  }
  return result.data;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset the cached config — only used in tests. */
export function resetConfig(): void {
  _config = null;
}
