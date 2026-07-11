/**
 * Activity-log helpers.
 *
 * `logActivity` is a plain async function (NOT a server fn) that other server
 * modules import statically and call from inside their handlers. It has no
 * top-level Node-only imports — the db client and auth are reached via
 * dynamic import inside the function body, so this file stays
 * client-bundle-safe. Keep this file free of server fns: the read-side
 * `listActivity` lives in `activity-feed.ts` so routes never import THIS
 * module (whose plain-function body survives client bundling).
 */
export async function logActivity(
  entityType: string,
  entityId: string,
  action: string,
  detail?: unknown,
  // The login flow passes this: the fresh session cookie lives on the
  // *response* there, so reading the request cookie would miss the actor.
  actorOverride?: { id: string | null; name: string },
): Promise<void> {
  const { db, activityLog } = await import("@/db");

  // Best-effort actor stamping. `logActivity` is also called from PUBLIC
  // server fns (the QR clock page) that have no session — actor resolution
  // must never throw and block the log write.
  let actorId: string | null = actorOverride?.id ?? null;
  let actorName: string | null = actorOverride?.name ?? null;
  if (!actorOverride) {
    try {
      const { getSessionActor } = await import("@/lib/auth.server");
      const actor = getSessionActor();
      if (actor) {
        actorId = actor.memberId;
        actorName = actor.name;
      }
    } catch {
      // No session / not resolvable — leave actor fields null.
    }
  }

  await db.insert(activityLog).values({
    entityType,
    entityId,
    action,
    detail: detail === undefined ? null : (detail as object),
    actorId,
    actorName,
  });
}
