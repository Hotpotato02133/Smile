import type { ReactNode } from "react";
import { SuperAdminShell } from "@/components/super-admin/super-admin-shell";

export const instant = false;

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
