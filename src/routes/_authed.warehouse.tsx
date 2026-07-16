import { useEffect, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Package, PackageCheck, Pencil, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { DownloadPdfButton, PrintReport } from "@/components/print-report";
import {
  listWarehouseOrders,
  markOrderSent,
  reportOrderIssue,
  resolveOrderIssue,
  setItemLoaded,
} from "@/server/orders";
import {
  createWarehouseProduct,
  listWarehouseCatalog,
  setWarehouseProductActive,
  setWarehouseProductAvailable,
  updateWarehouseProduct,
} from "@/server/warehouse";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Warehouse — the warehouse's own catalog (what branches are allowed to
 * order) plus every branch's orders in one queue. Pack the van (adjust
 * quantities down if something's short), mark it sent, then watch it move
 * to "on the van" and, once the branch counts it in, "received".
 */

export const Route = createFileRoute("/_authed/warehouse")({
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "warehouse" && context.actor.role !== "ceo") {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => ({
    catalog: await listWarehouseCatalog(),
    orders: await listWarehouseOrders({ data: {} }),
  }),
  component: WarehousePage,
});

type WarehouseOrder = Awaited<ReturnType<typeof listWarehouseOrders>>[number];
type CatalogProduct = Awaited<ReturnType<typeof listWarehouseCatalog>>[number];

/** An order has a shortfall when the warehouse sent less than ordered, or
 * the branch received less than was sent. */
function orderHasShortfall(order: WarehouseOrder): boolean {
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
  const { catalog, orders } = Route.useLoaderData();
  const placedOrders = orders.filter((o) => o.status === "placed");

  return (
    <div>
      <PageHeader
        kicker="Every branch's orders, one queue"
        title="Warehouse"
        actions={<DownloadPdfButton label="Download PDF" />}
      />
      <CatalogSection catalog={catalog} />
      <WaitingQueue orders={placedOrders} />
      <HistorySection orders={orders} />
      <WarehouseOrdersReport catalog={catalog} orders={orders} />
    </div>
  );
}

// ── zone 0: my catalog ───────────────────────────────────────────────────

function CatalogSection({ catalog }: { catalog: CatalogProduct[] }) {
  const router = useRouter();
  const setAvailableFn = useServerFn(setWarehouseProductAvailable);
  const [addOpen, setAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const activeProducts = catalog.filter((p) => p.active);

  async function toggleAvailable(product: CatalogProduct, available: boolean) {
    setOptimistic((s) => ({ ...s, [product.id]: available }));
    try {
      await setAvailableFn({ data: { id: product.id, available } });
      router.invalidate();
    } catch (e) {
      setOptimistic((s) => ({ ...s, [product.id]: !available }));
      toast.error(e instanceof Error ? e.message : "Couldn't update product");
    }
  }

  return (
    <Card raised>
      <CardHeader>
        <CardTitle>My catalog</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Add product
        </Button>
      </CardHeader>
      <CardBody>
        {activeProducts.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            hint="Add the products you carry so branches can order them."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {activeProducts.map((product) => {
              const available = optimistic[product.id] ?? product.available;
              return (
                <div
                  key={product.id}
                  className={cn(
                    "flex flex-col gap-3 border-2 px-4 py-3 transition-all",
                    available ? "border-foreground/20" : "border-foreground/10 opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-foreground">{product.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {product.quantity != null
                          ? `${formatQty(product.quantity)} ${product.unit} held`
                          : product.unit}
                      </p>
                      {product.supplier ? (
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {product.supplier}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditingProduct(product)}
                    >
                      <Pencil />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t-2 border-foreground/10 pt-3">
                    {available ? (
                      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-foreground">
                        Available
                      </span>
                    ) : (
                      <Badge tone="neutral">Out of stock</Badge>
                    )}
                    <Switch
                      checked={available}
                      onCheckedChange={(v) => toggleAvailable(product, v)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

      <AddProductDialog open={addOpen} onOpenChange={setAddOpen} />
      <EditProductDialog
        product={editingProduct}
        onOpenChange={(v) => !v && setEditingProduct(null)}
      />
    </Card>
  );
}

function AddProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createFn = useServerFn(createWarehouseProduct);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState("");

  function reset() {
    setName("");
    setUnit("kg");
    setQuantity("");
    setSupplier("");
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Product name is required");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          name: trimmedName,
          unit: unit.trim() || "kg",
          quantity: quantity.trim() ? Number(quantity) : undefined,
          supplier: supplier.trim() || undefined,
        },
      });
      toast.success(`${trimmedName} added to the catalog`);
      reset();
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent title="Add product">
        <div className="flex flex-col gap-5">
          <Field label="Product name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Chicken breast"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg" />
            </Field>
            <Field label="Quantity held (optional)">
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <Field label="Supplier (optional)">
            <Input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Bookers"
            />
          </Field>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Adding…" : "Add product"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({
  product,
  onOpenChange,
}: {
  product: CatalogProduct | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const updateFn = useServerFn(updateWarehouseProduct);
  const setActiveFn = useServerFn(setWarehouseProductActive);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState("");

  useEffect(() => {
    if (product) {
      setName(product.name);
      setUnit(product.unit);
      setQuantity(product.quantity != null ? String(product.quantity) : "");
      setSupplier(product.supplier ?? "");
    }
  }, [product]);

  async function submit() {
    if (!product) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Product name is required");
      return;
    }
    setBusy(true);
    try {
      await updateFn({
        data: {
          id: product.id,
          patch: {
            name: trimmedName,
            unit: unit.trim() || "kg",
            quantity: quantity.trim() ? Number(quantity) : null,
            supplier: supplier.trim() || null,
          },
        },
      });
      toast.success("Product updated");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save changes");
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!product) return;
    if (!window.confirm(`Retire ${product.name}? Branches will no longer be able to order it.`)) {
      return;
    }
    setBusy(true);
    try {
      await setActiveFn({ data: { id: product.id, active: false } });
      toast.success(`${product.name} retired`);
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't retire product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent title={product?.name ?? "Edit product"}>
        <div className="flex flex-col gap-5">
          <Field label="Product name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <Field label="Quantity held">
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Supplier">
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={retire}>
            Retire product
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── PDF export ───────────────────────────────────────────────────────────

function itemsSummary(order: WarehouseOrder): string {
  return order.items.map((i) => `${i.name} ${formatQty(i.quantityOrdered)}${i.unit}`).join(", ");
}

function shortfallSummary(order: WarehouseOrder): string {
  const shortfalls = order.items.filter((i) => {
    if (order.status === "placed" || order.status === "cancelled") return false;
    const sent = i.quantitySent ?? i.quantityOrdered;
    if (sent < i.quantityOrdered) return true;
    if (order.status === "received" && (i.quantityReceived ?? 0) < sent) return true;
    return false;
  });
  if (shortfalls.length === 0) return "—";
  return shortfalls.map((i) => i.name).join(", ");
}

function WarehouseOrdersReport({
  catalog,
  orders,
}: {
  catalog: CatalogProduct[];
  orders: WarehouseOrder[];
}) {
  const recent = orders.slice(0, 30);
  const activeCatalog = catalog.filter((p) => p.active);
  return (
    <PrintReport
      title="Warehouse orders"
      subtitle={new Date().toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "long",
        year: "numeric",
      })}
    >
      {activeCatalog.length > 0 ? (
        <>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[#6e6455]">
            My catalog
          </p>
          <table className="mb-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[#1b1510]/20 text-left text-xs font-bold uppercase tracking-widest">
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Supplier</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeCatalog.map((product) => (
                <tr key={product.id} className="border-b border-[#1b1510]/10">
                  <td className="py-2 pr-3 font-bold">{product.name}</td>
                  <td className="py-2 pr-3">{product.unit}</td>
                  <td className="py-2 pr-3">{product.supplier ?? "—"}</td>
                  <td className="py-2 pr-3">{product.available ? "Available" : "Out of stock"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-[#1b1510] text-left text-xs font-bold uppercase tracking-widest">
            <th className="py-2 pr-3">Site</th>
            <th className="py-2 pr-3">Placed</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Items</th>
            <th className="py-2 pr-3">Shortfalls</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((order) => (
            <tr key={order.id} className="border-b border-[#1b1510]/15 align-top">
              <td className="py-2 pr-3 font-bold">{order.locationName}</td>
              <td className="py-2 pr-3">{formatDateTime(order.placedAt)}</td>
              <td className="py-2 pr-3">{ORDER_STATUS_LABEL[order.status]}</td>
              <td className="py-2 pr-3">{itemsSummary(order)}</td>
              <td className="py-2 pr-3">{shortfallSummary(order)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintReport>
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
              <LoadingChecklistCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The packing checklist: one big tappable row per item. Ticking = it's
 * going on the van. Each tick is persisted immediately (`setItemLoaded`) so
 * a half-packed order survives a refresh or a different packer picking it
 * back up — but ticking never invalidates/refetches the page, it just
 * updates local state optimistically.
 */
function LoadingChecklistCard({ order }: { order: WarehouseOrder }) {
  const router = useRouter();
  const setLoadedFn = useServerFn(setItemLoaded);
  const markSentFn = useServerFn(markOrderSent);

  const [loaded, setLoaded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const i of order.items) initial[i.orderItemId] = i.loaded;
    return initial;
  });
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const i of order.items) initial[i.orderItemId] = String(i.quantityOrdered);
    return initial;
  });
  const [sentNote, setSentNote] = useState("");
  const [busy, setBusy] = useState(false);

  const total = order.items.length;
  const loadedCount = order.items.filter((i) => loaded[i.orderItemId]).length;

  async function toggle(orderItemId: string) {
    const next = !loaded[orderItemId];
    setLoaded((s) => ({ ...s, [orderItemId]: next }));
    try {
      await setLoadedFn({ data: { orderItemId, loaded: next } });
    } catch (e) {
      setLoaded((s) => ({ ...s, [orderItemId]: !next }));
      toast.error(e instanceof Error ? e.message : "Couldn't save the tick");
    }
  }

  async function submit() {
    if (loadedCount === 0) {
      const ok = window.confirm(
        "Nothing's ticked — mark this order as sent with everything unavailable?",
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await markSentFn({
        data: {
          orderId: order.id,
          items: order.items.map((i) => ({
            orderItemId: i.orderItemId,
            loaded: !!loaded[i.orderItemId],
            quantitySent: loaded[i.orderItemId] ? Number(qty[i.orderItemId] ?? 0) || 0 : 0,
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
        <Badge
          tone={loadedCount === total && total > 0 ? "success" : "outline"}
          className={loadedCount === total && total > 0 ? "" : "border-gold text-gold"}
        >
          {loadedCount}/{total} loaded
        </Badge>
      </div>

      {order.note ? (
        <p className="mt-3 border-2 border-foreground/15 px-3 py-2 text-sm text-foreground">
          {order.note}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t-2 border-foreground/10 pt-4">
        {order.items.map((item) => {
          const isLoaded = !!loaded[item.orderItemId];
          return (
            <div
              key={item.orderItemId}
              className={cn(
                "flex items-center gap-3 border-2 px-3 py-3 transition-all",
                isLoaded ? "border-pop bg-pop/10" : "border-foreground/15",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(item.orderItemId)}
                className="flex flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center border-2",
                    isLoaded ? "border-pop bg-pop text-ink" : "border-foreground/40",
                  )}
                >
                  {isLoaded ? <Check className="size-5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate font-bold",
                      isLoaded ? "text-foreground" : "text-muted-foreground line-through",
                    )}
                  >
                    {item.name}
                  </span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    Ordered {formatQty(item.quantityOrdered)} {item.unit}
                  </span>
                </span>
              </button>

              {isLoaded ? (
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  className="w-24 shrink-0 text-right"
                  value={qty[item.orderItemId] ?? ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setQty((q) => ({ ...q, [item.orderItemId]: e.target.value }))}
                />
              ) : (
                <Badge tone="neutral" className="shrink-0">
                  Not available
                </Badge>
              )}
            </div>
          );
        })}
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
  const hasShortfall = orderHasShortfall(order);

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
                const unavailable = item.quantitySent === 0;
                const sentShort =
                  (order.status === "sent" || order.status === "received") &&
                  (item.quantitySent ?? item.quantityOrdered) < item.quantityOrdered;
                const receivedShort =
                  order.status === "received" &&
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
                      {unavailable ? (
                        <span className="ml-2 font-mono text-[9px] font-bold uppercase tracking-widest">
                          Unavailable
                        </span>
                      ) : null}
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
          {hasShortfall ? (
            <div className="border-t border-foreground/10 px-3 py-3">
              <IssuePanel order={order} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Delivery-issue reason + resolution, shown once an order has a shortfall. */
function IssuePanel({ order }: { order: WarehouseOrder }) {
  const router = useRouter();
  const reportFn = useServerFn(reportOrderIssue);
  const resolveFn = useServerFn(resolveOrderIssue);
  const [reason, setReason] = useState(order.issueReason ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (order.issueResolvedAt) {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Resolved by {order.issueResolvedByName ?? "Unknown"}
        </p>
        {order.issueReason ? (
          <p className="text-xs text-muted-foreground">{order.issueReason}</p>
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
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
        Delivery issue — {order.locationName}
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
