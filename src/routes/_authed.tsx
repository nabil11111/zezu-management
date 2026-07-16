import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadBootstrapOrRedirect } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Pathless layout route: every route nested under `_authed.*` requires a
 * valid session. The full session bootstrap (actor + capabilities + the
 * sales/salary visibility flags + welcome state) lands on route context, so
 * children read it via `Route.useRouteContext()`. The public QR clock page
 * (`/clock/$qrToken`) and `/login` live outside this layout.
 *
 * New crew are held at `/welcome` until they've watched the intro video.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const bootstrap = await loadBootstrapOrRedirect();
    if (bootstrap.welcome.needsToWatch && location.pathname !== "/welcome") {
      throw redirect({ to: "/welcome" });
    }
    return bootstrap;
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { actor, capabilities, flags } = Route.useRouteContext();
  return (
    <AppShell actor={actor} capabilities={capabilities} flags={flags}>
      <Outlet />
    </AppShell>
  );
}
