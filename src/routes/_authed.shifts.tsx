import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, X, Store, Clock as ClockIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { getShiftBoard, verifyShift, rejectShift, openShop, closeShop } from "@/server/shifts";
import { PrintReport, DownloadPdfButton } from "@/components/print-report";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/shifts")({
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "ceo" && !context.capabilities.includes("verify_shifts")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => ({ board: await getShiftBoard({ data: {} }) }),
  component: ShiftsPage,
});

type Board = Awaited<ReturnType<typeof getShiftBoard>>;
type ShopTodayEntry = Board["shopToday"][number];
type ShiftEntry = Board["pending"][number];

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function ShiftsPage() {
  const { board } = Route.useLoaderData();
  const { actor, capabilities } = Route.useRouteContext();
  const canOpenShop = actor.role === "ceo" || capabilities.includes("open_shop");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const filteredRecent =
    locationFilter === "all"
      ? board.recent
      : board.recent.filter(
          (r) => r.locationName === board.locations.find((l) => l.id === locationFilter)?.name,
        );

  const locationLabel =
    locationFilter === "all"
      ? "All locations"
      : (board.locations.find((l) => l.id === locationFilter)?.name ?? "Unknown location");

  return (
    <div>
      <PageHeader
        kicker="Scan in, verified by the manager"
        title="Shifts"
        actions={<DownloadPdfButton />}
      />

      {/* Shop-day status */}
      {board.shopToday.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No locations"
          hint="You don't have any shops assigned yet — ask the CEO to add you."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {board.shopToday.map((s) => (
            <ShopDayCard key={s.locationId} shop={s} canOpenShop={canOpenShop} />
          ))}
        </div>
      )}

      {/* Verification queue */}
      <div className="mt-10">
        <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Waiting for verification
        </h2>
        {board.pending.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title="All caught up"
            hint="Every completed shift has been verified. Nice."
          />
        ) : (
          <Card>
            <div className="flex flex-col divide-y-2 divide-foreground/10">
              {board.pending.map((p) => (
                <PendingRow key={p.id} shift={p} />
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Recent history */}
      <div className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recent history — last 14 days
          </h2>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {board.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filteredRecent.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title="No shifts yet"
            hint="Clock-ins from the shop floor land here."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-foreground/15 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <th className="px-4 py-3 text-left">Crew</th>
                    <th className="px-4 py-3 text-left">Location</th>
                    <th className="px-4 py-3 text-left">In</th>
                    <th className="px-4 py-3 text-left">Out</th>
                    <th className="px-4 py-3 text-left">Hours</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecent.map((r) => (
                    <tr key={r.id} className="border-b border-foreground/10 last:border-b-0">
                      <td className="px-4 py-3 font-bold text-foreground">{r.memberName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.locationName}</td>
                      <td className="px-4 py-3 font-mono text-xs">{formatDateTime(r.clockInAt)}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.clockOutAt ? formatDateTime(r.clockOutAt) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.hours != null ? r.hours.toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <PrintReport title="Shift history" subtitle={`${locationLabel} — last 14 days`}>
        <table>
          <thead>
            <tr>
              <th className="border-b-2 px-2 py-2 text-left">Crew</th>
              <th className="border-b-2 px-2 py-2 text-left">Location</th>
              <th className="border-b-2 px-2 py-2 text-left">Date</th>
              <th className="border-b-2 px-2 py-2 text-left">In</th>
              <th className="border-b-2 px-2 py-2 text-left">Out</th>
              <th className="border-b-2 px-2 py-2 text-left">Hours</th>
              <th className="border-b-2 px-2 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecent.map((r) => (
              <tr key={r.id}>
                <td className="border-b px-2 py-1.5 font-bold">{r.memberName}</td>
                <td className="border-b px-2 py-1.5">{r.locationName}</td>
                <td className="border-b px-2 py-1.5">{formatDate(r.clockInAt)}</td>
                <td className="border-b px-2 py-1.5">{formatTime(r.clockInAt)}</td>
                <td className="border-b px-2 py-1.5">
                  {r.clockOutAt ? formatTime(r.clockOutAt) : "—"}
                </td>
                <td className="border-b px-2 py-1.5">
                  {r.hours != null ? r.hours.toFixed(2) : "—"}
                </td>
                <td className="border-b px-2 py-1.5 capitalize">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PrintReport>
    </div>
  );
}

function ShopDayCard({ shop, canOpenShop }: { shop: ShopTodayEntry; canOpenShop: boolean }) {
  const router = useRouter();
  const openFn = useServerFn(openShop);
  const closeFn = useServerFn(closeShop);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOpen = Boolean(shop.shopDay) && !shop.shopDay?.closedAt;

  async function handleOpen() {
    setBusy(true);
    try {
      await openFn({ data: { locationId: shop.locationId } });
      toast.success(`${shop.locationName} is open`);
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the shop");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setBusy(true);
    try {
      const result = await closeFn({ data: { locationId: shop.locationId } });
      toast.success(
        result.clockedOutCount > 0
          ? `${shop.locationName} is closed — ${result.clockedOutCount} clocked out`
          : `${shop.locationName} is closed`,
      );
      setConfirmOpen(false);
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close the shop");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card raised={isOpen}>
      <CardHeader>
        <CardTitle>{shop.locationName}</CardTitle>
        <span
          className={cn(
            "shrink-0 border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest",
            isOpen
              ? "border-foreground bg-pop text-ink"
              : "border-foreground/30 text-muted-foreground",
          )}
        >
          {isOpen ? "Open" : "Not opened"}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {isOpen && shop.shopDay ? (
          <p className="text-sm text-muted-foreground">
            Open since{" "}
            <span className="font-bold text-foreground">{formatTime(shop.shopDay.openedAt)}</span>{" "}
            by <span className="font-bold text-foreground">{shop.shopDay.openedByName}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody&apos;s opened this shop today.</p>
        )}

        {isOpen ? (
          canOpenShop ? (
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Close shop
                </Button>
              </DialogTrigger>
              <DialogContent
                title="Close the shop?"
                description={`This ends ${shop.locationName}'s day. Closing clocks everyone out — anyone still on the clock is clocked out automatically.`}
              >
                <div className="flex justify-end gap-3">
                  <DialogClose asChild>
                    <Button variant="outline" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button variant="destructive" size="sm" onClick={handleClose} disabled={busy}>
                    {busy ? "Closing…" : "Close shop"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null
        ) : canOpenShop ? (
          <Button size="sm" onClick={handleOpen} disabled={busy}>
            {busy ? "Opening…" : "Open shop"}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PendingRow({ shift }: { shift: ShiftEntry }) {
  const router = useRouter();
  const verifyFn = useServerFn(verifyShift);
  const rejectFn = useServerFn(rejectShift);
  const [busy, setBusy] = useState<"verify" | "reject" | null>(null);

  async function handle(action: "verify" | "reject") {
    setBusy(action);
    try {
      if (action === "verify") {
        await verifyFn({ data: { id: shift.id } });
        toast.success(`Verified ${shift.memberName}'s shift`);
      } else {
        await rejectFn({ data: { id: shift.id } });
        toast.success(`Rejected ${shift.memberName}'s shift`);
      }
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-bold text-foreground">
          {shift.memberName}{" "}
          <span className="font-normal text-muted-foreground">· {shift.locationName}</span>
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {formatTime(shift.clockInAt)} –{" "}
          {shift.clockOutAt ? formatTime(shift.clockOutAt) : "still on shift"}
          {shift.hours != null ? ` · ${shift.hours.toFixed(2)} hrs` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => handle("verify")}
          disabled={busy !== null || !shift.clockOutAt}
        >
          <Check /> Verify
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => handle("reject")}
          disabled={busy !== null || !shift.clockOutAt}
        >
          <X /> Reject
        </Button>
      </div>
    </div>
  );
}
