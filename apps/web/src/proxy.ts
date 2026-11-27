import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

type Role = "super_admin" | "clinic_admin" | "dentist" | "receptionist" | "patient";

const ROLE_ROUTES: { matcher: ReturnType<typeof createRouteMatcher>; roles: Role[] }[] = [
  { matcher: createRouteMatcher(["/super-admin(.*)"]), roles: ["super_admin"] },
  { matcher: createRouteMatcher(["/admin(.*)"]), roles: ["clinic_admin", "super_admin"] },
  {
    matcher: createRouteMatcher(["/front-desk(.*)"]),
    roles: ["receptionist", "clinic_admin", "super_admin"],
  },
  {
    matcher: createRouteMatcher(["/staff(.*)"]),
    roles: ["dentist", "clinic_admin", "super_admin"],
  },
  { matcher: createRouteMatcher(["/patient(.*)"]), roles: ["patient", "super_admin"] },
];

const isProtected = createRouteMatcher([
  "/post-login(.*)",
  ...["/super-admin", "/admin", "/front-desk", "/staff", "/patient"].map((p) => `${p}(.*)`),
]);

/** Reads the role from the Clerk session token (`role`, `metadata.role`, or `public_metadata.role`). */
function roleFromClaims(claims: Record<string, unknown> | null): Role | undefined {
  if (!claims) return undefined;
  const direct = claims.role;
  const nested = (claims.metadata as { role?: unknown } | undefined)?.role;
  const pubMeta = (claims.public_metadata as { role?: unknown } | undefined)?.role;
  const role =
    typeof direct === "string" && direct
      ? direct
      : typeof nested === "string" && nested
        ? nested
        : pubMeta;
  return typeof role === "string" && role ? (role as Role) : undefined;
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  if (!isProtected(req)) return;

  await auth.protect();

  const { sessionClaims } = await auth();
  const role = roleFromClaims(sessionClaims as Record<string, unknown> | null);

  // Role not in the token yet (webhook still syncing): /post-login resolves it from Convex.
  if (!role) return;

  const rule = ROLE_ROUTES.find((r) => r.matcher(req));
  if (rule && !rule.roles.includes(role)) {
    return NextResponse.redirect(new URL("/post-login", req.url));
  }
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  const hasClerkKeys = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );

  if (!hasClerkKeys) {
    if (isProtected(req)) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }
    return NextResponse.next();
  }

  return clerkHandler(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
