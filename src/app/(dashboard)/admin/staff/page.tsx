import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { StaffManager } from "@/components/clinic-admin/staff-manager";

export default function ClinicAdminStaffPage() {
  return (
    <ClinicAdminEnvGate>
      <StaffManager />
    </ClinicAdminEnvGate>
  );
}
