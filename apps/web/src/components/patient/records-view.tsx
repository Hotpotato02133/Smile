"use client";

import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarCheck2,
  ClipboardList,
  ExternalLink,
  FileImage,
  ShieldCheck,
  Smile,
} from "lucide-react";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDate } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  TOOTH_CONDITION_META,
  type PatientDashboardData,
} from "@/components/patient/types";

interface RecordsViewProps {
  data: PatientDashboardData;
}

const UPPER_ARCH = Array.from({ length: 16 }, (_, i) => i + 1);
const LOWER_ARCH = Array.from({ length: 16 }, (_, i) => 32 - i);

const FILE_TYPE_LABEL: Record<string, string> = {
  xray_periapical: "Periapical X-Ray",
  xray_panoramic: "Panoramic X-Ray",
  intraoral_photo: "Intraoral Photo",
  consent_form: "Consent Form",
};

function ProfileClinicalRecords({
  patientId,
  data,
}: {
  patientId: Id<"patients">;
  data: PatientDashboardData;
}) {
  const summary = useQuery(api.patientPortal.getMyClinicalSummary, {
    patientId,
  });
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [lightboxFile, setLightboxFile] = useState<{
    fileName: string;
    fileType: string;
    url: string;
  } | null>(null);

  const aftercareNotes = useMemo(
    () =>
      data.appointments.filter(
        (a) => a.patientId === patientId && Boolean(a.postVisitInstructions)
      ),
    [data.appointments, patientId]
  );

  const latestConditionByTooth = useMemo(() => {
    const map = new Map<
      number,
      NonNullable<typeof summary>["toothRecords"][number]
    >();
    if (!summary) return map;
    for (const rec of summary.toothRecords) {
      if (!map.has(rec.toothNumber)) {
        map.set(rec.toothNumber, rec);
      }
    }
    return map;
  }, [summary]);

  const selectedToothHistory = useMemo(() => {
    if (!summary || selectedTooth === null) return [];
    return summary.toothRecords.filter((r) => r.toothNumber === selectedTooth);
  }, [summary, selectedTooth]);

  if (!summary) {
    return (
      <div className="space-y-4">
        {summary === undefined ? (
          <>
            <div className="h-28 w-full animate-pulse rounded-[24px] bg-slate-100" />
            <div className="h-52 w-full animate-pulse rounded-[24px] bg-slate-100" />
          </>
        ) : (
          <div className="rounded-[24px] border border-slate-200/80 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-slate-800">No clinical chart records found</p>
            <p className="mt-1 text-xs text-slate-500">
              Clinical records and X-rays will be visible once recorded by your dentist during your visit.
            </p>
          </div>
        )}
      </div>
    );
  }

  const renderArchRow = (teeth: number[], label: string) => (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-500">{label}</p>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-16">
        {teeth.map((num) => {
          const rec = latestConditionByTooth.get(num);
          const meta = rec
            ? TOOTH_CONDITION_META[rec.condition] ?? TOOTH_CONDITION_META.sound
            : TOOTH_CONDITION_META.sound;
          const isSelected = selectedTooth === num;
          return (
            <button
              key={num}
              type="button"
              onClick={() => setSelectedTooth(isSelected ? null : num)}
              title={`Tooth #${num}: ${meta.label}`}
              className={cn(
                "flex h-10 flex-col items-center justify-center rounded-xl border text-xs font-semibold tabular-nums transition-all cursor-pointer",
                meta.fillClass,
                isSelected && "ring-2 ring-[#6C5CE7] scale-105"
              )}
            >
              <span>{num}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* 6-Month Hygiene Recall Status */}
      <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200/80 bg-[#EEF7FD]/70 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#6C5CE7]">
            <CalendarCheck2 className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-heading text-base font-bold text-slate-950">
              6-Month Hygiene Recall · {summary.clinicName}
            </p>
            <p className="mt-0.5 text-sm text-slate-700">
              {summary.nextRecallDate
                ? `Next routine cleaning recommended by ${summary.nextRecallDate}${
                    summary.lastCleaningDate
                      ? ` (last cleaning: ${summary.lastCleaningDate})`
                      : ""
                  }.`
                : "Your 6-month hygiene recall date will automatically appear here after your next Oral Prophylaxis visit."}
            </p>
          </div>
        </div>

        {summary.clinicSlug ? (
          <Link
            href={`/c/${summary.clinicSlug}`}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-slate-950 px-5 text-xs font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
          >
            <span>Schedule Cleaning</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {/* Read-Only 32-Tooth Odontogram Snapshot */}
      <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Smile className="size-4 text-[#6C5CE7]" aria-hidden="true" />
            <h2 className="font-heading text-base font-bold text-slate-950">
              32-Tooth Dental Chart (Read-Only)
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500">
            {summary.toothRecords.length} charted entry
            {summary.toothRecords.length === 1 ? "" : " entries"}
          </span>
        </div>

        <p className="mt-1 text-xs text-slate-600">
          Tap any numbered tooth (Universal Numbering 1–32) to inspect clinical
          entries recorded by your dentist at {summary.clinicName}.
        </p>

        <div className="mt-5 space-y-4">
          {renderArchRow(UPPER_ARCH, "Upper Arch (Teeth 1–16)")}
          {renderArchRow(LOWER_ARCH, "Lower Arch (Teeth 32–17)")}
        </div>

        {/* Selected Tooth Inspector */}
        {selectedTooth !== null ? (
          <div className="mt-5 rounded-2xl bg-[#F7FAFD] p-4">
            <div className="flex items-center justify-between">
              <p className="font-heading text-sm font-bold text-slate-950">
                Tooth #{selectedTooth} History
              </p>
              <button
                type="button"
                onClick={() => setSelectedTooth(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Close
              </button>
            </div>
            {selectedToothHistory.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-600">
                No treatment or condition notes recorded for Tooth #
                {selectedTooth} at this clinic.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {selectedToothHistory.map((rec) => {
                  const meta =
                    TOOTH_CONDITION_META[rec.condition] ??
                    TOOTH_CONDITION_META.sound;
                  return (
                    <div
                      key={rec._id}
                      className="rounded-xl bg-white p-3 text-xs border border-slate-200/70"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 font-semibold",
                              meta.badgeClass
                            )}
                          >
                            {meta.label}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 capitalize">
                            {rec.treatmentStatus}
                          </span>
                          <span className="text-slate-500">
                            Surface: {rec.surface}
                          </span>
                        </div>
                        <span className="text-slate-500">
                          {formatDate(rec.updatedAt)} ·{" "}
                          {rec.recordedByDentistName}
                        </span>
                      </div>
                      {rec.notes ? (
                        <p className="mt-1.5 text-slate-700">{rec.notes}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Bottom 2-Column Row: Aftercare Notes & X-Rays/Photos */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Post-Visit Instructions */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <ClipboardList
              className="size-4 text-[#6C5CE7]"
              aria-hidden="true"
            />
            <h3 className="font-heading text-base font-bold text-slate-950">
              Post-Visit Care Instructions
            </h3>
          </div>
          {aftercareNotes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Aftercare guidance written by your dentist after completed
              procedures will be archived here for easy reference.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {aftercareNotes.map((appt) => (
                <div
                  key={appt._id}
                  className="rounded-2xl bg-[#F7FAFD] p-3.5 text-xs"
                >
                  <p className="font-heading text-sm font-bold text-slate-950">
                    {appt.serviceName}
                  </p>
                  <p className="text-slate-500">
                    {formatDate(appt.startTimeUtc)} · {appt.dentistName}
                  </p>
                  <p className="mt-2 leading-relaxed text-slate-700">
                    {appt.postVisitInstructions}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* X-Rays & Intraoral Photos */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileImage className="size-4 text-[#6C5CE7]" aria-hidden="true" />
              <h3 className="font-heading text-base font-bold text-slate-950">
                X-Rays &amp; Clinical Photos
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              {summary.clinicalFiles.length} file
              {summary.clinicalFiles.length === 1 ? "" : "s"}
            </span>
          </div>

          {summary.clinicalFiles.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Periapical X-rays, panoramic scans, and before-and-after photos
              uploaded by your dentist will appear securely here.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summary.clinicalFiles.map((file) => (
                <button
                  key={file._id}
                  type="button"
                  disabled={!file.url}
                  onClick={() => {
                    if (file.url) {
                      setLightboxFile({
                        fileName: file.fileName,
                        fileType:
                          FILE_TYPE_LABEL[file.fileType] ?? file.fileType,
                        url: file.url,
                      });
                    }
                  }}
                  className="group overflow-hidden rounded-2xl border border-slate-200/80 bg-[#F7FAFD] text-left transition-colors hover:border-[#6C5CE7]/40 cursor-pointer"
                >
                  {file.url ? (
                    <div className="relative h-28 w-full overflow-hidden bg-slate-900">
                      {/* Signed Convex storage URLs are dynamic, so native img is ideal */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={file.url}
                        alt={file.fileName}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  ) : null}
                  <div className="p-3">
                    <p className="truncate text-xs font-bold text-slate-950">
                      {FILE_TYPE_LABEL[file.fileType] ?? file.fileType}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {formatDate(file.createdAt)} ·{" "}
                      {formatBytes(file.sizeBytes)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* X-Ray Lightbox Preview */}
      <Dialog
        open={lightboxFile !== null}
        onOpenChange={(open) => {
          if (!open) setLightboxFile(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="font-heading text-base font-bold">
              {lightboxFile?.fileType} — {lightboxFile?.fileName}
            </DialogTitle>
          </DialogHeader>
          {lightboxFile ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl bg-slate-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lightboxFile.url}
                  alt={lightboxFile.fileName}
                  className="max-h-[65vh] w-full object-contain"
                />
              </div>
              <div className="flex justify-end">
                <a
                  href={lightboxFile.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-[#6C5CE7]"
                >
                  <span>Open Full Image</span>
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RecordsView({ data }: RecordsViewProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<
    Id<"patients"> | null
  >(data.profiles[0]?._id ?? null);

  const activeProfileId =
    selectedProfileId &&
    data.profiles.some((p) => p._id === selectedProfileId)
      ? selectedProfileId
      : (data.profiles[0]?._id ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950">
            Dental Records &amp; Recalls
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review your clinic-isolated 32-tooth chart history, 6-month hygiene
            recall schedule, post-visit notes, and uploaded X-rays.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 py-1.5 text-xs font-semibold text-slate-700">
          <ShieldCheck className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
          <span>Private owner-only view</span>
        </span>
      </div>

      {data.profiles.length === 0 || !activeProfileId ? (
        <div className="rounded-[24px] border border-slate-200/80 bg-white px-6 py-12 text-center">
          <h2 className="font-heading text-base font-bold text-slate-950">
            No clinical records yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
            Once you book a visit at a Smile dental clinic, your 32-tooth chart,
            6-month cleaning recall dates, and X-rays will securely appear here.
          </p>
          <Link
            href="/clinics"
            className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
          >
            <span>Find a Dental Clinic</span>
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          {/* Profile Selector Pills */}
          {data.profiles.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {data.profiles.map((profile) => {
                const active = profile._id === activeProfileId;
                return (
                  <button
                    key={profile._id}
                    type="button"
                    onClick={() => setSelectedProfileId(profile._id)}
                    className={cn(
                      "rounded-full px-4 py-2 text-xs font-semibold transition-colors cursor-pointer",
                      active
                        ? "bg-slate-950 text-white"
                        : "bg-white border border-slate-200 text-slate-700 hover:bg-[#F5F7FA]"
                    )}
                  >
                    {profile.firstName} {profile.lastName} ·{" "}
                    {profile.clinicName}
                  </button>
                );
              })}
            </div>
          ) : null}

          <ProfileClinicalRecords patientId={activeProfileId} data={data} />
        </>
      )}
    </div>
  );
}
