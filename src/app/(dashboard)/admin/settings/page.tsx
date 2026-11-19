import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { ClinicSettingsForm } from "@/components/clinic-admin/clinic-settings-form";

export default function ClinicAdminSettingsPage() {
  return (
    <ClinicAdminEnvGate>
      <ClinicSettingsForm />
    </ClinicAdminEnvGate>
  );
}
