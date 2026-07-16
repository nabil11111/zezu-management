import { useEffect, useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  PoundSterling,
  Store,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PrintReport, DownloadPdfButton } from "@/components/print-report";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { upsertSalesEntry, getSalesDashboard, getEntryForDay } from "@/server/sales";
import { listLocations } from "@/server/locations";
import { formatGBP, todayDateString, SALES_CHANNEL_LABEL } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Daily Sales — "uber · takeaway · dine-in, side by side". Each site enters
 * its day in three numbers; this page does the comparing: today vs last
 * week, site vs site, the channel mix, and the best/worst days on record.
 */

const WINDOW_OPTIONS = [14, 30, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

const CHANNEL_COLOR: Record<"uber" | "takeaway" | "dineIn", string> = {
  uber: "var(--chart-1)",
  takeaway: "var(--chart-2)",
  dineIn: "var(--chart-3)",
};

export const Route = createFileRoute("/_authed/sales")({
  // CEO-only, and only once the CEO has switched sales visibility on —
  // sales figures are hidden from everyone (including the CEO) by default.
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "ceo" || !context.flags.salesVisible) {
      throw redirect({ to: "/" });
    }
  },
  // Optional-typed so plain <Link to="/sales"> works; defaults are still
  // always applied here, so both values are present at runtime.
  validateSearch: (s: Record<string, unknown>): { location?: string; days?: WindowDays } => {
    const rawDays = Number(s.days);
    const days = (WINDOW_OPTIONS as readonly number[]).includes(rawDays)
      ? (rawDays as WindowDays)
      : 30;
    const location = typeof s.location === "string" && s.location.length > 0 ? s.location : "all";
    return { location, days };
  },
  loaderDeps: ({ search }) => ({ location: search.location ?? "all", days: search.days ?? 30 }),
  loader: async ({ deps }) => {
    const [sites, dashboard] = await Promise.all([
      listLocations(),
      getSalesDashboard({
        data: {
          locationId: deps.location === "all" ? undefined : deps.location,
          days: deps.days,
        },
      }),
    ]);
    return { sites, dashboard };
  },
  component: SalesPage,
});

type Dashboard = Awaited<ReturnType<typeof getSalesDashboard>>;
type SiteOption = { id: string; name: string };

function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function pctLabel(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function SalesPage() {
  const { sites, dashboard } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{ locationId: string; date: string } | null>(null);

  const showAllOption = sites.length > 1;
  const showSiteComparison = dashboard.byLocation.length > 1;

  return (
    <div>
      <PageHeader
        kicker="Uber · takeaway · dine-in, side by side"
        title="Sales"
        actions={
          <>
            {showAllOption ? (
              <Select
                value={search.location}
                onValueChange={(v) =>
                  navigate({ to: "/sales", search: (prev) => ({ ...prev, location: v }) })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="flex gap-1">
              {WINDOW_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() =>
                    navigate({ to: "/sales", search: (prev) => ({ ...prev, days: d }) })
                  }
                  className={cn(
                    "border-2 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wide transition-all cursor-pointer",
                    search.days === d
                      ? "border-foreground bg-pop text-ink"
                      : "border-foreground/20 text-muted-foreground hover:border-foreground/50",
                  )}
                >
                  {d}D
                </button>
              ))}
            </div>
            <DownloadPdfButton label="Download PDF" />
          </>
        }
      />

      <LogDayCard
        sites={sites}
        missingYesterday={dashboard.missingYesterday}
        selection={selection}
        onConsumedSelection={() => setSelection(null)}
      />

      <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
        <StatCard
          icon={PoundSterling}
          label="Today so far"
          value={dashboard.today.logged ? formatGBP(dashboard.today.total) : "—"}
          sub={
            !dashboard.today.logged ? (
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                not logged yet
              </span>
            ) : null
          }
        />
        <StatCard
          icon={CalendarClock}
          label="Vs same day last week"
          value={formatGBP(dashboard.today.total)}
          sub={
            <ChangeIndicator
              current={dashboard.today.total}
              previous={dashboard.lastWeekSameDay.total}
            />
          }
        />
        <StatCard
          icon={TrendingUp}
          label="This week vs last week"
          value={formatGBP(dashboard.weekTotal)}
          sub={<ChangeIndicator current={dashboard.weekTotal} previous={dashboard.prevWeekTotal} />}
        />
        <StatCard
          icon={Trophy}
          label="Best day on record"
          value={dashboard.bestDay ? formatGBP(dashboard.bestDay.total) : "—"}
          accent
          sub={
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {dashboard.bestDay ? formatShortDate(dashboard.bestDay.date) : "no data yet"}
            </span>
          }
        />
      </div>

      {dashboard.worstDay ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Worst day on record: {formatShortDate(dashboard.worstDay.date)} ·{" "}
          <span className="text-foreground">{formatGBP(dashboard.worstDay.total)}</span>
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DailyChannelChart daily={dashboard.daily} />
        <ChannelMixBlocks channelMix={dashboard.channelMix} />
      </div>

      {showSiteComparison ? (
        <div className="mt-8">
          <SiteComparisonChart byLocation={dashboard.byLocation} />
        </div>
      ) : null}

      <div className="mt-8">
        <RecentEntriesTable entries={dashboard.recentEntries} onEdit={setSelection} />
      </div>

      <SalesReportPrint dashboard={dashboard} sites={sites} search={search} />
    </div>
  );
}

// ── PDF export ───────────────────────────────────────────────────────────

function SalesReportPrint({
  dashboard,
  sites,
  search,
}: {
  dashboard: Dashboard;
  sites: SiteOption[];
  search: { location?: string; days?: WindowDays };
}) {
  const scopeLabel =
    !search.location || search.location === "all"
      ? "All sites"
      : (sites.find((s) => s.id === search.location)?.name ?? "All sites");
  const windowLabel = `Last ${search.days ?? 30} days`;

  return (
    <PrintReport title="Sales report" subtitle={`${scopeLabel} — ${windowLabel}`}>
      <table className="mb-6 w-full border-collapse text-left text-sm">
        <tbody>
          <tr className="border-b border-[#1b1510]/10">
            <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
              Today so far
            </td>
            <td className="py-2 pr-4 font-bold">
              {dashboard.today.logged ? formatGBP(dashboard.today.total) : "—"}
            </td>
            <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
              This week
            </td>
            <td className="py-2 font-bold">{formatGBP(dashboard.weekTotal)}</td>
          </tr>
          <tr>
            <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
              Best day on record
            </td>
            <td className="py-2 pr-4 font-bold">
              {dashboard.bestDay
                ? `${formatShortDate(dashboard.bestDay.date)} — ${formatGBP(dashboard.bestDay.total)}`
                : "—"}
            </td>
            <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
              Worst day on record
            </td>
            <td className="py-2 font-bold">
              {dashboard.worstDay
                ? `${formatShortDate(dashboard.worstDay.date)} — ${formatGBP(dashboard.worstDay.total)}`
                : "—"}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-[#1b1510]/20 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
            <th className="py-2 pr-4">Date</th>
            <th className="py-2 pr-4">Site</th>
            <th className="py-2 pr-4 text-right">Uber</th>
            <th className="py-2 pr-4 text-right">Takeaway</th>
            <th className="py-2 pr-4 text-right">Dine-in</th>
            <th className="py-2 pr-4 text-right">Total</th>
            <th className="py-2">Logged by</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.recentEntries.map((e) => (
            <tr key={e.id} className="border-b border-[#1b1510]/10">
              <td className="py-2 pr-4">{formatShortDate(e.date)}</td>
              <td className="py-2 pr-4 font-bold">{e.locationName}</td>
              <td className="py-2 pr-4 text-right">{formatGBP(e.uber)}</td>
              <td className="py-2 pr-4 text-right">{formatGBP(e.takeaway)}</td>
              <td className="py-2 pr-4 text-right">{formatGBP(e.dineIn)}</td>
              <td className="py-2 pr-4 text-right font-bold">{formatGBP(e.total)}</td>
              <td className="py-2">{e.byMemberName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintReport>
  );
}

// ── Zone 1 — Log the day ────────────────────────────────────────────────────

function MoneyInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-lg font-bold text-muted-foreground">
        £
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        autoFocus={autoFocus}
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        className="h-14 pl-9 pr-3 text-2xl font-bold"
      />
    </div>
  );
}

function LogDayCard({
  sites,
  missingYesterday,
  selection,
  onConsumedSelection,
}: {
  sites: SiteOption[];
  missingYesterday: Dashboard["missingYesterday"];
  selection: { locationId: string; date: string } | null;
  onConsumedSelection: () => void;
}) {
  const router = useRouter();
  const upsertFn = useServerFn(upsertSalesEntry);
  const getEntryFn = useServerFn(getEntryForDay);
  const today = todayDateString();

  const [locationId, setLocationId] = useState(sites[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [uber, setUber] = useState("");
  const [takeaway, setTakeaway] = useState("");
  const [dineIn, setDineIn] = useState("");
  const [note, setNote] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selection) return;
    setLocationId(selection.locationId);
    setDate(selection.date);
    onConsumedSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    if (!locationId || !date) return;
    let cancelled = false;
    getEntryFn({ data: { locationId, date } }).then((row) => {
      if (cancelled) return;
      if (row) {
        setUber(String(row.uber));
        setTakeaway(String(row.takeaway));
        setDineIn(String(row.dineIn));
        setNote(row.note ?? "");
        setExistingId(row.id);
      } else {
        setUber("");
        setTakeaway("");
        setDineIn("");
        setNote("");
        setExistingId(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, date]);

  const total = (Number(uber) || 0) + (Number(takeaway) || 0) + (Number(dineIn) || 0);

  async function submit() {
    if (!locationId) {
      toast.error("Pick a site first");
      return;
    }
    setBusy(true);
    try {
      await upsertFn({
        data: {
          locationId,
          date,
          uber: Number(uber) || 0,
          takeaway: Number(takeaway) || 0,
          dineIn: Number(dineIn) || 0,
          note: note.trim() || null,
        },
      });
      toast.success(existingId ? "Day updated ✓" : "Logged ✓");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the day");
    } finally {
      setBusy(false);
    }
  }

  if (sites.length === 0) {
    return (
      <Card className="mt-8 border-2 border-foreground shadow-neo">
        <CardBody>
          <EmptyState
            icon={Store}
            title="No site access yet"
            hint="Ask the CEO to assign you to a site before you can log sales."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "mt-8 border-2",
        existingId ? "border-pop shadow-pop" : "border-foreground shadow-neo",
      )}
    >
      <CardHeader>
        <CardTitle>Log the day</CardTitle>
        {existingId ? <Badge tone="pop">Editing a logged day</Badge> : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        {missingYesterday.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-2 border-gold bg-gold/10 px-3 py-2">
            <AlertTriangle className="size-4 shrink-0 text-gold" strokeWidth={2.5} />
            <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-gold">
              Yesterday not logged: {missingYesterday.map((m) => m.name).join(", ")}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Site">
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Uber">
            <MoneyInput value={uber} onChange={setUber} autoFocus />
          </Field>
          <Field label="Takeaway">
            <MoneyInput value={takeaway} onChange={setTakeaway} />
          </Field>
          <Field label="Dine-in">
            <MoneyInput value={dineIn} onChange={setDineIn} />
          </Field>
        </div>

        <div className="flex items-baseline justify-between border-2 border-foreground/15 bg-muted/40 px-4 py-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Total
          </span>
          <span className="font-display text-4xl uppercase text-pop">{formatGBP(total)}</span>
        </div>

        <Field label="Note" hint="Optional — anything worth remembering about the day">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Rained all evening, quiet dine-in…"
            rows={2}
          />
        </Field>

        <Button onClick={submit} disabled={busy || !locationId} className="w-full">
          {existingId ? "Update day" : "Log the day"}
        </Button>
      </CardBody>
    </Card>
  );
}

// ── Zone 2 — Stat cards ──────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={cn(accent && "border-gold shadow-gold")}>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <Icon className={cn("size-4", accent ? "text-gold" : "text-pop")} strokeWidth={2.5} />
        </div>
        <p
          className={cn(
            "font-display text-3xl uppercase leading-none md:text-4xl",
            accent ? "text-gold" : "text-foreground",
          )}
        >
          {value}
        </p>
        {sub}
      </CardBody>
    </Card>
  );
}

function ChangeIndicator({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) {
    return (
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        no data last time
      </span>
    );
  }
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs font-bold",
        up ? "text-gold" : "text-pop",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.5} />
      {pctLabel(pct)}
    </span>
  );
}

// ── Zone 3 — Charts ──────────────────────────────────────────────────────────

function ChannelLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(["uber", "takeaway", "dineIn"] as const).map((ch) => (
        <span
          key={ch}
          className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
        >
          <span className="size-2" style={{ backgroundColor: CHANNEL_COLOR[ch] }} />
          {SALES_CHANNEL_LABEL[ch]}
        </span>
      ))}
    </div>
  );
}

interface TooltipEntry {
  dataKey?: string;
  name?: string;
  value?: number;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (typeof p.value === "number" ? p.value : 0), 0);
  const isDate = typeof label === "string" && /^\d{4}-\d{2}-\d{2}$/.test(label);
  return (
    <div className="border-2 border-foreground bg-popover px-3 py-2 shadow-neo-sm">
      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {isDate && label ? formatShortDate(label) : label}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-foreground">
            <span
              className="size-2"
              style={{ backgroundColor: p.color ?? "var(--muted-foreground)" }}
            />
            {p.name}
          </span>
          <span className="font-mono font-bold text-foreground">{formatGBP(p.value ?? 0)}</span>
        </p>
      ))}
      {payload.length > 1 ? (
        <p className="mt-1 flex items-center justify-between gap-4 border-t border-foreground/15 pt-1 text-xs font-bold">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono text-pop">{formatGBP(total)}</span>
        </p>
      ) : null}
    </div>
  );
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" };
const AXIS_LINE = { stroke: "var(--border)" };
const GRID_STROKE = "var(--border)";
const CURSOR_FILL = "var(--muted)";

function DailyChannelChart({ daily }: { daily: Dashboard["daily"] }) {
  const tickInterval = Math.max(0, Math.ceil(daily.length / 10) - 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily totals by channel</CardTitle>
        <ChannelLegend />
      </CardHeader>
      <CardBody>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                interval={tickInterval}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickFormatter={(v: number) => `£${v}`}
                width={56}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: CURSOR_FILL }} />
              <Bar dataKey="uber" stackId="ch" fill={CHANNEL_COLOR.uber} name="Uber" />
              <Bar dataKey="takeaway" stackId="ch" fill={CHANNEL_COLOR.takeaway} name="Takeaway" />
              <Bar dataKey="dineIn" stackId="ch" fill={CHANNEL_COLOR.dineIn} name="Dine-in" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function ChannelMixBlocks({ channelMix }: { channelMix: Dashboard["channelMix"] }) {
  const total = channelMix.uber + channelMix.takeaway + channelMix.dineIn;
  const channels = (["uber", "takeaway", "dineIn"] as const).map((key) => ({
    key,
    label: SALES_CHANNEL_LABEL[key],
    value: channelMix[key],
    pct: total > 0 ? (channelMix[key] / total) * 100 : 0,
    color: CHANNEL_COLOR[key],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channel mix</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col justify-center gap-5" style={{ minHeight: 280 }}>
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No sales logged in this window yet.
          </p>
        ) : (
          channels.map((c) => (
            <div key={c.key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {c.label}
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {formatGBP(c.value)} · {c.pct.toFixed(0)}%
                </span>
              </div>
              <div className="h-3 w-full border-2 border-foreground/20 bg-muted">
                <div className="h-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
              </div>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function SiteComparisonChart({ byLocation }: { byLocation: Dashboard["byLocation"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Site vs site</CardTitle>
        <ChannelLegend />
      </CardHeader>
      <CardBody>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byLocation} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
              <YAxis
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickFormatter={(v: number) => `£${v}`}
                width={56}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: CURSOR_FILL }} />
              <Bar dataKey="uber" stackId="site" fill={CHANNEL_COLOR.uber} name="Uber" />
              <Bar
                dataKey="takeaway"
                stackId="site"
                fill={CHANNEL_COLOR.takeaway}
                name="Takeaway"
              />
              <Bar dataKey="dineIn" stackId="site" fill={CHANNEL_COLOR.dineIn} name="Dine-in" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Zone 4 — Recent entries ──────────────────────────────────────────────────

function RecentEntriesTable({
  entries,
  onEdit,
}: {
  entries: Dashboard["recentEntries"];
  onEdit: (selection: { locationId: string; date: string }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent entries</CardTitle>
      </CardHeader>
      {entries.length === 0 ? (
        <CardBody>
          <EmptyState
            icon={PoundSterling}
            title="Nothing logged yet"
            hint="Log today's numbers above and they'll show up here."
          />
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b-2 border-foreground/15 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-2.5">Date</th>
                <th className="px-3 py-2.5">Site</th>
                <th className="px-3 py-2.5 text-right">Uber</th>
                <th className="px-3 py-2.5 text-right">Takeaway</th>
                <th className="px-3 py-2.5 text-right">Dine-in</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5">Note</th>
                <th className="px-4 py-2.5">Logged by</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => onEdit({ locationId: e.locationId, date: e.date })}
                  className="cursor-pointer border-b border-foreground/10 hover:bg-muted/40"
                >
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {formatShortDate(e.date)}
                  </td>
                  <td className="px-3 py-3 font-bold text-foreground">{e.locationName}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{formatGBP(e.uber)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {formatGBP(e.takeaway)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{formatGBP(e.dineIn)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs font-bold text-pop">
                    {formatGBP(e.total)}
                  </td>
                  <td className="max-w-48 truncate px-3 py-3 text-xs text-muted-foreground">
                    {e.note ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground">
                    {e.byMemberName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
