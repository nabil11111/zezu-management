import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  PackageX,
  PoundSterling,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrintReport, DownloadPdfButton } from "@/components/print-report";
import { getInsights } from "@/server/insights";
import { formatGBP, todayDateString } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * CEO INSIGHTS — everything rolled up, one dense screen: month-by-month
 * sales, labour cost, stock order health, and payroll owed, site by site.
 * CEO-only (the nav already gates this; beforeLoad below is the hard stop).
 */

const CHANNEL_COLOR = {
  uber: "var(--chart-1)",
  takeaway: "var(--chart-2)",
  dineIn: "var(--chart-3)",
} as const;

function currentMonth(): string {
  return todayDateString().slice(0, 7);
}

/** Adds `delta` calendar months to a "YYYY-MM" string. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  let year = y;
  let mon = m + delta;
  while (mon < 1) {
    mon += 12;
    year -= 1;
  }
  while (mon > 12) {
    mon -= 12;
    year += 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function pctLabel(pct: number | null): string {
  if (pct == null) return "—";
  return `${(pct * 100).toFixed(1)}%`;
}

export const Route = createFileRoute("/_authed/insights")({
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "ceo") throw redirect({ to: "/" });
  },
  // Optional-typed so plain <Link to="/insights"> works; the current month
  // is always applied as the default, so a value is present at runtime.
  validateSearch: (s: Record<string, unknown>): { month?: string } => {
    const month =
      typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? s.month : currentMonth();
    return { month };
  },
  loaderDeps: ({ search }) => ({ month: search.month ?? currentMonth() }),
  loader: async ({ deps }) => getInsights({ data: { month: deps.month } }),
  component: InsightsPage,
});

type Insights = Awaited<ReturnType<typeof getInsights>>;

function InsightsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = search.month ?? currentMonth();
  const atCurrentMonth = month >= currentMonth();

  return (
    <div>
      <PageHeader
        kicker="Everything, in one dense view"
        title="Insights"
        actions={
          <>
            <div className="flex items-center border-2 border-foreground/20">
              <Button
                variant="ghost"
                size="icon-sm"
                className="border-0"
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, month: shiftMonth(month, -1) }) })
                }
                aria-label="Previous month"
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-32 text-center font-mono text-xs font-bold uppercase tracking-widest text-foreground">
                {monthLabel(month)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="border-0"
                disabled={atCurrentMonth}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, month: shiftMonth(month, 1) }) })
                }
                aria-label="Next month"
              >
                <ChevronRight />
              </Button>
            </div>
            <DownloadPdfButton label="Download monthly report" />
          </>
        }
      />

      <KpiStrip data={data} />

      {data.bestDay || data.worstDay ? (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {data.bestDay ? (
            <p>
              Best day: <span className="text-foreground">{data.bestDay.siteName}</span> ·{" "}
              {formatShortDate(data.bestDay.date)} ·{" "}
              <span className="font-bold text-gold">{formatGBP(data.bestDay.total)}</span>
            </p>
          ) : null}
          {data.worstDay ? (
            <p>
              Worst day: <span className="text-foreground">{data.worstDay.siteName}</span> ·{" "}
              {formatShortDate(data.worstDay.date)} ·{" "}
              <span className="font-bold text-pop">{formatGBP(data.worstDay.total)}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8">
        <SiteBySiteTable data={data} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <WeeklyTrendChart weekly={data.weekly} />
        <ChannelMixBySite sites={data.sites} />
      </div>

      <MonthlyReportPrint data={data} month={month} />
    </div>
  );
}

// ── KPI strip ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  warn = false,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <Card className={cn(warn && "border-gold shadow-gold")}>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <Icon className={cn("size-4", warn ? "text-gold" : "text-pop")} strokeWidth={2.5} />
        </div>
        <p
          className={cn(
            "font-display text-3xl uppercase leading-none md:text-4xl",
            warn ? "text-gold" : "text-foreground",
          )}
        >
          {value}
        </p>
        {sub}
      </CardBody>
    </Card>
  );
}

function KpiStrip({ data }: { data: Insights }) {
  const shortfall = data.totals.orders.shortfallItems;
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
      <StatCard
        icon={PoundSterling}
        label="Sales this month"
        value={formatGBP(data.totals.sales.total)}
      />
      <StatCard
        icon={Clock}
        label="Labour cost"
        value={formatGBP(data.totals.labourCost)}
        sub={
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {pctLabel(data.totals.labourPct)} of sales
          </span>
        }
      />
      <StatCard
        icon={Wallet}
        label="Outstanding payroll"
        value={formatGBP(data.payroll.outstandingAmount)}
        sub={
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {data.payroll.outstandingHours.toFixed(2)}h all-time, all sites
          </span>
        }
      />
      <StatCard
        icon={shortfall > 0 ? AlertTriangle : PackageX}
        label="Orders short this month"
        value={shortfall}
        warn={shortfall > 0}
      />
    </div>
  );
}

// ── Site by site table ───────────────────────────────────────────────────

function ChannelMiniBar({
  uber,
  takeaway,
  dineIn,
}: {
  uber: number;
  takeaway: number;
  dineIn: number;
}) {
  const total = uber + takeaway + dineIn;
  if (total <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex h-2.5 w-20 overflow-hidden border border-foreground/20">
      <div style={{ width: `${(uber / total) * 100}%`, backgroundColor: CHANNEL_COLOR.uber }} />
      <div
        style={{ width: `${(takeaway / total) * 100}%`, backgroundColor: CHANNEL_COLOR.takeaway }}
      />
      <div style={{ width: `${(dineIn / total) * 100}%`, backgroundColor: CHANNEL_COLOR.dineIn }} />
    </div>
  );
}

function SiteBySiteTable({ data }: { data: Insights }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Site by site</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b-2 border-foreground/15 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-2.5">Site</th>
              <th className="px-3 py-2.5 text-right">Sales</th>
              <th className="px-3 py-2.5">Channel split</th>
              <th className="px-3 py-2.5 text-right">Days logged</th>
              <th className="px-3 py-2.5 text-right">Hours (v/p)</th>
              <th className="px-3 py-2.5 text-right">Labour £</th>
              <th className="px-3 py-2.5 text-right">Labour %</th>
              <th className="px-3 py-2.5 text-right">Orders (p/r)</th>
              <th className="px-4 py-2.5 text-right">Short</th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((s) => (
              <tr key={s.id} className="border-b border-foreground/10 hover:bg-muted/40">
                <td className="px-4 py-3 font-bold text-foreground">{s.name}</td>
                <td className="px-3 py-3 text-right font-mono text-xs font-bold text-foreground">
                  {formatGBP(s.sales.total)}
                </td>
                <td className="px-3 py-3">
                  <ChannelMiniBar
                    uber={s.sales.uber}
                    takeaway={s.sales.takeaway}
                    dineIn={s.sales.dineIn}
                  />
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                  {s.sales.daysLogged}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                  {s.hours.verified.toFixed(1)}
                  <span className="text-muted-foreground">/{s.hours.pending.toFixed(1)}</span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                  {formatGBP(s.labourCost)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                  {pctLabel(s.labourPct)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                  {s.orders.placed}
                  <span className="text-muted-foreground">/{s.orders.received}</span>
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-mono text-xs font-bold",
                    s.orders.shortfallItems > 0 ? "text-gold" : "text-muted-foreground",
                  )}
                >
                  {s.orders.shortfallItems}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/20 font-bold">
              <td className="px-4 py-3 text-foreground">Totals</td>
              <td className="px-3 py-3 text-right font-mono text-xs text-pop">
                {formatGBP(data.totals.sales.total)}
              </td>
              <td className="px-3 py-3">
                <ChannelMiniBar
                  uber={data.totals.sales.uber}
                  takeaway={data.totals.sales.takeaway}
                  dineIn={data.totals.sales.dineIn}
                />
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                {data.totals.sales.daysLogged}
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                {data.totals.hours.verified.toFixed(1)}
                <span className="font-normal text-muted-foreground">
                  /{data.totals.hours.pending.toFixed(1)}
                </span>
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                {formatGBP(data.totals.labourCost)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                {pctLabel(data.totals.labourPct)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                {data.totals.orders.placed}
                <span className="font-normal text-muted-foreground">
                  /{data.totals.orders.received}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-gold">
                {data.totals.orders.shortfallItems}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ── Weekly trend + channel mix ───────────────────────────────────────────

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" };
const AXIS_LINE = { stroke: "var(--border)" };

function WeeklyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border-2 border-foreground bg-popover px-3 py-2 shadow-neo-sm">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xs font-bold text-foreground">
        {formatGBP(payload[0]?.value ?? 0)}
      </p>
    </div>
  );
}

function WeeklyTrendChart({ weekly }: { weekly: Insights["weekly"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly trend</CardTitle>
      </CardHeader>
      <CardBody>
        {weekly.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No sales logged this month yet.
          </p>
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="weekLabel" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                  tickFormatter={(v: number) => `£${v}`}
                  width={56}
                />
                <Tooltip content={<WeeklyTooltip />} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="total" fill="var(--chart-1)" name="Sales" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ChannelLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(["uber", "takeaway", "dineIn"] as const).map((ch) => (
        <span
          key={ch}
          className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
        >
          <span className="size-2" style={{ backgroundColor: CHANNEL_COLOR[ch] }} />
          {ch === "dineIn" ? "Dine-in" : ch === "takeaway" ? "Takeaway" : "Uber"}
        </span>
      ))}
    </div>
  );
}

function ChannelMixBySite({ sites }: { sites: Insights["sites"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Channel mix by site</CardTitle>
        <ChannelLegend />
      </CardHeader>
      <CardBody className="flex flex-col justify-center gap-5" style={{ minHeight: 200 }}>
        {sites.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sites yet.</p>
        ) : (
          sites.map((s) => {
            const total = s.sales.total;
            return (
              <div key={s.id}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="font-mono text-xs font-bold text-foreground">
                    {formatGBP(total)}
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden border-2 border-foreground/20 bg-muted">
                  {total > 0 ? (
                    <>
                      <div
                        style={{
                          width: `${(s.sales.uber / total) * 100}%`,
                          backgroundColor: CHANNEL_COLOR.uber,
                        }}
                      />
                      <div
                        style={{
                          width: `${(s.sales.takeaway / total) * 100}%`,
                          backgroundColor: CHANNEL_COLOR.takeaway,
                        }}
                      />
                      <div
                        style={{
                          width: `${(s.sales.dineIn / total) * 100}%`,
                          backgroundColor: CHANNEL_COLOR.dineIn,
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}

// ── PDF export ───────────────────────────────────────────────────────────

function MonthlyReportPrint({ data, month }: { data: Insights; month: string }) {
  return (
    <PrintReport
      title={`Monthly report — ${monthLabel(month)}`}
      subtitle="Site by site — sales, labour, orders — plus best/worst day and payroll owed"
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-[#1b1510]/20 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
            <th className="py-2 pr-4">Site</th>
            <th className="py-2 pr-4 text-right">Sales</th>
            <th className="py-2 pr-4 text-right">Days</th>
            <th className="py-2 pr-4 text-right">Hours verified</th>
            <th className="py-2 pr-4 text-right">Labour £</th>
            <th className="py-2 pr-4 text-right">Labour %</th>
            <th className="py-2 pr-4 text-right">Orders placed</th>
            <th className="py-2 pr-4 text-right">Received</th>
            <th className="py-2 text-right">Short</th>
          </tr>
        </thead>
        <tbody>
          {data.sites.map((s) => (
            <tr key={s.id} className="border-b border-[#1b1510]/10">
              <td className="py-2 pr-4 font-bold">{s.name}</td>
              <td className="py-2 pr-4 text-right">{formatGBP(s.sales.total)}</td>
              <td className="py-2 pr-4 text-right">{s.sales.daysLogged}</td>
              <td className="py-2 pr-4 text-right">{s.hours.verified.toFixed(2)}</td>
              <td className="py-2 pr-4 text-right">{formatGBP(s.labourCost)}</td>
              <td className="py-2 pr-4 text-right">{pctLabel(s.labourPct)}</td>
              <td className="py-2 pr-4 text-right">{s.orders.placed}</td>
              <td className="py-2 pr-4 text-right">{s.orders.received}</td>
              <td className="py-2 text-right">{s.orders.shortfallItems}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[#1b1510]/30 font-bold">
            <td className="py-2 pr-4">Totals</td>
            <td className="py-2 pr-4 text-right">{formatGBP(data.totals.sales.total)}</td>
            <td className="py-2 pr-4 text-right">{data.totals.sales.daysLogged}</td>
            <td className="py-2 pr-4 text-right">{data.totals.hours.verified.toFixed(2)}</td>
            <td className="py-2 pr-4 text-right">{formatGBP(data.totals.labourCost)}</td>
            <td className="py-2 pr-4 text-right">{pctLabel(data.totals.labourPct)}</td>
            <td className="py-2 pr-4 text-right">{data.totals.orders.placed}</td>
            <td className="py-2 pr-4 text-right">{data.totals.orders.received}</td>
            <td className="py-2 text-right">{data.totals.orders.shortfallItems}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">Best day</p>
          <p className="mt-1 font-bold">
            {data.bestDay
              ? `${data.bestDay.siteName} — ${formatShortDate(data.bestDay.date)} — ${formatGBP(data.bestDay.total)}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
            Worst day
          </p>
          <p className="mt-1 font-bold">
            {data.worstDay
              ? `${data.worstDay.siteName} — ${formatShortDate(data.worstDay.date)} — ${formatGBP(data.worstDay.total)}`
              : "—"}
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-[#1b1510]/20 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
          Payroll owed (all-time, all sites)
        </p>
        <p className="mt-1 text-lg font-bold">
          {data.payroll.outstandingHours.toFixed(2)}h · {formatGBP(data.payroll.outstandingAmount)}
        </p>
      </div>
    </PrintReport>
  );
}
