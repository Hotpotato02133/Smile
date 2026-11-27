"use client";

import { useMutation, useQuery } from "@/lib/api";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/lib/format";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

export function AddWaitlistDialog({
  defaultDateKey,
  dentists,
  services,
  disabled,
  overrideClinicId,
}: {
  defaultDateKey: string;
  dentists: { _id: Id<"dentists">; displayName: string }[];
  services: { _id: Id<"services">; name: string }[];
  disabled: boolean;
  overrideClinicId?: Id<"clinics">;
}) {
  const [open, setOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState<Id<"patients"> | null>(null);
  const [serviceId, setServiceId] = useState<string>(services[0]?._id ?? "");
  const [dentistId, setDentistId] = useState<string>("any");
  const [preferredDateKey, setPreferredDateKey] = useState(defaultDateKey);
  const [preferredTimeWindow, setPreferredTimeWindow] = useState<
    "morning" | "afternoon" | "any"
  >("any");
  const [submitting, setSubmitting] = useState(false);

  const matchingPatients = useQuery(
    api.appointments.searchClinicPatients,
    open
      ? { search: patientSearch.trim() || undefined, overrideClinicId }
      : "skip"
  );

  const addWaitlistEntry = useMutation(api.appointments.addWaitlistEntry);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setPatientId(null);
      setPatientSearch("");
      setServiceId(services[0]?._id ?? "");
      setDentistId("any");
      setPreferredDateKey(defaultDateKey);
      setPreferredTimeWindow("any");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId) {
      toast.error("Select a patient first.");
      return;
    }
    if (!serviceId) {
      toast.error("Select a dental procedure.");
      return;
    }
    setSubmitting(true);
    try {
      await addWaitlistEntry({
        patientId,
        serviceId: serviceId as Id<"services">,
        preferredDentistId:
          dentistId === "any" ? undefined : (dentistId as Id<"dentists">),
        preferredDateKey,
        preferredTimeWindow,
      });
      toast.success(`Added patient to standby waitlist for ${preferredDateKey}.`);
      setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not add to waitlist."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" disabled={disabled} />}>
        <Plus className="mr-1.5 size-3.5" />
        Add to Waitlist
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Patient to Standby Waitlist</DialogTitle>
          <DialogDescription>
            Queue an existing clinic patient for cancellation openings on a
            target date.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <Label className="text-xs">Search Clinic Patient</Label>
            <Input
              placeholder="Search by name, phone, or email…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
            />
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {(matchingPatients ?? []).length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No matching patients found.
                </p>
              ) : (
                (matchingPatients ?? []).map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => setPatientId(p._id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                      patientId === p._id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      {p.noShowCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[10px]"
                        >
                          NS×{p.noShowCount}
                        </Badge>
                      ) : null}
                      {!p.email ? (
                        <span className="text-[10px] opacity-75">
                          (phone only)
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono opacity-80">{p.phone}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Procedure</Label>
              <Select
                value={serviceId}
                onValueChange={(v) => {
                  if (v) setServiceId(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose procedure" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Preferred Dentist</Label>
              <Select
                value={dentistId}
                onValueChange={(v) => {
                  if (v) setDentistId(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any Available Dentist</SelectItem>
                  {dentists.map((d) => (
                    <SelectItem key={d._id} value={d._id}>
                      {d.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-date">Target Date</Label>
              <Input
                id="wl-date"
                type="date"
                value={preferredDateKey}
                onChange={(e) => setPreferredDateKey(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Preferred Time Window</Label>
              <Select
                value={preferredTimeWindow}
                onValueChange={(v) => {
                  if (v === "morning" || v === "afternoon" || v === "any") {
                    setPreferredTimeWindow(v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any Time</SelectItem>
                  <SelectItem value="morning">Morning (Before 12 PM)</SelectItem>
                  <SelectItem value="afternoon">Afternoon (12 PM+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add to Waitlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
