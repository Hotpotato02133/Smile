import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { ClinicBillingPanel } from "@/components/clinic-admin/clinic-billing";

export default function ClinicAdminBillingPage() {
  return (
    <ClinicAdminEnvGate>
      <ClinicBillingPanel />
    </ClinicAdminEnvGate>
  );
}
