import { AnnouncementsManager } from "@/components/super-admin/announcements-manager";
import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";

export default function SuperAdminAnnouncementsPage() {
  return (
    <SuperAdminEnvGate>
      <AnnouncementsManager />
    </SuperAdminEnvGate>
  );
}
