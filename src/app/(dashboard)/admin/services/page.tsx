import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { ServicesManager } from "@/components/clinic-admin/services-manager";

export default function ClinicAdminServicesPage() {
  return (
    <ClinicAdminEnvGate>
      <ServicesManager />
    </ClinicAdminEnvGate>
  );
}
