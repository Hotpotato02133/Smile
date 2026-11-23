"use client";

import { useMutation } from "convex/react";
import {
  ExternalLink,
  FileImage,
  FileText,
  HardDrive,
  Lock,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes, formatDateTime, getErrorMessage } from "@/lib/format";
import { compressClinicalFile } from "@/lib/image-compression";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type ClinicalFileType =
  | "xray_periapical"
  | "xray_panoramic"
  | "intraoral_photo"
  | "consent_form";

const FILE_TYPE_LABELS: Record<ClinicalFileType, string> = {
  xray_periapical: "Periapical X-Ray",
  xray_panoramic: "Panoramic X-Ray",
  intraoral_photo: "Intraoral Photo",
  consent_form: "Consent Form",
};

export type ClinicalFileItem = {
  _id: Id<"clinicalFiles">;
  fileName: string;
  fileType: ClinicalFileType;
  sizeBytes: number;
  createdAt: number;
  url: string | null;
};

export function XrayVault({
  patientId,
  appointmentId,
  files,
  enabled,
  isReadOnly,
  storageUsedBytes,
  maxStorageBytes,
}: {
  patientId: Id<"patients">;
  appointmentId?: Id<"appointments">;
  files: ClinicalFileItem[];
  enabled: boolean;
  isReadOnly: boolean;
  storageUsedBytes?: number;
  maxStorageBytes?: number;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveClinicalFile = useMutation(api.files.saveClinicalFile);
  const deleteClinicalFile = useMutation(api.files.deleteClinicalFile);

  const [fileType, setFileType] = useState<ClinicalFileType>("xray_periapical");
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] =
    useState<Id<"clinicalFiles"> | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"clinicalFiles"> | null>(
    null
  );

  const hasStorageQuota =
    typeof storageUsedBytes === "number" &&
    typeof maxStorageBytes === "number" &&
    maxStorageBytes > 0;
  const usagePct = hasStorageQuota
    ? Math.min(100, Math.round((storageUsedBytes / maxStorageBytes) * 100))
    : 0;
  const isNearQuota = hasStorageQuota && usagePct >= 85;
  const isAtQuota = hasStorageQuota && storageUsedBytes >= maxStorageBytes;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const compressed = await compressClinicalFile(file);
      const uploadUrl = await generateUploadUrl({
        fileSizeBytes: compressed.compressedBytes,
      });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": compressed.mimeType },
        body: compressed.blob,
      });
      if (!res.ok) throw new Error("Storage upload failed.");
      const json = (await res.json()) as { storageId: Id<"_storage"> };

      await saveClinicalFile({
        patientId,
        appointmentId,
        storageId: json.storageId,
        fileName: compressed.fileName,
        fileType,
        sizeBytes: compressed.compressedBytes,
      });

      toast.success(
        `Uploaded ${compressed.fileName} (${formatBytes(compressed.originalBytes)} -> ${formatBytes(compressed.compressedBytes)}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: Id<"clinicalFiles">) => {
    setDeletingId(fileId);
    try {
      await deleteClinicalFile({ fileId });
      setConfirmDeleteId(null);
      toast.success("Clinical file deleted and storage quota freed.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not delete file."));
    } finally {
      setDeletingId(null);
    }
  };

  if (!enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <Lock className="size-6 opacity-60" />
          <p className="font-medium text-foreground">
            X-Ray & Intraoral Photo Vault is not enabled on this plan.
          </p>
          <p className="text-xs">
            Upgrade to Smile Starter or Pro Clinic to upload compressed X-rays.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-base">
            X-Ray & Intraoral Photo Vault
          </CardTitle>
          <CardDescription>
            Images are automatically compressed client-side to WebP (max 1600px,
            ≤ 500 KB) to protect your clinic&apos;s storage quota.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">File Category</Label>
            <Select
              disabled={isReadOnly || uploading}
              value={fileType}
              onValueChange={(v) => {
                if (v) setFileType(v as ClinicalFileType);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xray_periapical">Periapical X-Ray</SelectItem>
                <SelectItem value="xray_panoramic">Panoramic X-Ray</SelectItem>
                <SelectItem value="intraoral_photo">Intraoral Photo</SelectItem>
                <SelectItem value="consent_form">Consent Form</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="clinical-upload" className="sr-only">
              Upload X-ray or photo
            </Label>
            <Input
              id="clinical-upload"
              type="file"
              accept="image/*,application/pdf"
              disabled={isReadOnly || uploading || isAtQuota}
              onChange={handleFileChange}
              className="w-56"
            />
          </div>
          {uploading ? (
            <Upload className="mb-2 size-4 animate-pulse text-muted-foreground" />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {hasStorageQuota ? (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <HardDrive className="size-3.5 text-muted-foreground" />
                Clinic Vault Storage
              </span>
              <span
                className={`font-mono ${
                  isAtQuota
                    ? "font-semibold text-destructive"
                    : isNearQuota
                      ? "font-semibold text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {formatBytes(storageUsedBytes)} / {formatBytes(maxStorageBytes)}{" "}
                ({usagePct}%)
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  isAtQuota
                    ? "bg-destructive"
                    : isNearQuota
                      ? "bg-amber-500"
                      : "bg-primary"
                }`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        ) : null}

        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            <FileImage className="size-6 opacity-50" />
            <p>No X-rays or clinical photos uploaded for this patient yet.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((item) => {
              const isPdf = item.fileName.toLowerCase().endsWith(".pdf");
              const isConfirming = confirmDeleteId === item._id;
              return (
                <div
                  key={item._id}
                  className="flex flex-col justify-between overflow-hidden rounded-xl border bg-muted/20"
                >
                  {item.url && !isPdf ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-video overflow-hidden bg-black/90"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.fileName}
                        className="h-full w-full object-contain transition-transform hover:scale-105"
                      />
                    </a>
                  ) : (
                    <div className="flex aspect-video flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                      <FileText className="size-8" />
                      <span className="text-[11px] font-medium">
                        {isPdf ? "PDF Document" : "Clinical File"}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {FILE_TYPE_LABELS[item.fileType]}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>
                    <p className="truncate font-medium" title={item.fileName}>
                      {item.fileName}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.url ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            render={
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Open full file"
                              />
                            }
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                        ) : null}
                        {!isReadOnly ? (
                          isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={deletingId === item._id}
                                onClick={() => handleDelete(item._id)}
                              >
                                {deletingId === item._id ? "Deleting…" : "Confirm"}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Delete file"
                              onClick={() => setConfirmDeleteId(item._id)}
                            >
                              <Trash2 className="size-3.5 text-destructive" />
                            </Button>
                          )
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
