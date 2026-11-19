"use client";

import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const ACTION_TYPES = [
  "CLINIC_CREATED",
  "CLINIC_STATUS_CHANGED",
  "CLINIC_SUSPENDED",
  "CLINIC_PLAN_CHANGED",
  "CLINIC_FEATURES_UPDATED",
  "CLINIC_ADMIN_INVITED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_PAYMENT_RECORDED",
  "SUBSCRIPTION_PAYMENT_STATUS_UPDATED",
  "SUBSCRIPTION_PLAN_CREATED",
  "SUBSCRIPTION_PLAN_UPDATED",
  "ANNOUNCEMENT_CREATED",
  "ANNOUNCEMENT_UPDATED",
] as const;

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditLogsViewer() {
  const [clinicId, setClinicId] = useState<string>("all");
  const [actionType, setActionType] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const clinics = useQuery(api.superAdmin.listClinics, {});
  const logs = useQuery(api.superAdmin.listAuditLogs, {
    clinicId: clinicId === "all" ? undefined : (clinicId as Id<"clinics">),
    actionType: actionType === "all" ? undefined : actionType,
    limit: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Platform Audit Logs
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable Law #7 trail of every subscription change, status gate,
          invitation, and platform mutation.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Audit Events</CardTitle>
            <CardDescription>
              Indexed reverse-chronological feed from <code>platformAuditLogs</code>
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select
              value={clinicId}
              onValueChange={(v) => setClinicId(v ?? "all")}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All clinics" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clinics</SelectItem>
                {(clinics ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={actionType}
              onValueChange={(v) => setActionType(v ?? "all")}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All action types</SelectItem>
                {ACTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {logs === undefined ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Loading audit logs…
            </p>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No audit events recorded for the current filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const isOpen = expandedId === log._id;
                  return (
                    <Fragment key={log._id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Toggle metadata"
                            onClick={() =>
                              setExpandedId(isOpen ? null : log._id)
                            }
                          >
                            {isOpen ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {log.actionType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">
                            {log.actorName}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {log.actorRole}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.clinicName ?? (
                            <span className="text-muted-foreground">
                              Platform-wide
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {log.targetEntity}
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="p-3">
                            <pre className="overflow-x-auto rounded-md bg-background p-3 font-mono text-xs text-foreground ring-1 ring-border">
                              {prettyJson(log.metadataJson)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
