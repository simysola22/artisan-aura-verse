/**
 * Storage abstraction.
 *
 * Business logic never imports a specific storage SDK. Swap the driver in
 * createStorage() to use S3, GCS, R2, or any compatible object store.
 *
 * Current drivers:
 *   "local" — writes files to a local directory. Not suitable for
 *             multi-instance production deployments.
 *   "s3"    — not yet implemented; placeholder to show the seam.
 */

import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";

export interface StorageDriver {
  /** Upload bytes and return a URL/path the application can reference. */
  put(key: string, data: Buffer, mimeType: string): Promise<string>;
  /** Stream or return the raw bytes for a stored key. */
  get(key: string): Promise<Buffer>;
  /** Delete the stored object. */
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local driver (development only)
// ---------------------------------------------------------------------------

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<string> {
    const fullPath = join(this.baseDir, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return `/uploads/${key}`;
  }

  async get(key: string): Promise<Buffer> {
    const fullPath = join(this.baseDir, key);
    return Buffer.from(await readFile(fullPath));
  }

  async del(key: string): Promise<void> {
    const fullPath = join(this.baseDir, key);
    await unlink(fullPath);
  }

  async close(): Promise<void> {
    // nothing to tear down
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface StorageConfig {
  driver: "local" | "s3";
  localDir?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
}

export function createStorage(cfg: StorageConfig): StorageDriver {
  if (cfg.driver === "s3") {
    // TODO (Stage 2): instantiate @aws-sdk/client-s3 pointing at cfg.s3*.
    throw new Error(
      "S3 storage driver is not yet implemented. " +
        "Set STORAGE_DRIVER=local for local development.",
    );
  }
  return new LocalStorageDriver(cfg.localDir ?? "./uploads");
}
