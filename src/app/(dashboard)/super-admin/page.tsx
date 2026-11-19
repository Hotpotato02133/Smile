import { OverviewDashboard } from "@/components/super-admin/overview-dashboard";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminOverviewPage() {
  return (
    <SuperAdminEnvGate>
      <OverviewDashboard />
    </SuperAdminEnvGate>
  );
}
