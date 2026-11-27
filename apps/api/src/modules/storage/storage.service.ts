import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { API_ERROR_CODES } from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { AppEnv } from "../../config/env";

export type StorageVisibility = "private" | "public";

export interface PresignedUploadResult {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
  publicUrl?: string;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes: number;
  contentType?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client | null;
  private readonly privateBucket: string;
  private readonly publicBucket: string;
  private readonly publicBaseUrl: string | undefined;

  constructor(configService: ConfigService<AppEnv, true>) {
    const accountId = configService.get("R2_ACCOUNT_ID", { infer: true })?.trim();
    const accessKeyId = configService
      .get("R2_ACCESS_KEY_ID", { infer: true })
      ?.trim();
    const secretAccessKey = configService
      .get("R2_SECRET_ACCESS_KEY", { infer: true })
      ?.trim();

    this.privateBucket = configService.get("R2_PRIVATE_BUCKET", { infer: true });
    this.publicBucket = configService.get("R2_PUBLIC_BUCKET", { infer: true });
    this.publicBaseUrl = configService
      .get("R2_PUBLIC_BASE_URL", { infer: true })
      ?.trim()
      ?.replace(/\/+$/, "");

    if (accountId && accessKeyId && secretAccessKey) {
      this.s3 = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.s3 = null;
    }
  }

  private sanitizeExtension(fileName: string): string {
    const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName.trim());
    return match ? match[1].toLowerCase() : "webp";
  }

  private bucketFor(visibility: StorageVisibility): string {
    return visibility === "public" ? this.publicBucket : this.privateBucket;
  }

  buildClinicalKey(clinicId: string, patientId: string, fileName: string): string {
    const ext = this.sanitizeExtension(fileName);
    return `private/clinical/${clinicId}/${patientId}/${randomUUID()}.${ext}`;
  }

  buildLogoKey(clinicId: string, fileName: string): string {
    const ext = this.sanitizeExtension(fileName);
    return `public/logos/${clinicId}/${randomUUID()}.${ext}`;
  }

  buildReceiptKey(clinicId: string, fileName: string): string {
    const ext = this.sanitizeExtension(fileName);
    return `private/receipts/${clinicId}/${randomUUID()}.${ext}`;
  }

  getPublicUrl(storageKey: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl}/${storageKey.replace(/^\/+/, "")}`;
  }

  async createPresignedPutUrl(params: {
    storageKey: string;
    contentType: string;
    contentLength: number;
    visibility: StorageVisibility;
    expiresInSeconds?: number;
  }): Promise<PresignedUploadResult> {
    if (!this.s3) {
      throw new DomainException(
        API_ERROR_CODES.INTERNAL_ERROR,
        "Cloudflare R2 storage credentials are not configured.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const expiresInSeconds = params.expiresInSeconds ?? 300;
    const command = new PutObjectCommand({
      Bucket: this.bucketFor(params.visibility),
      Key: params.storageKey,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      storageKey: params.storageKey,
      expiresInSeconds,
      ...(params.visibility === "public" && this.publicBaseUrl
        ? { publicUrl: this.getPublicUrl(params.storageKey) ?? undefined }
        : {}),
    };
  }

  /** Short-lived presigned GET URL for private PHI X-rays & payment receipts (Law #6). */
  async createPresignedGetUrl(
    storageKey: string,
    expiresInSeconds = 300
  ): Promise<string | null> {
    if (!this.s3) return null;
    const command = new GetObjectCommand({
      Bucket: this.privateBucket,
      Key: storageKey,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  /** Verifies authoritative object byte size directly from R2 (never trusts client sizeBytes). */
  async headObject(
    storageKey: string,
    visibility: StorageVisibility = "private"
  ): Promise<HeadObjectResult> {
    if (!this.s3) {
      return { exists: false, sizeBytes: 0 };
    }
    try {
      const res = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketFor(visibility),
          Key: storageKey,
        })
      );
      return {
        exists: true,
        sizeBytes: Number(res.ContentLength ?? 0),
        contentType: res.ContentType,
      };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  async deleteObject(
    storageKey: string,
    visibility: StorageVisibility = "private"
  ): Promise<void> {
    if (!this.s3) return;
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucketFor(visibility),
          Key: storageKey,
        })
      );
    } catch (error) {
      this.logger.warn(
        `Failed to delete R2 object ${storageKey}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }
}
