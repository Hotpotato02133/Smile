"use client";

import { useQuery } from "convex/react";
import {
  ArrowRight,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthHeaderControls } from "@/components/auth/auth-header-controls";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "../../../convex/_generated/api";

function ConnectedDirectory() {
  const [search, setSearch] = useState("");
  const clinics = useQuery(api.publicBooking.listPublicClinics, {
    search: search.trim() || undefined,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 lg:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Find a Dental Clinic
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse verified dental practices and book real-time dentist &
            operatory chair slots online.
          </p>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clinic name or city…"
            className="pl-8"
          />
        </div>
      </div>

      {clinics === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-4 w-56 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-12 w-full animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clinics.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            No active dental clinics match your search yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clinics.map((clinic) => (
            <Card key={clinic._id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                    style={{ backgroundColor: clinic.primaryColorHex }}
                  >
                    {clinic.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      {clinic.name}
                    </CardTitle>
                    <CardDescription className="truncate">
                      {clinic.tagline ?? `${clinic.city}, ${clinic.province}`}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-2 text-xs text-muted-foreground">
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {clinic.address}, {clinic.city}, {clinic.province}
                  </span>
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="size-3.5 shrink-0" />
                  <span>{clinic.phone}</span>
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <Badge variant="secondary" className="gap-1">
                    <Stethoscope className="size-3" />
                    {clinic.activeDentistCount} dentist
                    {clinic.activeDentistCount === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline">
                    {clinic.activeChairCount} chair
                    {clinic.activeChairCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  render={<Link href={`/c/${clinic.slug}`} />}
                >
                  Book Appointment
                  <ArrowRight className="ml-1.5 size-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClinicsDirectory() {
  const { isConfigured } = useEnvConfig();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Smile
        </Link>
        <AuthHeaderControls />
      </header>

      {!isConfigured ? (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Connect Convex & Clerk to browse live clinics</AlertTitle>
            <AlertDescription>
              Configure <code>.env.local</code> and run{" "}
              <code>npx convex dev</code> to display provisioned dental clinics.
            </AlertDescription>
          </Alert>
        </main>
      ) : (
        <ConnectedDirectory />
      )}
    </div>
  );
}
