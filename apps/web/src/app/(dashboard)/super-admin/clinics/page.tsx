import { ClinicsManager } from "@/components/super-admin/clinics-manager";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminClinicsPage() {
  return (
    <SuperAdminEnvGate>
      <ClinicsManager />
    </SuperAdminEnvGate>
  );
}
