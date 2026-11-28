"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import { AlertTriangle, Pencil, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "@/lib/api";
import type { Doc, Id } from "@/lib/api";

const CATEGORIES = [
  "Preventive",
  "Restorative",
  "Cosmetic",
  "Orthodontics",
  "Endodontics",
  "Oral Surgery",
  "Emergency",
] as const;

type ServiceCategory = (typeof CATEGORIES)[number];

const serviceSchema = z.object({
  name: z.string().min(2, "Service name is required"),
  category: z.enum(CATEGORIES),
  description: z.string().min(4, "Short description is required"),
  durationMinutes: z.coerce.number().min(5).max(360),
  bufferMinutes: z.coerce.number().min(0).max(120),
  pricePhp: z.coerce.number().min(0),
  requiresXray: z.boolean(),
  requiredChairTag: z.string().optional(),
});

type ServiceFormInput = z.input<typeof serviceSchema>;
type ServiceFormValues = z.output<typeof serviceSchema>;

export function ServicesManager() {
  const { overrideClinicId, isReadOnly } = useClinicAdminContext();
  const services = useQuery(api.clinicAdmin.listServices, { overrideClinicId });
  const chairs = useQuery(api.clinicAdmin.listChairs, { overrideClinicId });

  const activeChairTags = new Set(
    (chairs ?? [])
      .filter((c) => c.isActive)
      .flatMap((c) => c.supportedCategoryTags.map((t) => t.trim().toLowerCase()))
  );
  const hasChairData = chairs !== undefined;

  const createService = useMutation(api.clinicAdmin.createService);
  const updateService = useMutation(api.clinicAdmin.updateService);
  const toggleServiceActive = useMutation(api.clinicAdmin.toggleServiceActive);
  const seedDefaultServices = useMutation(api.clinicAdmin.seedDefaultServices);

  const [categoryFilter, setCategoryFilter] = useState<"all" | ServiceCategory>(
    "all"
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Doc<"services"> | null>(
    null
  );
  const [seeding, setSeeding] = useState(false);

  const form = useForm<ServiceFormInput, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: "",
      category: "Preventive",
      description: "",
      durationMinutes: 30,
      bufferMinutes: 15,
      pricePhp: 1000,
      requiresXray: false,
      requiredChairTag: "any",
    },
  });

  const watchedCategory = useWatch({ control: form.control, name: "category" });
  const watchedRequiresXray = useWatch({
    control: form.control,
    name: "requiresXray",
  });
  const watchedChairTag = useWatch({
    control: form.control,
    name: "requiredChairTag",
  });

  const openCreate = () => {
    setEditingService(null);
    form.reset({
      name: "",
      category: "Preventive",
      description: "",
      durationMinutes: 30,
      bufferMinutes: 15,
      pricePhp: 1000,
      requiresXray: false,
      requiredChairTag: "any",
    });
    setDialogOpen(true);
  };

  const openEdit = (svc: Doc<"services">) => {
    setEditingService(svc);
    form.reset({
      name: svc.name,
      category: svc.category,
      description: svc.description,
      durationMinutes: svc.durationMinutes,
      bufferMinutes: svc.bufferMinutes,
      pricePhp: svc.pricePhp,
      requiresXray: svc.requiresXray,
      requiredChairTag: svc.requiredChairTag ?? "any",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: ServiceFormValues) => {
    const requiredChairTag =
      values.requiredChairTag && values.requiredChairTag !== "any"
        ? values.requiredChairTag
        : editingService
          ? null
          : undefined;
    try {
      if (editingService) {
        await updateService({
          serviceId: editingService._id,
          name: values.name,
          category: values.category,
          description: values.description,
          durationMinutes: values.durationMinutes,
          bufferMinutes: values.bufferMinutes,
          pricePhp: values.pricePhp,
          requiresXray: values.requiresXray,
          requiredChairTag,
        });
        toast.success(`Updated ${values.name}.`);
      } else {
        await createService({
          name: values.name,
          category: values.category,
          description: values.description,
          durationMinutes: values.durationMinutes,
          bufferMinutes: values.bufferMinutes,
          pricePhp: values.pricePhp,
          requiresXray: values.requiresXray,
          requiredChairTag,
        });
        toast.success(`Added ${values.name} to catalog.`);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save service."));
    }
  };

  const handleToggleActive = async (
    serviceId: Id<"services">,
    isActive: boolean
  ) => {
    try {
      await toggleServiceActive({ serviceId, isActive });
      toast.success(isActive ? "Service enabled." : "Service hidden.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update service."));
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await seedDefaultServices({});
      toast.success(`Added ${res.created} standard dental procedures.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not load default catalog."));
    } finally {
      setSeeding(false);
    }
  };

  const filtered = (services ?? []).filter(
    (s) => categoryFilter === "all" || s.category === categoryFilter
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dental Services Catalog
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure procedure durations, chair sterilization turnover buffers,
            equipment tags, and transparent PHP pricing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={isReadOnly || seeding}
            onClick={handleSeedDefaults}
          >
            <Sparkles className="mr-1.5 size-4" />
            {seeding ? "Loading…" : "Load Default Catalog"}
          </Button>
          <Button disabled={isReadOnly} onClick={openCreate}>
            <Plus className="mr-1.5 size-4" />
            Add Procedure
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <Tabs
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as "all" | ServiceCategory)}
          >
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              {CATEGORIES.map((cat) => (
                <TabsTrigger key={cat} value={cat}>
                  {cat}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <CardTitle className="sr-only">Services table</CardTitle>
          <CardDescription className="sr-only">
            Active and archived clinic dental procedures
          </CardDescription>
        </CardHeader>

        <CardContent>
          {services === undefined ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Loading dental procedures…
            </p>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No dental procedures in this category.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Procedure</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Chair Block</TableHead>
                  <TableHead>Requirements</TableHead>
                  <TableHead className="text-right">Base Price</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((svc) => (
                  <TableRow
                    key={svc._id}
                    className={svc.isActive ? undefined : "opacity-60"}
                  >
                    <TableCell>
                      <div className="font-medium">{svc.name}</div>
                      <div className="max-w-xs truncate text-xs text-muted-foreground">
                        {svc.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{svc.category}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>
                        {svc.durationMinutes}m + {svc.bufferMinutes}m buffer
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {svc.durationMinutes + svc.bufferMinutes}m total block
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {svc.requiredChairTag ? (
                          <>
                            <Badge variant="outline" className="text-[11px]">
                              Chair: {svc.requiredChairTag}
                            </Badge>
                            {hasChairData &&
                            !activeChairTags.has(
                              svc.requiredChairTag.trim().toLowerCase()
                            ) ? (
                              <Badge
                                variant="destructive"
                                className="gap-1 text-[10px]"
                                title="No active operatory chair has this equipment tag — patients will see zero available slots for this procedure."
                              >
                                <AlertTriangle className="size-3" />
                                No matching chair
                              </Badge>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Any chair
                          </span>
                        )}
                        {svc.requiresXray ? (
                          <Badge variant="outline" className="text-[11px]">
                            X-Ray
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {formatPhp(svc.pricePhp)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        disabled={isReadOnly}
                        checked={svc.isActive}
                        onCheckedChange={(checked) =>
                          handleToggleActive(svc._id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isReadOnly}
                        onClick={() => openEdit(svc)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingService ? "Edit Dental Procedure" : "Add Dental Procedure"}
            </DialogTitle>
            <DialogDescription>
              The scheduling engine reserves{" "}
              <code>durationMinutes + bufferMinutes</code> on both dentist and
              chair to allow sterilization turnover.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="svc-name">Procedure Name</Label>
                <Input
                  id="svc-name"
                  placeholder="Oral Prophylaxis (Cleaning)"
                  {...form.register("name")}
                />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={watchedCategory}
                  onValueChange={(v) => {
                    if (v) form.setValue("category", v as ServiceCategory);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-desc">Patient-Facing Description</Label>
              <Input
                id="svc-desc"
                placeholder="Ultrasonic scaling and polishing for plaque removal."
                {...form.register("description")}
              />
              {form.formState.errors.description ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.description.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-dur">Duration (mins)</Label>
                <Input
                  id="svc-dur"
                  type="number"
                  min={5}
                  className="font-mono"
                  {...form.register("durationMinutes")}
                />
                {form.formState.errors.durationMinutes ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.durationMinutes.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-buf">Sterilization Buffer</Label>
                <Input
                  id="svc-buf"
                  type="number"
                  min={0}
                  className="font-mono"
                  {...form.register("bufferMinutes")}
                />
                {form.formState.errors.bufferMinutes ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.bufferMinutes.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-price">Base Price (PHP)</Label>
                <Input
                  id="svc-price"
                  type="number"
                  min={0}
                  className="font-mono"
                  {...form.register("pricePhp")}
                />
                {form.formState.errors.pricePhp ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.pricePhp.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Required Chair Equipment Tag</Label>
                <Select
                  value={watchedChairTag ?? "any"}
                  onValueChange={(v) =>
                    form.setValue("requiredChairTag", v ?? "any")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any active chair</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                    <SelectItem value="Surgery">Surgery</SelectItem>
                    <SelectItem value="X-Ray">X-Ray</SelectItem>
                    <SelectItem value="Orthodontics">Orthodontics</SelectItem>
                    <SelectItem value="Endodontics">Endodontics</SelectItem>
                    <SelectItem value="Pediatric">Pediatric</SelectItem>
                  </SelectContent>
                </Select>
                {hasChairData &&
                watchedChairTag &&
                watchedChairTag !== "any" &&
                !activeChairTags.has(watchedChairTag.trim().toLowerCase()) ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Warning: No active chair currently has the &ldquo;
                    {watchedChairTag}&rdquo; tag.
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between rounded-lg border px-3 py-2 sm:mt-5">
                <span className="text-xs font-medium">Requires X-Ray</span>
                <Switch
                  checked={Boolean(watchedRequiresXray)}
                  onCheckedChange={(checked) =>
                    form.setValue("requiresXray", checked)
                  }
                />
              </div>
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
                {form.formState.isSubmitting ? "Saving…" : "Save Procedure"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
