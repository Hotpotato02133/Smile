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
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center text-sm text-slate-500">
        <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Lock className="size-5" />
        </div>
        <p className="mt-1 font-semibold text-slate-900">
          X-Ray &amp; Intraoral Photo Vault is not enabled on this plan.
        </p>
        <p className="text-xs text-slate-500">
          Upgrade to Smile Starter or Pro Clinic to upload compressed X-rays.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            X-Ray &amp; Intraoral Photo Vault
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Images are automatically compressed client-side to WebP (max 1600px,
            ≤ 500 KB) to protect your clinic&apos;s storage quota.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="xray-category" className="sr-only">
              File Category
            </Label>
            <Select
              disabled={isReadOnly || uploading}
              value={fileType}
              onValueChange={(v) => {
                if (v) setFileType(v as ClinicalFileType);
              }}
            >
              <SelectTrigger
                id="xray-category"
                className="h-9 w-44 rounded-full border-slate-200/90 bg-white text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xray_periapical">
                  Periapical X-Ray
                </SelectItem>
                <SelectItem value="xray_panoramic">
                  Panoramic X-Ray
                </SelectItem>
                <SelectItem value="intraoral_photo">Intraoral Photo</SelectItem>
                <SelectItem value="consent_form">Consent Form</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <input
            ref={fileInputRef}
            id="clinical-upload"
            type="file"
            accept="image/*,application/pdf"
            disabled={isReadOnly || uploading || isAtQuota}
            onChange={handleFileChange}
            className="sr-only"
          />
          <Button
            type="button"
            size="sm"
            disabled={isReadOnly || uploading || isAtQuota}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
          >
            <Upload className="mr-1.5 size-3.5" />
            {uploading ? "Compressing & Uploading…" : "Upload File"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {hasStorageQuota ? (
          <div className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <HardDrive className="size-3.5 text-slate-400" />
                Clinic Vault Storage
              </span>
              <span
                className={cn(
                  "tabular-nums font-semibold",
                  isAtQuota
                    ? "text-rose-600"
                    : isNearQuota
                      ? "text-amber-700"
                      : "text-slate-600"
                )}
              >
                {formatBytes(storageUsedBytes)} / {formatBytes(maxStorageBytes)}{" "}
                ({usagePct}%)
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200",
                  isAtQuota
                    ? "bg-rose-500"
                    : isNearQuota
                      ? "bg-amber-500"
                      : "bg-[#6C5CE7]"
                )}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        ) : null}

        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-12 text-center">
            <FileImage className="size-7 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-800">
              No X-rays or clinical photos yet
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Choose a category above and tap Upload File to store periapical
              X-rays, panoramic scans, intraoral photos, or signed consent
              forms.
            </p>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((item) => {
              const isPdf = item.fileName.toLowerCase().endsWith(".pdf");
              const isConfirming = confirmDeleteId === item._id;
              return (
                <div
                  key={item._id}
                  className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200/85 bg-[#F8FAFC]/60"
                >
                  {item.url && !isPdf ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-video overflow-hidden bg-slate-950"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.fileName}
                        className="h-full w-full object-contain transition-transform duration-200 hover:scale-105"
                      />
                    </a>
                  ) : (
                    <div className="flex aspect-video flex-col items-center justify-center gap-1 bg-slate-100 text-slate-500">
                      <FileText className="size-8" />
                      <span className="text-[11px] font-medium">
                        {isPdf ? "PDF Document" : "Clinical File"}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2 bg-white p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                      >
                        {FILE_TYPE_LABELS[item.fileType]}
                      </Badge>
                      <span className="tabular-nums text-[11px] text-slate-500">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>
                    <p
                      className="truncate font-semibold text-slate-900"
                      title={item.fileName}
                    >
                      {item.fileName}
                    </p>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="tabular-nums text-[11px] text-slate-500">
                        {formatDateTime(item.createdAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.url ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="size-7 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950"
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
                                className="rounded-full px-2.5"
                                disabled={deletingId === item._id}
                                onClick={() => handleDelete(item._id)}
                              >
                                {deletingId === item._id
                                  ? "Deleting…"
                                  : "Confirm"}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                className="rounded-full px-2"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete file"
                              onClick={() => setConfirmDeleteId(item._id)}
                            >
                              <Trash2 className="size-3.5" />
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
      </div>
    </section>
  );
}
