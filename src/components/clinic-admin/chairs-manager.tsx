"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Armchair, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getErrorCode, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const PRESET_CHAIR_TAGS = [
  "General",
  "Surgery",
  "X-Ray",
  "Orthodontics",
  "Endodontics",
  "Pediatric",
] as const;

const chairSchema = z.object({
  name: z.string().min(2, "Chair name is required"),
  roomCode: z.string().min(1, "Room code is required"),
  tags: z.array(z.string()).min(1, "Select at least one capability tag"),
});

type ChairFormValues = z.infer<typeof chairSchema>;

export function ChairsManager() {
  const { overrideClinicId, isReadOnly } = useClinicAdminContext();
  const workspace = useQuery(api.clinicAdmin.getClinicWorkspace, {
    overrideClinicId,
  });
  const chairs = useQuery(api.clinicAdmin.listChairs, { overrideClinicId });

  const createChair = useMutation(api.clinicAdmin.createChair);
  const updateChair = useMutation(api.clinicAdmin.updateChair);
  const toggleChairActive = useMutation(api.clinicAdmin.toggleChairActive);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChair, setEditingChair] = useState<Doc<"chairs"> | null>(null);
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);

  const form = useForm<ChairFormValues>({
    resolver: zodResolver(chairSchema),
    defaultValues: {
      name: "",
      roomCode: "OP-1",
      tags: ["General"],
    },
  });

  const selectedTags = useWatch({ control: form.control, name: "tags" }) ?? [];

  const openCreate = () => {
    setEditingChair(null);
    const nextNum = (chairs?.length ?? 0) + 1;
    form.reset({
      name: `Operatory Chair ${nextNum}`,
      roomCode: `OP-${nextNum}`,
      tags: ["General"],
    });
    setDialogOpen(true);
  };

  const openEdit = (chair: Doc<"chairs">) => {
    setEditingChair(chair);
    form.reset({
      name: chair.name,
      roomCode: chair.roomCode,
      tags:
        chair.supportedCategoryTags.length > 0
          ? chair.supportedCategoryTags
          : ["General"],
    });
    setDialogOpen(true);
  };

  const toggleTag = (tag: string) => {
    const exists = selectedTags.includes(tag);
    const next = exists
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    form.setValue("tags", next, { shouldValidate: true });
  };

  const onSubmit = async (values: ChairFormValues) => {
    try {
      if (editingChair) {
        await updateChair({
          chairId: editingChair._id,
          name: values.name,
          roomCode: values.roomCode,
          supportedCategoryTags: values.tags,
        });
        toast.success(`Updated ${values.name}.`);
      } else {
        await createChair({
          name: values.name,
          roomCode: values.roomCode,
          supportedCategoryTags: values.tags,
        });
        setQuotaBanner(null);
        toast.success(`Added ${values.name}.`);
      }
      setDialogOpen(false);
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to save operatory chair.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBanner(msg);
      }
      toast.error(msg);
    }
  };

  const handleToggleActive = async (chairId: Id<"chairs">, isActive: boolean) => {
    try {
      await toggleChairActive({ chairId, isActive });
      setQuotaBanner(null);
      toast.success(isActive ? "Chair activated." : "Chair deactivated.");
    } catch (err) {
      const msg = getErrorMessage(err, "Could not update chair status.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBanner(msg);
      }
      toast.error(msg);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Operatory Chairs
            </h1>
            {workspace?.plan ? (
              <Badge variant="outline" className="font-mono">
                {workspace.clinic.activeChairCount}/{workspace.plan.maxChairs}{" "}
                active ({workspace.plan.name})
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Define physical dental chairs and equipment tags for conflict-free
            dual-resource scheduling.
          </p>
        </div>

        <Button disabled={isReadOnly} onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          Add Operatory Chair
        </Button>
      </div>

      {quotaBanner ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Plan Chair Quota Reached</AlertTitle>
          <AlertDescription>{quotaBanner}</AlertDescription>
        </Alert>
      ) : null}

      {chairs === undefined ? (
        <p className="text-sm text-muted-foreground">Loading chairs…</p>
      ) : chairs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Armchair className="size-6 opacity-50" />
            <p>
              No operatory chairs yet. Add at least one dental chair so patients
              can book available slots.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chairs.map((chair) => (
            <Card
              key={chair._id}
              className={chair.isActive ? undefined : "opacity-65"}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {chair.roomCode}
                  </Badge>
                  <CardTitle className="mt-2 text-base">{chair.name}</CardTitle>
                  <CardDescription>
                    {chair.isActive ? "Available for booking" : "Inactive"}
                  </CardDescription>
                </div>
                <Switch
                  disabled={isReadOnly}
                  checked={chair.isActive}
                  onCheckedChange={(checked) =>
                    handleToggleActive(chair._id, checked)
                  }
                />
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {chair.supportedCategoryTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={isReadOnly}
                  onClick={() => openEdit(chair)}
                >
                  <Pencil className="mr-1.5 size-3.5" />
                  Edit Chair
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingChair ? "Edit Operatory Chair" : "Add Operatory Chair"}
            </DialogTitle>
            <DialogDescription>
              Services with a required chair tag (e.g., <code>Surgery</code>)
              only schedule onto chairs with matching equipment tags.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="chair-name">Chair Name</Label>
                <Input
                  id="chair-name"
                  placeholder="Operatory Chair 1 (Surgical)"
                  {...form.register("name")}
                />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chair-room">Room Code</Label>
                <Input
                  id="chair-room"
                  placeholder="OP-1"
                  className="font-mono uppercase"
                  {...form.register("roomCode")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Supported Equipment & Procedure Tags</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_CHAIR_TAGS.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <Button
                      key={tag}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Button>
                  );
                })}
              </div>
              {form.formState.errors.tags ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.tags.message}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save Chair"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
