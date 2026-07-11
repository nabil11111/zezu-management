import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireActorOrRedirect } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Pathless layout route: every route nested under `_authed.*` requires a
 * valid session, and gets the signed-in actor on route context
 * (`Route.useRouteContext()` in children). The public QR clock page
 * (`/clock/$qrToken`) and `/login` live outside this layout.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const actor = await requireActorOrRedirect();
    return { actor };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { actor } = Route.useRouteContext();
  return (
    <AppShell actor={actor}>
      <Outlet />
    </AppShell>
  );
}
