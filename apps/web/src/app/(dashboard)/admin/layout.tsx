import type { ReactNode } from "react";
import { ClinicAdminShell } from "@/components/clinic-admin/clinic-admin-shell";

export const instant = false;

export default function ClinicAdminLayout({ children }: { children: ReactNode }) {
  return <ClinicAdminShell>{children}</ClinicAdminShell>;
}
