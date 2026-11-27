import { PlansManager } from "@/components/super-admin/plans-manager";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminPlansPage() {
  return (
    <SuperAdminEnvGate>
      <PlansManager />
    </SuperAdminEnvGate>
  );
}
