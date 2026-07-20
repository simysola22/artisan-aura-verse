/**
 * Email abstraction.
 *
 * Business logic never imports a specific email SDK. Swap the driver in
 * createEmailSender() to use SMTP, SendGrid, Resend, Postmark, etc.
 *
 * Current drivers:
 *   "console" — logs emails to stdout. Safe for local dev and tests.
 *   "smtp"    — not yet implemented; placeholder to show the seam.
 */

import { logger } from "./logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailDriver {
  send(message: EmailMessage): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Console driver (development / tests)
// ---------------------------------------------------------------------------

class ConsoleEmailDriver implements EmailDriver {
  constructor(private readonly from: string) {}

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      {
        email: {
          from: this.from,
          to: message.to,
          subject: message.subject,
        },
      },
      "[email:console] Email would be sent",
    );
  }

  async close(): Promise<void> {
    // nothing to tear down
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface EmailConfig {
  driver: "console" | "smtp";
  from: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}

export function createEmailSender(cfg: EmailConfig): EmailDriver {
  if (cfg.driver === "smtp") {
    // TODO (Stage 2): instantiate nodemailer or @sendgrid/mail.
    throw new Error(
      "SMTP email driver is not yet implemented. " +
        "Set EMAIL_DRIVER=console for local development.",
    );
  }
  return new ConsoleEmailDriver(cfg.from);
}
