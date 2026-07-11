import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Clock as ClockIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listMyShifts } from "@/server/shifts";
import { formatGBP } from "@/server/types";

export const Route = createFileRoute("/_authed/my")({
  loader: async () => ({ data: await listMyShifts() }),
  component: MyShiftsPage,
});

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function elapsedLabel(clockInAt: string, now: number) {
  const ms = Math.max(0, now - new Date(clockInAt).getTime());
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function MyShiftsPage() {
  const { data } = Route.useLoaderData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!data.openShift) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data.openShift]);

  return (
    <div>
      <PageHeader kicker="Only verified hours count for pay" title="My Shifts" />

      {data.openShift ? (
        <Card raised className="mb-8">
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gold">
                On the clock
              </p>
              <p className="mt-1 font-display text-2xl uppercase leading-none text-foreground md:text-3xl">
                {data.openShift.locationName} since {formatTime(data.openShift.clockInAt)}
              </p>
            </div>
            <p className="font-mono text-3xl font-bold text-pop">
              {elapsedLabel(data.openShift.clockInAt, now)}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* Monthly totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {data.monthly.map((m) => (
          <Card key={m.month}>
            <CardHeader>
              <CardTitle>{monthLabel(m.month)}</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  verified
                </p>
                <p className="font-mono text-sm font-bold text-foreground">
                  {m.verifiedHours.toFixed(2)}h
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  pending
                </p>
                <p className="font-mono text-sm font-bold text-gold">
                  {m.pendingHours.toFixed(2)}h
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  est. pay
                </p>
                <p className="font-mono text-sm font-bold text-pop">
                  {m.estimatedPay != null ? formatGBP(m.estimatedPay) : "—"}
                </p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Past shifts */}
      <div className="mt-10">
        <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Past shifts
        </h2>
        {data.shifts.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title="No shifts yet"
            hint="Clock in at the shop door and it lands here."
          />
        ) : (
          <Card>
            <div className="flex flex-col divide-y-2 divide-foreground/10">
              {data.shifts.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="font-bold text-foreground">{s.locationName}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(s.clockInAt)}
                      {s.clockOutAt ? ` – ${formatTime(s.clockOutAt)}` : " · still on shift"}
                      {s.hours != null ? ` · ${s.hours.toFixed(2)} hrs` : ""}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        Only verified hours count for pay.
      </p>
    </div>
  );
}
