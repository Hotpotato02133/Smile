import { SuperAdminEnvGate } from "@/components/super-admin/super-admin-shell";
import { UsersInvitationsManager } from "@/components/super-admin/users-invitations-manager";

export default function SuperAdminUsersPage() {
  return (
    <SuperAdminEnvGate>
      <UsersInvitationsManager />
    </SuperAdminEnvGate>
  );
}
