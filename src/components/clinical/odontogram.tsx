"use client";

import { useMutation } from "convex/react";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime, getErrorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type ToothSurface =
  | "Mesial"
  | "Distal"
  | "Occlusal"
  | "Buccal"
  | "Lingual"
  | "WholeTooth";

export type ToothCondition =
  | "sound"
  | "caries"
  | "composite_filling"
  | "amalgam_filling"
  | "crown"
  | "root_canal"
  | "extraction_needed"
  | "missing"
  | "implant";

export type TreatmentStatus = "existing" | "planned" | "completed";

export type ToothRecordEntry = {
  _id: Id<"toothRecords">;
  toothNumber: number;
  surface?: ToothSurface;
  condition: ToothCondition;
  treatmentStatus: TreatmentStatus;
  notes?: string;
  recordedByDentistName: string;
  updatedAt: number;
};

const CONDITION_META: Record<
  ToothCondition,
  { label: string; fill: string; swatchClass: string }
> = {
  sound: {
    label: "Sound / Healthy",
    fill: "#ffffff",
    swatchClass: "bg-white border border-border",
  },
  caries: {
    label: "Caries / Decay",
    fill: "#dc2626",
    swatchClass: "bg-red-600",
  },
  composite_filling: {
    label: "Composite Filling",
    fill: "#2563eb",
    swatchClass: "bg-blue-600",
  },
  amalgam_filling: {
    label: "Amalgam Filling",
    fill: "#475569",
    swatchClass: "bg-slate-600",
  },
  crown: {
    label: "Crown",
    fill: "#d97706",
    swatchClass: "bg-amber-600",
  },
  root_canal: {
    label: "Root Canal",
    fill: "#6c5ce7",
    swatchClass: "bg-[#6C5CE7]",
  },
  extraction_needed: {
    label: "Extraction Needed",
    fill: "#fecaca",
    swatchClass: "bg-rose-200 border border-rose-600",
  },
  missing: {
    label: "Missing",
    fill: "#e2e8f0",
    swatchClass: "bg-slate-200 border border-slate-400",
  },
  implant: {
    label: "Implant",
    fill: "#0d9488",
    swatchClass: "bg-teal-600",
  },
};

const UPPER_ARCH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
// Lower arch displayed visually from patient's lower-right (#32) to lower-left (#17)
const LOWER_ARCH = [
  32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
];

type ToothVisualState = {
  wholeCondition?: ToothCondition;
  wholeStatus?: TreatmentStatus;
  surfaces: Partial<Record<Exclude<ToothSurface, "WholeTooth">, ToothCondition>>;
  surfaceStatuses: Partial<
    Record<Exclude<ToothSurface, "WholeTooth">, TreatmentStatus>
  >;
};

const WHOLE_TOOTH_OVERRIDING_CONDITIONS = new Set<ToothCondition>([
  "sound",
  "missing",
  "extraction_needed",
  "crown",
  "implant",
]);

function ToothSvg({
  toothNumber,
  isUpper,
  state,
  isSelected,
  selectedSurface,
  onSelect,
}: {
  toothNumber: number;
  isUpper: boolean;
  state: ToothVisualState;
  isSelected: boolean;
  selectedSurface: ToothSurface | null;
  onSelect: (toothNumber: number, surface: ToothSurface) => void;
}) {
  // Determine midline direction so Mesial always faces the arch center (between 8/9 and 24/25)
  const isPatientRightSide = isUpper ? toothNumber <= 8 : toothNumber >= 25;
  const leftSurface: Exclude<ToothSurface, "WholeTooth"> = isPatientRightSide
    ? "Distal"
    : "Mesial";
  const rightSurface: Exclude<ToothSurface, "WholeTooth"> = isPatientRightSide
    ? "Mesial"
    : "Distal";
  const topSurface: Exclude<ToothSurface, "WholeTooth"> = isUpper
    ? "Buccal"
    : "Lingual";
  const bottomSurface: Exclude<ToothSurface, "WholeTooth"> = isUpper
    ? "Lingual"
    : "Buccal";

  const whole = state.wholeCondition;
  const isMissing = whole === "missing";
  const needsExtraction = whole === "extraction_needed";
  const hasPlannedTreatment =
    state.wholeStatus === "planned" ||
    Object.values(state.surfaceStatuses).some((st) => st === "planned");

  const fillFor = (surface: Exclude<ToothSurface, "WholeTooth">): string => {
    const surfaceCond = state.surfaces[surface];
    if (surfaceCond) return CONDITION_META[surfaceCond].fill;
    if (whole) return CONDITION_META[whole].fill;
    return "#ffffff";
  };

  const strokeFor = (surface: Exclude<ToothSurface, "WholeTooth">): string =>
    isSelected && selectedSurface === surface ? "#0284c7" : "#64748b";

  const handleSurfaceKeyDown = (
    e: React.KeyboardEvent,
    targetSurface: ToothSurface
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(toothNumber, targetSurface);
    }
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      {isUpper ? (
        <button
          type="button"
          onClick={() => onSelect(toothNumber, "WholeTooth")}
          title={`Select Whole Tooth #${toothNumber}`}
          className={`rounded px-1 font-mono text-[10px] font-medium transition-colors hover:bg-accent ${
            isSelected && selectedSurface === "WholeTooth"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
              : "text-muted-foreground"
          }`}
        >
          {toothNumber}
        </button>
      ) : null}

      <svg
        viewBox="0 0 40 40"
        className={`size-9 cursor-pointer transition-transform hover:scale-105 sm:size-10 ${
          isMissing ? "opacity-45" : ""
        } ${isSelected ? "drop-shadow-sm ring-2 ring-sky-500 rounded-md" : ""}`}
        role="group"
        aria-label={`Tooth ${toothNumber}${hasPlannedTreatment ? " (planned treatment)" : ""}`}
      >
        {/* Top trapezoid (Buccal on upper, Lingual on lower) */}
        <polygon
          points="2,2 38,2 28,12 12,12"
          fill={fillFor(topSurface)}
          stroke={strokeFor(topSurface)}
          strokeWidth={isSelected && selectedSurface === topSurface ? 2 : 1}
          role="button"
          tabIndex={0}
          aria-label={`Tooth ${toothNumber} ${topSurface} surface`}
          onClick={() => onSelect(toothNumber, topSurface)}
          onKeyDown={(e) => handleSurfaceKeyDown(e, topSurface)}
        >
          <title>{`Tooth #${toothNumber} — ${topSurface}`}</title>
        </polygon>

        {/* Bottom trapezoid (Lingual on upper, Buccal on lower) */}
        <polygon
          points="12,28 28,28 38,38 2,38"
          fill={fillFor(bottomSurface)}
          stroke={strokeFor(bottomSurface)}
          strokeWidth={isSelected && selectedSurface === bottomSurface ? 2 : 1}
          role="button"
          tabIndex={0}
          aria-label={`Tooth ${toothNumber} ${bottomSurface} surface`}
          onClick={() => onSelect(toothNumber, bottomSurface)}
          onKeyDown={(e) => handleSurfaceKeyDown(e, bottomSurface)}
        >
          <title>{`Tooth #${toothNumber} — ${bottomSurface}`}</title>
        </polygon>

        {/* Left trapezoid */}
        <polygon
          points="2,2 12,12 12,28 2,38"
          fill={fillFor(leftSurface)}
          stroke={strokeFor(leftSurface)}
          strokeWidth={isSelected && selectedSurface === leftSurface ? 2 : 1}
          role="button"
          tabIndex={0}
          aria-label={`Tooth ${toothNumber} ${leftSurface} surface`}
          onClick={() => onSelect(toothNumber, leftSurface)}
          onKeyDown={(e) => handleSurfaceKeyDown(e, leftSurface)}
        >
          <title>{`Tooth #${toothNumber} — ${leftSurface}`}</title>
        </polygon>

        {/* Right trapezoid */}
        <polygon
          points="38,2 38,38 28,28 28,12"
          fill={fillFor(rightSurface)}
          stroke={strokeFor(rightSurface)}
          strokeWidth={isSelected && selectedSurface === rightSurface ? 2 : 1}
          role="button"
          tabIndex={0}
          aria-label={`Tooth ${toothNumber} ${rightSurface} surface`}
          onClick={() => onSelect(toothNumber, rightSurface)}
          onKeyDown={(e) => handleSurfaceKeyDown(e, rightSurface)}
        >
          <title>{`Tooth #${toothNumber} — ${rightSurface}`}</title>
        </polygon>

        {/* Center Occlusal square */}
        <rect
          x="12"
          y="12"
          width="16"
          height="16"
          fill={fillFor("Occlusal")}
          stroke={strokeFor("Occlusal")}
          strokeWidth={isSelected && selectedSurface === "Occlusal" ? 2 : 1}
          role="button"
          tabIndex={0}
          aria-label={`Tooth ${toothNumber} Occlusal surface`}
          onClick={() => onSelect(toothNumber, "Occlusal")}
          onKeyDown={(e) => handleSurfaceKeyDown(e, "Occlusal")}
        >
          <title>{`Tooth #${toothNumber} — Occlusal`}</title>
        </rect>

        {/* Extraction Needed cross-hatch overlay */}
        {needsExtraction ? (
          <g stroke="#b91c1c" strokeWidth="2.2" pointerEvents="none">
            <line x1="5" y1="5" x2="35" y2="35" />
            <line x1="35" y1="5" x2="5" y2="35" />
          </g>
        ) : null}

        {/* Missing tooth X indicator */}
        {isMissing ? (
          <g stroke="#475569" strokeWidth="1.5" strokeDasharray="3 2" pointerEvents="none">
            <line x1="6" y1="6" x2="34" y2="34" />
            <line x1="34" y1="6" x2="6" y2="34" />
          </g>
        ) : null}

        {/* Planned treatment indicator dot */}
        {hasPlannedTreatment ? (
          <circle
            cx="34"
            cy="6"
            r="3.5"
            fill="#f59e0b"
            stroke="#ffffff"
            strokeWidth="1.2"
            pointerEvents="none"
          >
            <title>Planned treatment pending</title>
          </circle>
        ) : null}
      </svg>

      {!isUpper ? (
        <button
          type="button"
          onClick={() => onSelect(toothNumber, "WholeTooth")}
          title={`Select Whole Tooth #${toothNumber}`}
          className={`rounded px-1 font-mono text-[10px] font-medium transition-colors hover:bg-accent ${
            isSelected && selectedSurface === "WholeTooth"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
              : "text-muted-foreground"
          }`}
        >
          {toothNumber}
        </button>
      ) : null}
    </div>
  );
}

type MobileQuadrant = "all" | "ur" | "ul" | "lr" | "ll";

const QUADRANT_TABS: { id: MobileQuadrant; label: string }[] = [
  { id: "all", label: "Full Arch" },
  { id: "ur", label: "UR 1–8" },
  { id: "ul", label: "UL 9–16" },
  { id: "lr", label: "LR 32–25" },
  { id: "ll", label: "LL 24–17" },
];

export function Odontogram({
  patientId,
  appointmentId,
  dentistId,
  records,
  enabled,
  isReadOnly,
}: {
  patientId: Id<"patients">;
  appointmentId?: Id<"appointments">;
  dentistId?: Id<"dentists">;
  records: ToothRecordEntry[];
  enabled: boolean;
  isReadOnly: boolean;
}) {
  const recordToothCondition = useMutation(api.odontogram.recordToothCondition);

  const [selectedTooth, setSelectedTooth] = useState<number>(14);
  const [surface, setSurface] = useState<ToothSurface>("Occlusal");
  const [condition, setCondition] = useState<ToothCondition>("caries");
  const [treatmentStatus, setTreatmentStatus] =
    useState<TreatmentStatus>("existing");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileQuadrant, setMobileQuadrant] = useState<MobileQuadrant>("all");

  // Build latest state map per tooth (records are sorted newest-first)
  const toothStateMap = useMemo(() => {
    const map = new Map<number, ToothVisualState>();
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      const current = map.get(rec.toothNumber) ?? {
        surfaces: {},
        surfaceStatuses: {},
      };
      const surf = rec.surface ?? "WholeTooth";
      if (surf === "WholeTooth") {
        current.wholeCondition = rec.condition;
        current.wholeStatus = rec.treatmentStatus;
        if (WHOLE_TOOTH_OVERRIDING_CONDITIONS.has(rec.condition)) {
          current.surfaces = {};
          current.surfaceStatuses = {};
        }
      } else {
        current.surfaces = {
          ...current.surfaces,
          [surf]: rec.condition,
        };
        current.surfaceStatuses = {
          ...current.surfaceStatuses,
          [surf]: rec.treatmentStatus,
        };
      }
      map.set(rec.toothNumber, current);
    }
    return map;
  }, [records]);

  const handleSelectSurface = (toothNum: number, clickedSurface: ToothSurface) => {
    setSelectedTooth(toothNum);
    setSurface(clickedSurface);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await recordToothCondition({
        patientId,
        toothNumber: selectedTooth,
        surface,
        condition,
        treatmentStatus,
        notes: notes.trim() || undefined,
        appointmentId,
        dentistId,
      });
      toast.success(
        `Saved Tooth #${selectedTooth} (${surface}) — ${CONDITION_META[condition].label}.`
      );
      setNotes("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update odontogram."));
    } finally {
      setSaving(false);
    }
  };

  const selectedToothHistory = records.filter(
    (r) => r.toothNumber === selectedTooth
  );

  if (!enabled) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-6 py-12 text-center text-sm text-slate-500">
        <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Lock className="size-5" />
        </div>
        <p className="mt-1 font-semibold text-slate-900">
          Interactive 32-Tooth Odontogram is disabled on this clinic&apos;s
          plan.
        </p>
        <p className="text-xs text-slate-500">
          Upgrade to enable full surface charting and tooth history tracking.
        </p>
      </section>
    );
  }

  const mobileTeethForQuadrant =
    mobileQuadrant === "ur"
      ? { teeth: UPPER_ARCH.slice(0, 8), isUpper: true, heading: "Upper Right (1–8)" }
      : mobileQuadrant === "ul"
        ? { teeth: UPPER_ARCH.slice(8, 16), isUpper: true, heading: "Upper Left (9–16)" }
        : mobileQuadrant === "lr"
          ? { teeth: LOWER_ARCH.slice(0, 8), isUpper: false, heading: "Lower Right (32–25)" }
          : mobileQuadrant === "ll"
            ? { teeth: LOWER_ARCH.slice(8, 16), isUpper: false, heading: "Lower Left (24–17)" }
            : null;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Interactive 32-Tooth SVG Odontogram
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Universal Numbering System (#1–#32). Click any surface (Mesial,
              Distal, Occlusal, Buccal, Lingual) to record a finding.
            </p>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-[#6C5CE7]/25 bg-[#F1EEFF] px-3 py-1 font-mono text-xs font-semibold text-[#4F3EC7]"
          >
            Tooth #{selectedTooth} · {surface}
          </Badge>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* Mobile-Only Quadrant Quick-Zoom Pills */}
          <div className="flex flex-wrap items-center gap-1.5 md:hidden">
            {QUADRANT_TABS.map((q) => {
              const active = mobileQuadrant === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setMobileQuadrant(q.id)}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "border-[#6C5CE7] bg-[#6C5CE7] text-white"
                      : "border-slate-200 bg-[#F8FAFC] text-slate-700 hover:border-slate-300"
                  )}
                >
                  {q.label}
                </button>
              );
            })}
          </div>

          {/* Mobile Zoomed 8-Tooth Quadrant View */}
          {mobileTeethForQuadrant ? (
            <div className="space-y-2.5 md:hidden">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>{mobileTeethForQuadrant.heading}</span>
                <span>Tap a surface to chart</span>
              </div>
              <div className="grid grid-cols-4 gap-2.5 rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3">
                {mobileTeethForQuadrant.teeth.map((num) => (
                  <ToothSvg
                    key={num}
                    toothNumber={num}
                    isUpper={mobileTeethForQuadrant.isUpper}
                    state={
                      toothStateMap.get(num) ?? {
                        surfaces: {},
                        surfaceStatuses: {},
                      }
                    }
                    isSelected={selectedTooth === num}
                    selectedSurface={surface}
                    onSelect={handleSelectSurface}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Full 32-Tooth Dual-Arch View (Always shown on md+, or on mobile when 'Full Arch' is active) */}
          <div
            className={cn(
              "space-y-5",
              mobileTeethForQuadrant ? "hidden md:block" : "block"
            )}
          >
            {/* Upper Arch (1-16) */}
            <div className="space-y-2 overflow-x-auto pb-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                <span>Upper Right (1–8)</span>
                <span>Upper Left (9–16)</span>
              </div>
              <div className="grid min-w-[660px] grid-cols-16 gap-1">
                {UPPER_ARCH.map((num) => (
                  <ToothSvg
                    key={num}
                    toothNumber={num}
                    isUpper
                    state={
                      toothStateMap.get(num) ?? {
                        surfaces: {},
                        surfaceStatuses: {},
                      }
                    }
                    isSelected={selectedTooth === num}
                    selectedSurface={surface}
                    onSelect={handleSelectSurface}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-dashed border-slate-200" />

            {/* Lower Arch (32-17) */}
            <div className="space-y-2 overflow-x-auto pb-1">
              <div className="grid min-w-[660px] grid-cols-16 gap-1">
                {LOWER_ARCH.map((num) => (
                  <ToothSvg
                    key={num}
                    toothNumber={num}
                    isUpper={false}
                    state={
                      toothStateMap.get(num) ?? {
                        surfaces: {},
                        surfaceStatuses: {},
                      }
                    }
                    isSelected={selectedTooth === num}
                    selectedSurface={surface}
                    onSelect={handleSelectSurface}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                <span>Lower Right (32–25)</span>
                <span>Lower Left (24–17)</span>
              </div>
            </div>
          </div>

          {/* Color Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3.5 text-xs text-slate-600">
            {(Object.keys(CONDITION_META) as ToothCondition[]).map((key) => (
              <div key={key} className="flex items-center gap-1.5">
                <span
                  className={`size-3 rounded-[3px] ${CONDITION_META[key].swatchClass}`}
                />
                <span>{CONDITION_META[key].label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500 ring-1 ring-amber-600/30" />
              <span>Planned Treatment</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tooth Condition Recorder + Selected Tooth History */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-950">
              Record Finding — Tooth #{selectedTooth}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Saves an immutable clinical entry and updates the SVG arch in real
              time.
            </p>
          </div>
          <div className="p-5">
            <form onSubmit={handleSave} className="space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Surface
                  </Label>
                  <Select
                    disabled={isReadOnly}
                    value={surface}
                    onValueChange={(v) => {
                      if (v) setSurface(v as ToothSurface);
                    }}
                  >
                    <SelectTrigger className="w-full rounded-xl border-slate-200/90">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Occlusal">Occlusal</SelectItem>
                      <SelectItem value="Mesial">Mesial</SelectItem>
                      <SelectItem value="Distal">Distal</SelectItem>
                      <SelectItem value="Buccal">Buccal</SelectItem>
                      <SelectItem value="Lingual">Lingual</SelectItem>
                      <SelectItem value="WholeTooth">Whole Tooth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Treatment Status
                  </Label>
                  <Select
                    disabled={isReadOnly}
                    value={treatmentStatus}
                    onValueChange={(v) => {
                      if (
                        v === "existing" ||
                        v === "planned" ||
                        v === "completed"
                      ) {
                        setTreatmentStatus(v);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full rounded-xl border-slate-200/90">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">Existing</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Condition
                </Label>
                <Select
                  disabled={isReadOnly}
                  value={condition}
                  onValueChange={(v) => {
                    if (v) setCondition(v as ToothCondition);
                  }}
                >
                  <SelectTrigger className="w-full rounded-xl border-slate-200/90">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONDITION_META) as ToothCondition[]).map(
                      (c) => (
                        <SelectItem key={c} value={c}>
                          {CONDITION_META[c].label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="tooth-notes"
                  className="text-xs font-semibold text-slate-700"
                >
                  Clinical Notes (optional)
                </Label>
                <Input
                  id="tooth-notes"
                  disabled={isReadOnly}
                  placeholder="e.g., Class I occlusal caries; composite planned"
                  className="rounded-xl border-slate-200/90"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                disabled={isReadOnly || saving}
                className="h-10 w-full rounded-full bg-[#6C5CE7] text-xs font-semibold text-white hover:bg-[#5B4BD6]"
              >
                {saving
                  ? "Saving to Chart…"
                  : `Save Tooth #${selectedTooth} (${surface})`}
              </Button>
            </form>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-950">
              Tooth #{selectedTooth} History ({selectedToothHistory.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Timestamped clinical audit log for this tooth.
            </p>
          </div>
          <div className="p-5">
            {selectedToothHistory.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-10 text-center text-xs text-slate-500">
                No clinical findings recorded for Tooth #{selectedTooth} yet.
              </div>
            ) : (
              <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                {selectedToothHistory.map((entry) => (
                  <div
                    key={entry._id}
                    className="rounded-xl border border-slate-200/85 bg-[#F8FAFC]/70 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                        <span
                          className={`size-2.5 rounded-xs ${CONDITION_META[entry.condition].swatchClass}`}
                        />
                        <span>{CONDITION_META[entry.condition].label}</span>
                        <Badge
                          variant="outline"
                          className="rounded-full bg-white text-[10px]"
                        >
                          {entry.surface ?? "WholeTooth"}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="rounded-full text-[10px] capitalize"
                        >
                          {entry.treatmentStatus}
                        </Badge>
                      </div>
                      <span className="tabular-nums text-[11px] text-slate-500">
                        {formatDateTime(entry.updatedAt)}
                      </span>
                    </div>
                    {entry.notes ? (
                      <p className="mt-1.5 text-slate-700">{entry.notes}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-500">
                      By {entry.recordedByDentistName}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
