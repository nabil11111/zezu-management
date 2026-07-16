import { useEffect, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Minus, Plus, PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocations } from "@/server/locations";
import {
  getOrderBoard,
  placeOrder,
  cancelOrder,
  confirmReceipt,
  reportOrderIssue,
  resolveOrderIssue,
  setItemUnloaded,
} from "@/server/orders";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Orders — the branch side. Place today's order against the running stock
 * levels, then watch it move: placed → sent → received. Verifying what came
 * off the van is the whole point: that's the only step that updates levels.
 */

export const Route = createFileRoute("/_authed/orders")({
  beforeLoad: ({ context }) => {
    if (context.actor.role === "warehouse") throw redirect({ to: "/warehouse" });
  },
  validateSearch: (s: Record<string, unknown>): { location?: string } => ({
    location: typeof s.location === "string" ? s.location : undefined,
  }),
  loaderDeps: ({ search }) => ({ location: search.location }),
  loader: async ({ deps }) => {
    const locations = await listLocations();
    const locationId =
      deps.location && locations.some((l) => l.id === deps.location)
        ? deps.location
        : (locations[0]?.id ?? null);
    const board = locationId ? await getOrderBoard({ data: { locationId } }) : null;
    return { locations, locationId, board };
  },
  component: OrdersPage,
});

type Board = Awaited<ReturnType<typeof getOrderBoard>>;
type CatalogProduct = Board["catalog"][number];
type OrderRow = Board["orders"][number];
type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];

/** Trims floating-point noise for display: 2.50 → "2.5", 3.00 → "3". */
function formatQty(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** An order has a shortfall when the warehouse sent less than ordered, or
 * the branch received less than was sent. */
function orderHasShortfall(order: OrderRow): boolean {
  return order.items.some((i) => {
    const sentShort =
      (order.status === "sent" || order.status === "received") &&
      (i.quantitySent ?? i.quantityOrdered) < i.quantityOrdered;
    const receivedShort =
      order.status === "received" &&
      (i.quantityReceived ?? 0) < (i.quantitySent ?? i.quantityOrdered);
    return sentShort || receivedShort;
  });
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

function OrdersPage() {
  const { locations, locationId, board } = Route.useLoaderData();
  const { actor, capabilities } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const canPlaceOrders = actor.role === "ceo" || capabilities.includes("place_orders");

  function selectLocation(id: string) {
    navigate({ search: (prev) => ({ ...prev, location: id }) });
  }

  return (
    <div>
      <PageHeader
        kicker="Branch → warehouse, verified off the van"
        title="Orders"
        actions={
          locations.length > 1 ? (
            <LocationPicker
              locations={locations}
              value={locationId ?? ""}
              onChange={selectLocation}
            />
          ) : null
        }
      />

      {!locationId || !board ? (
        <EmptyState
          icon={PackageCheck}
          title="No shop set up yet"
          hint="Ask the CEO to add a location before placing orders."
        />
      ) : (
        <>
          {canPlaceOrders ? (
            <PlaceOrderCard locationId={locationId} catalog={board.catalog} />
          ) : (
            <Card raised>
              <CardBody>
                <p className="text-sm text-muted-foreground">
                  You don't have permission to place orders — ask a manager to enable it on your
                  code.
                </p>
              </CardBody>
            </Card>
          )}
          <OrderHistoryCard locationId={locationId} orders={board.orders} />
        </>
      )}
    </div>
  );
}

function LocationPicker({
  locations,
  value,
  onChange,
}: {
  locations: LocationRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── zone 1: place today's order ─────────────────────────────────────────

const QUICK_AMOUNTS = [0.5, 1, 2, 5, 10];

function PlaceOrderCard({
  locationId,
  catalog,
}: {
  locationId: string;
  catalog: CatalogProduct[];
}) {
  const router = useRouter();
  const placeOrderFn = useServerFn(placeOrder);
  const [staged, setStaged] = useState<Record<string, number>>({});
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const stagedEntries = Object.entries(staged).filter(([, q]) => q > 0);
  const stagedCount = stagedEntries.length;

  function stage(id: string, qty: number) {
    setStaged((s) => {
      const next = { ...s };
      if (qty > 0) next[id] = qty;
      else delete next[id];
      return next;
    });
  }

  async function submit() {
    if (stagedEntries.length === 0) return;
    setBusy(true);
    try {
      await placeOrderFn({
        data: {
          locationId,
          note: note.trim() || undefined,
          items: stagedEntries.map(([warehouseProductId, quantity]) => ({
            warehouseProductId,
            quantity,
          })),
        },
      });
      toast.success(`Order sent — ${stagedCount} item${stagedCount === 1 ? "" : "s"}`);
      setStaged({});
      setNote("");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card raised>
      <CardHeader>
        <CardTitle>Place today's order</CardTitle>
      </CardHeader>
      <CardBody>
        {catalog.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="Nothing to order yet"
            hint="The warehouse hasn't listed any products yet."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {catalog.map((product) => {
                const qty = staged[product.id];
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setOpenProduct(product)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start gap-1.5 border-2 px-3 py-3 text-left transition-all",
                      qty
                        ? "border-destructive bg-destructive/10"
                        : "border-foreground/20 hover:border-foreground/50",
                    )}
                  >
                    <span className="truncate text-sm font-bold text-foreground">
                      {product.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {product.unit} · from the warehouse
                    </span>
                    {qty ? (
                      <span className="font-mono text-xs font-bold text-destructive">
                        {formatQty(qty)} {product.unit} staged
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <Field label="Note (optional)" className="mt-5">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the warehouse should know"
              />
            </Field>

            <div className="sticky bottom-4 z-10 mt-5">
              <Button className="w-full" disabled={stagedCount === 0 || busy} onClick={submit}>
                <Truck />
                {stagedCount === 0
                  ? "Send order to warehouse"
                  : `Send order to warehouse — ${stagedCount} item${stagedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </CardBody>

      <OrderQtyDialog
        product={openProduct}
        initialQty={openProduct ? (staged[openProduct.id] ?? 0) : 0}
        onOpenChange={(open) => !open && setOpenProduct(null)}
        onStage={(qty) => {
          if (openProduct) stage(openProduct.id, qty);
          setOpenProduct(null);
        }}
      />
    </Card>
  );
}

function OrderQtyDialog({
  product,
  initialQty,
  onOpenChange,
  onStage,
}: {
  product: CatalogProduct | null;
  initialQty: number;
  onOpenChange: (open: boolean) => void;
  onStage: (qty: number) => void;
}) {
  const [qty, setQty] = useState(initialQty > 0 ? String(initialQty) : "");

  useEffect(() => {
    setQty(initialQty > 0 ? String(initialQty) : "");
  }, [product, initialQty]);

  const numericQty = Number(qty);
  const step = (delta: number) => setQty((q) => String(Math.max(0, (Number(q) || 0) + delta)));

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={product?.name ?? "Quantity"}
        description={
          product
            ? `From the warehouse${product.supplier ? ` · ${product.supplier}` : ""}`
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center gap-3">
            <Button type="button" variant="outline" size="icon" onClick={() => step(-1)}>
              <Minus />
            </Button>
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              className="w-24 text-center text-lg font-bold"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
            <Button type="button" variant="outline" size="icon" onClick={() => step(1)}>
              <Plus />
            </Button>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_AMOUNTS.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQty(String(q))}
              >
                {q} {product?.unit}
              </Button>
            ))}
          </div>

          <Button
            className="w-full"
            disabled={!qty || numericQty <= 0}
            onClick={() => onStage(numericQty || 0)}
          >
            Stage order
          </Button>
          {initialQty > 0 ? (
            <Button type="button" variant="ghost" className="w-full" onClick={() => onStage(0)}>
              Clear
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── zone 2: order history + verification ─────────────────────────────────

function OrderHistoryCard({ locationId, orders }: { locationId: string; orders: OrderRow[] }) {
  const [openOrder, setOpenOrder] = useState<OrderRow | null>(null);

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 p-4">
        {orders.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="No orders yet"
            hint="Place today's order above — it'll show up here."
          />
        ) : (
          orders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setOpenOrder(order)}
              className="flex w-full items-center justify-between gap-3 border-2 border-foreground/15 px-4 py-3 text-left transition-all cursor-pointer hover:border-foreground/40"
            >
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-muted-foreground">
                  {formatDateTime(order.placedAt)} · {order.placedByName}
                </p>
                <p className="mt-1 font-bold text-foreground">
                  {order.items.length} item{order.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {orderHasShortfall(order) ? <Badge tone="danger">Shortfall</Badge> : null}
                <OrderStatusBadge status={order.status} />
              </div>
            </button>
          ))
        )}
      </CardBody>

      <OrderDetailDialog
        order={openOrder}
        locationId={locationId}
        onOpenChange={(open) => !open && setOpenOrder(null)}
      />
    </Card>
  );
}

function OrderDetailDialog({
  order,
  onOpenChange,
}: {
  order: OrderRow | null;
  locationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const cancelOrderFn = useServerFn(cancelOrder);
  const confirmReceiptFn = useServerFn(confirmReceipt);
  const setUnloadedFn = useServerFn(setItemUnloaded);
  const [busy, setBusy] = useState(false);
  const [unloaded, setUnloaded] = useState<Record<string, boolean>>({});
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});

  // Reset the checklist's local state whenever a different (or freshly
  // reloaded) order is opened — restoring whatever's already been ticked.
  useEffect(() => {
    if (order && order.status === "sent") {
      const initialUnloaded: Record<string, boolean> = {};
      const initialQty: Record<string, string> = {};
      for (const item of order.items) {
        initialUnloaded[item.orderItemId] = item.unloaded;
        initialQty[item.orderItemId] = String(item.quantitySent ?? 0);
      }
      setUnloaded(initialUnloaded);
      setReceivedQty(initialQty);
    }
  }, [order]);

  async function doCancel() {
    if (!order) return;
    if (!window.confirm("Cancel this order? The warehouse won't see it.")) return;
    setBusy(true);
    try {
      await cancelOrderFn({ data: { orderId: order.id } });
      toast.success("Order cancelled");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel");
    } finally {
      setBusy(false);
    }
  }

  async function toggleUnloaded(orderItemId: string) {
    const next = !unloaded[orderItemId];
    setUnloaded((s) => ({ ...s, [orderItemId]: next }));
    try {
      await setUnloadedFn({ data: { orderItemId, unloaded: next } });
    } catch (e) {
      setUnloaded((s) => ({ ...s, [orderItemId]: !next }));
      toast.error(e instanceof Error ? e.message : "Couldn't save the tick");
    }
  }

  async function doConfirm() {
    if (!order) return;
    const sentItems = order.items.filter((i) => (i.quantitySent ?? 0) > 0);
    const allTicked = sentItems.every((i) => unloaded[i.orderItemId]);
    if (!allTicked) {
      const ok = window.confirm(
        "Some items aren't ticked off yet — they'll be recorded as not received (0). Continue?",
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await confirmReceiptFn({
        data: {
          orderId: order.id,
          items: order.items.map((item) => ({
            orderItemId: item.orderItemId,
            unloaded: !!unloaded[item.orderItemId],
            quantityReceived: unloaded[item.orderItemId]
              ? Number(receivedQty[item.orderItemId] ?? 0) || 0
              : 0,
          })),
        },
      });
      toast.success("Delivery verified — levels updated");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't verify delivery");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          order
            ? `${ORDER_STATUS_LABEL[order.status]} · ${formatDateTime(order.placedAt)}`
            : "Order"
        }
        wide
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {order ? <OrderStatusBadge status={order.status} /> : null}
            <p className="font-mono text-[10px] text-muted-foreground">
              Placed by {order?.placedByName ?? "—"}
            </p>
          </div>

          {order?.note ? (
            <p className="border-2 border-foreground/15 px-3 py-2 text-sm text-foreground">
              {order.note}
            </p>
          ) : null}

          {order?.status === "sent" ? (
            <div className="flex flex-col gap-2">
              {order.items.map((item) => {
                const sent = item.quantitySent ?? 0;
                if (sent <= 0) {
                  return (
                    <div
                      key={item.orderItemId}
                      className="flex items-center justify-between gap-3 border-2 border-destructive/40 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-muted-foreground line-through">
                          {item.name}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          Ordered {formatQty(item.quantityOrdered)} {item.unit}
                        </p>
                      </div>
                      <Badge tone="danger" className="shrink-0">
                        Not available
                      </Badge>
                    </div>
                  );
                }

                const isChecked = !!unloaded[item.orderItemId];
                return (
                  <div
                    key={item.orderItemId}
                    className={cn(
                      "flex items-center gap-3 border-2 px-3 py-3 transition-all",
                      isChecked ? "border-pop bg-pop/10" : "border-foreground/15",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleUnloaded(item.orderItemId)}
                      className="flex flex-1 cursor-pointer items-center gap-3 text-left"
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center border-2",
                          isChecked ? "border-pop bg-pop text-ink" : "border-foreground/40",
                        )}
                      >
                        {isChecked ? <Check className="size-5" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate font-bold",
                            isChecked ? "text-foreground" : "text-muted-foreground line-through",
                          )}
                        >
                          {item.name}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          Sent {formatQty(sent)} {item.unit}
                        </span>
                      </span>
                    </button>

                    {isChecked ? (
                      <Input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        className="w-24 shrink-0 text-right"
                        value={receivedQty[item.orderItemId] ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setReceivedQty((r) => ({ ...r, [item.orderItemId]: e.target.value }))
                        }
                      />
                    ) : (
                      <Badge tone="neutral" className="shrink-0">
                        Not counted
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto border-2 border-foreground/15">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b-2 border-foreground/15 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-2 py-2 text-right">Ordered</th>
                    <th className="px-2 py-2 text-right">Sent</th>
                    <th className="px-2 py-2 text-right">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {(order?.items ?? []).map((item) => {
                    const unavailable = item.quantitySent === 0;
                    // 'sent' orders render the checklist above, so this table
                    // only ever shows placed/received/cancelled — a shortfall
                    // on the sent quantity only makes sense once received.
                    const sentShort =
                      order?.status === "received" &&
                      (item.quantitySent ?? item.quantityOrdered) < item.quantityOrdered;
                    const receivedShort =
                      order?.status === "received" &&
                      (item.quantityReceived ?? 0) < (item.quantitySent ?? item.quantityOrdered);
                    return (
                      <tr
                        key={item.orderItemId}
                        className="border-b border-foreground/10 last:border-b-0"
                      >
                        <td
                          className={cn(
                            "px-3 py-2.5 font-bold",
                            unavailable ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {item.name}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono text-xs">
                          {formatQty(item.quantityOrdered)} {item.unit}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2.5 text-right font-mono text-xs",
                            sentShort && "font-bold text-destructive",
                          )}
                        >
                          {item.quantitySent != null
                            ? `${formatQty(item.quantitySent)} ${item.unit}`
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2.5 text-right font-mono text-xs",
                            receivedShort && "font-bold text-destructive",
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
            </div>
          )}

          {order?.sentNote ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Warehouse note: {order.sentNote}
            </p>
          ) : null}

          {order && orderHasShortfall(order) ? <IssuePanel order={order} /> : null}

          {order?.status === "placed" ? (
            <Button variant="destructive" disabled={busy} onClick={doCancel}>
              Cancel order
            </Button>
          ) : null}

          {order?.status === "sent" ? (
            <div className="flex flex-col gap-3 border-t-2 border-foreground/15 pt-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Count it off the van — this is what updates your stock levels
              </p>
              <Button disabled={busy} onClick={doConfirm}>
                <PackageCheck /> Confirm delivery
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Delivery-issue reason + resolution, shown once an order has a shortfall. */
function IssuePanel({ order }: { order: OrderRow }) {
  const router = useRouter();
  const reportFn = useServerFn(reportOrderIssue);
  const resolveFn = useServerFn(resolveOrderIssue);
  const [reason, setReason] = useState(order.issueReason ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (order.issueResolvedAt) {
    return (
      <div className="flex flex-col gap-1 border-t-2 border-foreground/15 pt-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Resolved by {order.issueResolvedByName ?? "Unknown"}
        </p>
        {order.issueReason ? (
          <p className="text-sm text-muted-foreground">{order.issueReason}</p>
        ) : null}
      </div>
    );
  }

  async function logReason() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Add a reason");
      return;
    }
    setBusy(true);
    try {
      await reportFn({ data: { orderId: order.id, reason: trimmed } });
      toast.success("Reason logged");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log the reason");
    } finally {
      setBusy(false);
    }
  }

  async function markResolved() {
    setBusy(true);
    try {
      await resolveFn({ data: { orderId: order.id, note: note.trim() || undefined } });
      toast.success("Marked resolved");
      setNote("");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't mark resolved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t-2 border-foreground/15 pt-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
        Delivery issue
      </p>
      <Field label="Reason">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What went wrong?"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={logReason}>
          Log reason
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={markResolved}>
          Mark resolved
        </Button>
      </div>
    </div>
  );
}
