import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { accessCodeSchema } from "@/server/types";
import type { Actor } from "@/lib/auth.server";

/**
 * This file IS statically imported by client-rendered routes (login.tsx,
 * _authed.tsx), so it must stay free of Node-only imports (crypto, the DB
 * client, etc). All of that lives in `auth.server.ts` and is reached here
 * only via dynamic `import()` from inside each handler — see the comment at
 * the top of that file for why. `logActivity` is safe to import statically:
 * its `@/db` reach-in is dynamic, inside the function body.
 *
 * ZEZU sign-in: one unique 4-digit code per person. The code IS the
 * identity — role and locations hang off the member row it resolves to.
 */

export const login = createServerFn({ method: "POST" })
  .validator(z.object({ code: accessCodeSchema }))
  .handler(async ({ data }) => {
    const { hashCode, createSession } = await import("@/lib/auth.server");
    const { db, members } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");

    const codeHash = hashCode(data.code);
    const member = await db.query.members.findFirst({
      where: and(eq(members.codeHash, codeHash), eq(members.active, true)),
    });

    if (!member) {
      throw new Error("Invalid code");
    }

    const actor: Actor = {
      memberId: member.id,
      name: member.name,
      role: member.role as Actor["role"],
    };
    createSession(actor);
    await logActivity(
      "member",
      member.id,
      "login",
      { name: member.name },
      {
        id: member.id,
        name: member.name,
      },
    );
    return { success: true as const, name: member.name, role: actor.role };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearSession } = await import("@/lib/auth.server");
  clearSession();
  return { success: true as const };
});

/** Auth-gated: the signed-in actor — used to gate role-specific UI. */
export const getCurrentActor = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAuth } = await import("@/lib/auth.server");
  return await requireAuth();
});

/** Cookie is httpOnly, so the client can't read it directly — route guards
 * must round-trip through this server function. Uses requireAuth so a
 * deactivated member's still-signed cookie stops opening pages, not just fns. */
export const checkSession = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAuth } = await import("@/lib/auth.server");
  try {
    await requireAuth();
    return true;
  } catch {
    return false;
  }
});

/** Route-level guard for `beforeLoad`: resolves the actor or redirects to
 * /login. Returned so layouts can put the actor on route context. */
export async function requireActorOrRedirect(): Promise<Actor> {
  try {
    return await getCurrentActor();
  } catch {
    throw redirect({ to: "/login" });
  }
}
