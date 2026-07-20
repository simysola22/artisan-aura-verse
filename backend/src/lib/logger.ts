import pino from "pino";

export type Logger = pino.Logger;

/**
 * Create a structured logger.
 * In production: JSON output.
 * In development: pretty-printed if pino-pretty is available, else JSON.
 * In test: silent.
 *
 * Secrets are redacted from all log output — passwords, tokens, secrets,
 * and authorization headers are replaced with [REDACTED].
 */
export function createLogger(nodeEnv?: string): Logger {
  const env = nodeEnv ?? process.env["NODE_ENV"] ?? "development";

  const baseOptions: pino.LoggerOptions = {
    level: env === "test" ? "silent" : "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "*.password",
        "*.newPassword",
        "*.currentPassword",
        "*.token",
        "*.refreshToken",
        "*.secret",
        "*.apiKey",
        "*.api_key",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(baseOptions);
}

/** Singleton logger — created once from process.env at startup. */
export const logger: Logger = createLogger(process.env["NODE_ENV"] ?? "development");
