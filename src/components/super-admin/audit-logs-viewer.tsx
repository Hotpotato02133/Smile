"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  "CLINIC_DETAILS_UPDATED",
  "CLINIC_STATUS_CHANGED",
  "CLINIC_SUSPENDED",
  "CLINIC_PLAN_CHANGED",
  "CLINIC_SUBSCRIPTION_EXTENDED",
  "CLINIC_FEATURES_UPDATED",
  "CLINIC_ADMIN_INVITED",
  "CLINIC_ADMIN_INVITE_REVOKED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_PAYMENT_RECORDED",
  "SUBSCRIPTION_PAYMENT_STATUS_UPDATED",
  "SUBSCRIPTION_PLAN_CREATED",
  "SUBSCRIPTION_PLAN_UPDATED",
  "DEFAULT_PLANS_SEEDED",
  "PLATFORM_ROLLUP_TRIGGERED",
  "ANNOUNCEMENT_CREATED",
  "ANNOUNCEMENT_EDITED",
  "ANNOUNCEMENT_UPDATED",
  "ANNOUNCEMENT_DELETED",
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
  const [actorUserId, setActorUserId] = useState<string>("all");
  const [actionType, setActionType] = useState<string>("all");
  const [keyword, setKeyword] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const clinics = useQuery(api.superAdmin.listClinics, {});
  const actors = useQuery(api.superAdmin.listAuditActors, {});

  const { results, status, loadMore } = usePaginatedQuery(
    api.superAdmin.listAuditLogsPaginated,
    {
      clinicId: clinicId === "all" ? undefined : (clinicId as Id<"clinics">),
      actorUserId:
        actorUserId === "all" ? undefined : (actorUserId as Id<"users">),
      actionType: actionType === "all" ? undefined : actionType,
    },
    { initialNumItems: 25 }
  );

  const filteredLogs = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    if (!term) return results;
    return results.filter(
      (log) =>
        log.actionType.toLowerCase().includes(term) ||
        log.actorName.toLowerCase().includes(term) ||
        log.actorEmail.toLowerCase().includes(term) ||
        (log.clinicName ?? "").toLowerCase().includes(term) ||
        log.targetEntity.toLowerCase().includes(term) ||
        log.metadataJson.toLowerCase().includes(term)
    );
  }, [results, keyword]);

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = [
      "Timestamp",
      "Action",
      "Actor",
      "Role",
      "Clinic",
      "Target",
      "Metadata",
    ];
    const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((log) =>
      [
        new Date(log.createdAt).toISOString(),
        log.actionType,
        log.actorName,
        log.actorRole,
        log.clinicName ?? "Platform-wide",
        log.targetEntity,
        log.metadataJson,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smile-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Platform Audit Logs
          </h1>
          <p className="text-sm text-slate-600">
            Immutable chronological trail of every subscription change, status
            gate, invitation, and platform mutation.
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={filteredLogs.length === 0}
          onClick={handleExportCsv}
          className="h-9 w-fit rounded-full border-slate-200 px-4 text-xs font-semibold"
        >
          <Download className="mr-1.5 size-3.5" />
          Export CSV
        </Button>
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
        {/* Filters */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Search actor, clinic, metadata…"
              className="h-9 rounded-full border-slate-200 bg-[#F8FAFC] pl-9 text-xs"
            />
          </div>

          <Select
            value={clinicId}
            onValueChange={(v) => setClinicId(v ?? "all")}
          >
            <SelectTrigger className="h-9 w-full rounded-full">
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
            value={actorUserId}
            onValueChange={(v) => setActorUserId(v ?? "all")}
          >
            <SelectTrigger className="h-9 w-full rounded-full">
              <SelectValue placeholder="All actors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actors</SelectItem>
              {(actors ?? []).map((actor) => (
                <SelectItem key={actor._id} value={actor._id}>
                  {actor.name} ({actor.role.replace("_", " ")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={actionType}
            onValueChange={(v) => setActionType(v ?? "all")}
          >
            <SelectTrigger className="h-9 w-full rounded-full">
              <SelectValue placeholder="All action types" />
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

        <div className="mt-5">
          {status === "LoadingFirstPage" ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] py-12 text-center text-sm text-slate-500">
              No audit events recorded for the current filter.
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10" />
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Target</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => {
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
                            <TableCell className="text-xs tabular-nums text-slate-600">
                              {formatDateTime(log.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="rounded-full bg-[#F8FAFC] font-mono text-[11px] text-slate-800"
                              >
                                {log.actionType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-xs font-semibold text-slate-900">
                                {log.actorName}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {log.actorRole}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-700">
                              {log.clinicName ?? (
                                <span className="text-slate-400">
                                  Platform-wide
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-500">
                              {log.targetEntity}
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow className="bg-[#F8FAFC] hover:bg-[#F8FAFC]">
                              <TableCell colSpan={6} className="p-3">
                                <pre className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white p-3.5 font-mono text-xs text-slate-800">
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
              </div>

              {/* Mobile Expandable Cards */}
              <div className="space-y-3 md:hidden">
                {filteredLogs.map((log) => {
                  const isOpen = expandedId === log._id;
                  return (
                    <div
                      key={log._id}
                      className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3.5"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : log._id)}
                        className="flex w-full items-start justify-between gap-2 text-left cursor-pointer"
                      >
                        <div className="min-w-0 space-y-1">
                          <Badge
                            variant="outline"
                            className="rounded-full bg-white font-mono text-[10px]"
                          >
                            {log.actionType}
                          </Badge>
                          <p className="text-xs font-semibold text-slate-900">
                            {log.actorName}{" "}
                            <span className="font-normal text-slate-500">
                              ({log.actorRole})
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTime(log.createdAt)} ·{" "}
                            {log.clinicName ?? "Platform-wide"}
                          </p>
                        </div>
                        {isOpen ? (
                          <ChevronDown className="mt-1 size-4 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="mt-1 size-4 shrink-0 text-slate-400" />
                        )}
                      </button>

                      {isOpen ? (
                        <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200/80 bg-white p-3 font-mono text-[11px] text-slate-800">
                          {prettyJson(log.metadataJson)}
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Cursor Pagination Footer */}
              {status === "CanLoadMore" || status === "LoadingMore" ? (
                <div className="mt-5 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={status === "LoadingMore"}
                    onClick={() => loadMore(25)}
                    className="h-9 rounded-full border-slate-200 px-5 text-xs font-semibold"
                  >
                    {status === "LoadingMore"
                      ? "Loading more events…"
                      : "Load more audit logs"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
