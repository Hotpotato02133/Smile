import { BillingManager } from "@/components/super-admin/billing-manager";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminBillingPage() {
  return (
    <SuperAdminEnvGate>
      <BillingManager />
    </SuperAdminEnvGate>
  );
}
