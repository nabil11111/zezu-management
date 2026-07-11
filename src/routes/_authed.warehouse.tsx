import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { listWarehouseOrders, markOrderSent } from "@/server/orders";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Warehouse — every branch's orders in one queue. Pack the van (adjust
 * quantities down if something's short), mark it sent, then watch it move
 * to "on the van" and, once the branch counts it in, "received".
 */

export const Route = createFileRoute("/_authed/warehouse")({
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "warehouse" && context.actor.role !== "ceo") {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => ({ orders: await listWarehouseOrders({ data: {} }) }),
  component: WarehousePage,
});

type WarehouseOrder = Awaited<ReturnType<typeof listWarehouseOrders>>[number];

/** Trims floating-point noise for display: 2.50 → "2.5", 3.00 → "3". */
function formatQty(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (status === "placed") {
    return (
      <Badge tone="outline" className="border-gold text-gold">
        {ORDER_STATUS_LABEL.placed}
      </Badge>
    );
  }
  if (status === "sent") return <Badge tone="pop">{ORDER_STATUS_LABEL.sent}</Badge>;
  if (status === "cancelled") return <Badge tone="neutral">{ORDER_STATUS_LABEL.cancelled}</Badge>;
  return <Badge tone="outline">{ORDER_STATUS_LABEL.received}</Badge>;
}

// ── page ─────────────────────────────────────────────────────────────────

function WarehousePage() {
  const { orders } = Route.useLoaderData();
  const placedOrders = orders.filter((o) => o.status === "placed");

  return (
    <div>
      <PageHeader kicker="Every branch's orders, one queue" title="Warehouse" />
      <WaitingQueue orders={placedOrders} />
      <HistorySection orders={orders} />
    </div>
  );
}

// ── zone 1: waiting to go out ────────────────────────────────────────────

function WaitingQueue({ orders }: { orders: WarehouseOrder[] }) {
  return (
    <Card raised>
      <CardHeader>
        <CardTitle>Waiting to go out</CardTitle>
        {orders.length > 0 ? (
          <Badge tone="outline" className="border-gold text-gold">
            {orders.length}
          </Badge>
        ) : null}
      </CardHeader>
      <CardBody>
        {orders.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No orders waiting"
            hint="No orders waiting — the branches are stocked."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {orders.map((order) => (
              <PlacedOrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function PlacedOrderCard({ order }: { order: WarehouseOrder }) {
  const router = useRouter();
  const markSentFn = useServerFn(markOrderSent);
  const [sending, setSending] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const i of order.items) {
      initial[i.orderItemId] = String(i.quantityOrdered);
    }
    return initial;
  });
  const [sentNote, setSentNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await markSentFn({
        data: {
          orderId: order.id,
          items: order.items.map((i) => ({
            orderItemId: i.orderItemId,
            quantitySent: Number(sending[i.orderItemId] ?? 0),
          })),
          sentNote: sentNote.trim() || undefined,
        },
      });
      toast.success(`${order.locationName} — marked as sent`);
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't mark as sent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-2 border-foreground/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl uppercase leading-none text-foreground">
            {order.locationName}
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            {formatDateTime(order.placedAt)} · {order.placedByName}
          </p>
        </div>
      </div>

      {order.note ? (
        <p className="mt-3 border-2 border-foreground/15 px-3 py-2 text-sm text-foreground">
          {order.note}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col divide-y divide-foreground/10 border-t-2 border-foreground/10">
        {order.items.map((item) => (
          <div key={item.orderItemId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-bold text-foreground">{item.name}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                Ordered {formatQty(item.quantityOrdered)} {item.unit}
              </p>
            </div>
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              className="w-24 text-right"
              value={sending[item.orderItemId] ?? ""}
              onChange={(e) => setSending((s) => ({ ...s, [item.orderItemId]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <Field label="Sent note (optional)" className="mt-4" hint="e.g. Chicken short — 4 of 6">
        <Input
          value={sentNote}
          onChange={(e) => setSentNote(e.target.value)}
          placeholder="Chicken short — 4 of 6"
        />
      </Field>

      <Button className="mt-4 w-full" disabled={busy} onClick={submit}>
        <Truck /> Mark as sent
      </Button>
    </div>
  );
}

// ── zone 2: on the van / history ─────────────────────────────────────────

const STATUS_CHIPS: Array<{ key: "all" | OrderStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "placed", label: "Placed" },
  { key: "sent", label: "On the van" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
];

const DEFAULT_HISTORY_STATUSES: OrderStatus[] = ["sent", "received", "cancelled"];

function HistorySection({ orders }: { orders: WarehouseOrder[] }) {
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");

  const filtered =
    filter === "all"
      ? orders.filter((o) => DEFAULT_HISTORY_STATUSES.includes(o.status))
      : orders.filter((o) => o.status === filter);

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>On the van / history</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={cn(
                "border-2 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer",
                filter === chip.key
                  ? "border-foreground bg-pop text-ink"
                  : "border-foreground/25 text-muted-foreground hover:border-foreground/50 hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="Nothing here"
            hint="No orders match this filter."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((order) => (
              <HistoryRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryRow({ order }: { order: WarehouseOrder }) {
  const [expanded, setExpanded] = useState(false);
  const hasShortfall =
    order.status === "received" &&
    order.items.some((i) => (i.quantityReceived ?? 0) < (i.quantitySent ?? i.quantityOrdered));

  const subtitle =
    order.status === "sent" && order.sentAt
      ? `On the van since ${formatDateTime(order.sentAt)}`
      : order.status === "received" && order.receivedAt
        ? `Received ${formatDateTime(order.receivedAt)}`
        : `Placed ${formatDateTime(order.placedAt)}`;

  return (
    <div className="border-2 border-foreground/15">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-all hover:bg-muted/30"
      >
        <div className="min-w-0">
          <p className="font-bold text-foreground">{order.locationName}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasShortfall ? <Badge tone="danger">Shortfall</Badge> : null}
          <OrderStatusBadge status={order.status} />
        </div>
      </button>

      {expanded ? (
        <div className="overflow-x-auto border-t-2 border-foreground/15">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b-2 border-foreground/15 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <th className="px-3 py-2">Item</th>
                <th className="px-2 py-2 text-right">Ordered</th>
                <th className="px-2 py-2 text-right">Sent</th>
                <th className="px-2 py-2 text-right">Received</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const short =
                  order.status === "received" &&
                  (item.quantityReceived ?? 0) < (item.quantitySent ?? item.quantityOrdered);
                return (
                  <tr
                    key={item.orderItemId}
                    className="border-b border-foreground/10 last:border-b-0"
                  >
                    <td className="px-3 py-2.5 font-bold text-foreground">{item.name}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-xs">
                      {formatQty(item.quantityOrdered)} {item.unit}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-xs">
                      {item.quantitySent != null
                        ? `${formatQty(item.quantitySent)} ${item.unit}`
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right font-mono text-xs",
                        short && "font-bold text-destructive",
                      )}
                    >
                      {item.quantityReceived != null
                        ? `${formatQty(item.quantityReceived)} ${item.unit}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {order.note ? (
            <p className="border-t border-foreground/10 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              Branch note: {order.note}
            </p>
          ) : null}
          {order.sentNote ? (
            <p className="border-t border-foreground/10 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              Warehouse note: {order.sentNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
