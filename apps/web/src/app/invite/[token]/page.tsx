import { Suspense } from "react";
import { InviteAcceptanceView } from "@/components/invitations/invite-acceptance-view";

async function InviteTokenResolver({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InviteAcceptanceView token={token} />;
}

export default function InviteTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] p-6 text-sm text-slate-500">
          Loading invitation…
        </div>
      }
    >
      <InviteTokenResolver params={params} />
    </Suspense>
  );
}
