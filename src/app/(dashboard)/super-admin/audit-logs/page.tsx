import { AuditLogsViewer } from "@/components/super-admin/audit-logs-viewer";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminAuditLogsPage() {
  return (
    <SuperAdminEnvGate>
      <AuditLogsViewer />
    </SuperAdminEnvGate>
  );
}
