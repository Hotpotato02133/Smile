import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

type ClerkEmail = { id: string; email_address: string };
type ClerkPhone = { id: string; phone_number: string };
type ClerkUserPayload = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url?: string | null;
  primary_email_address_id: string | null;
  primary_phone_number_id?: string | null;
  email_addresses: ClerkEmail[];
  phone_numbers?: ClerkPhone[];
};
type ClerkEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserPayload }
  | { type: "user.deleted"; data: { id?: string } }
  | { type: string; data: unknown };

/** Mirrors role/clinicId into Clerk publicMetadata so the edge proxy can route by role. */
async function syncClerkMetadata(
  clerkId: string,
  role: string,
  clinicId: string | null
): Promise<void> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return; // Optional: roles are still authoritative in Convex.
  await fetch(`https://api.clerk.com/v1/users/${clerkId}/metadata`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ public_metadata: { role, clinicId } }),
  });
}

const clerkUsersWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing Svix headers", { status: 400 });
  }

  const payload = await request.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as ClerkEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "user.created" || event.type === "user.updated") {
    const data = (event as { data: ClerkUserPayload }).data;
    const primaryEmail =
      data.email_addresses.find((e) => e.id === data.primary_email_address_id) ??
      data.email_addresses[0];
    if (!primaryEmail) {
      return new Response("No email on user", { status: 400 });
    }
    const primaryPhone =
      data.phone_numbers?.find((p) => p.id === data.primary_phone_number_id) ??
      data.phone_numbers?.[0];

    const result = await ctx.runMutation(internal.users.upsertFromClerk, {
      clerkId: data.id,
      email: primaryEmail.email_address,
      firstName: data.first_name ?? "",
      lastName: data.last_name ?? "",
      phone: primaryPhone?.phone_number,
      avatarUrl: data.image_url ?? undefined,
    });
    await syncClerkMetadata(data.id, result.role, result.clinicId);
  } else if (event.type === "user.deleted") {
    const id = (event as { data: { id?: string } }).data.id;
    if (id) {
      await ctx.runMutation(internal.users.deactivateFromClerk, { clerkId: id });
    }
  }

  return new Response(null, { status: 200 });
});

const http = httpRouter();
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: clerkUsersWebhook,
});

export default http;
