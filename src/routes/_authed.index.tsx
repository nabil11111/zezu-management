import { useEffect } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { Store, PoundSterling, Package, Clock, UserRound, UtensilsCrossed } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getLiveView, type LiveViewSite } from "@/server/live";
import { formatGBP } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Live View — the home screen. "A miniature of the shop, in your pocket."
 * Every accessible site as a card: open or not, who's on the clock, today's
 * takings, stock flags. Ten seconds here should tell you the whole business
 * is running as it should — or exactly where it isn't.
 */
export const Route = createFileRoute("/_authed/")({
  beforeLoad: ({ context }) => {
    if (context.actor.role === "staff") throw redirect({ to: "/my" });
    if (context.actor.role === "warehouse") throw redirect({ to: "/warehouse" });
  },
  loader: async () => await getLiveView(),
  component: LiveViewPage,
});

const QUICK_LINKS = [
  { to: "/sales", label: "Sales", icon: PoundSterling },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/shifts", label: "Shifts", icon: Clock },
  { to: "/people", label: "People", icon: UserRound },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
] as const;

/** ZEZU's three sites are all in Merseyside — every clock on this page reads UK time. */
function ukHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? date.getHours());
}

function ukTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Still up";
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gold" | "pop";
}) {
  return (
    <div className="border-2 border-foreground/20 bg-card px-4 py-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "font-display text-3xl uppercase",
          tone === "gold" ? "text-gold" : tone === "pop" ? "text-pop" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function StatusIndicator({ site, urgent }: { site: LiveViewSite; urgent: boolean }) {
  if (site.status === "open" && site.shopDay) {
    return (
      <div className="text-right">
        <p className="flex items-center justify-end gap-1.5 font-mono text-xs font-bold uppercase tracking-widest text-gold">
          <span className="pulse-dot size-2 shrink-0 bg-gold" />
          Open
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          since {ukTime(site.shopDay.openedAt)} by {site.shopDay.openedByName}
        </p>
      </div>
    );
  }

  if (site.status === "closed" && site.shopDay?.closedAt) {
    const closedAt = site.shopDay.closedAt;
    return (
      <div className="text-right">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Closed
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          closed {ukTime(closedAt)}
        </p>
      </div>
    );
  }

  return (
    <div className="text-right">
      <p
        className={cn(
          "font-mono text-xs font-bold uppercase tracking-widest",
          urgent ? "text-destructive" : "text-destructive/70",
        )}
      >
        Not opened
      </p>
    </div>
  );
}

function SiteCard({ site, urgentNotOpened }: { site: LiveViewSite; urgentNotOpened: boolean }) {
  return (
    <Card
      className={cn(
        "flex flex-col",
        urgentNotOpened && "border-destructive shadow-[4px_4px_0px_0px_var(--color-destructive)]",
      )}
    >
      <CardHeader className="items-start">
        <div className="min-w-0">
          <p className="truncate font-display text-2xl uppercase text-foreground">{site.name}</p>
          {site.address ? (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {site.address}
            </p>
          ) : null}
        </div>
        <StatusIndicator site={site} urgent={urgentNotOpened} />
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-5">
        {/* On the clock */}
        <div>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            On the clock
          </p>
          {site.clockedIn.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">Nobody clocked in</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {site.clockedIn.map((m) => (
                <li
                  key={m.memberId}
                  className="flex items-center justify-between gap-2 border-b border-foreground/10 pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm font-bold text-foreground">
                    {m.name}{" "}
                    <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                      · {m.role}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    since {ukTime(m.clockInAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Takings so far */}
        <div>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Takings so far
          </p>
          {site.todaySales ? (
            <div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
                <span>Uber {formatGBP(site.todaySales.uber)}</span>
                <span>Takeaway {formatGBP(site.todaySales.takeaway)}</span>
                <span>Dine-in {formatGBP(site.todaySales.dineIn)}</span>
              </div>
              <p className="font-display text-3xl text-foreground">
                {formatGBP(site.todaySales.total)}
              </p>
            </div>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">Day not logged yet</p>
          )}
        </div>

        {/* Flags */}
        <div className="mt-auto flex flex-wrap gap-3 pt-1">
          {site.lowStock > 0 ? (
            <Link to="/stock" className="transition-opacity hover:opacity-80">
              <Badge tone="outline" className="border-gold text-gold">
                Low stock ×{site.lowStock}
              </Badge>
            </Link>
          ) : null}
          {site.pendingVerifications > 0 ? (
            <Link to="/shifts" className="transition-opacity hover:opacity-80">
              <Badge tone="pop">Verify ×{site.pendingVerifications}</Badge>
            </Link>
          ) : null}
          {!site.yesterdaySales ? (
            <Link to="/sales" className="transition-opacity hover:opacity-80">
              <Badge tone="danger">Yesterday not logged</Badge>
            </Link>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function LiveViewPage() {
  const data = Route.useLoaderData();
  const { actor } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  const hour = ukHour();
  const greeting = greetingFor(hour);
  const anyOpen = data.sites.some((s) => s.status === "open");

  return (
    <div>
      <PageHeader
        kicker="ZEZU Operations"
        title={`${greeting}, ${actor.name.split(" ")[0]}.`}
        actions={
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {anyOpen ? <span className="pulse-dot size-2 shrink-0 bg-pop" /> : null}
            Live · {ukTime(data.generatedAt)}
          </span>
        }
      />
      <p className="-mt-6 mb-8 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
        The whole shop, one screen.
      </p>

      {data.sites.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No sites yet"
          hint="You're not assigned to any active location. Ask the CEO to add you to a site in Settings."
        />
      ) : (
        <>
          {/* Totals strip */}
          <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
            <StatBlock label="Today so far" value={formatGBP(data.totals.todayTotal)} />
            <StatBlock label="On the clock" value={String(data.totals.clockedInCount)} />
            <StatBlock
              label="Low stock flags"
              value={String(data.totals.lowStockCount)}
              tone={data.totals.lowStockCount > 0 ? "gold" : undefined}
            />
            <StatBlock
              label="Awaiting verification"
              value={String(data.totals.pendingCount)}
              tone={data.totals.pendingCount > 0 ? "pop" : undefined}
            />
          </div>

          {/* Site cards */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {data.sites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                urgentNotOpened={site.status === "not_opened" && hour >= 11}
              />
            ))}
          </div>
        </>
      )}

      {/* Quick actions */}
      <div className="mt-10 flex flex-wrap gap-3 border-t-2 border-foreground/15 pt-6">
        {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2 border-2 border-foreground/30 px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <Icon className="size-3.5" strokeWidth={2.5} />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
