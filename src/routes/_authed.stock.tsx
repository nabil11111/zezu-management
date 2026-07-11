import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Minus, PartyPopper, Pencil, Plus, Boxes } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocations } from "@/server/locations";
import {
  getStockOverview,
  createStockItem,
  updateStockItem,
  setStockItemActive,
  logMove,
  logDayUsage,
} from "@/server/stock";
import { cn } from "@/lib/utils";

/**
 * Stock — "know tonight what you'll run out of tomorrow". Three zones:
 * a hero "log tonight's usage / delivery" tile grid, the running levels
 * table (with add/edit/active-toggle), and the order list grouped by
 * supplier with a one-tap "copy order" for texting the wholesaler.
 */

export const Route = createFileRoute("/_authed/stock")({
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
    const overview = locationId ? await getStockOverview({ data: { locationId } }) : null;
    return { locations, locationId, overview };
  },
  component: StockPage,
});

type Overview = Awaited<ReturnType<typeof getStockOverview>>;
type StockItemRow = Overview["items"][number];
type OrderGroup = Overview["orderList"][number];
type MoveRow = Overview["recentMoves"][number];
type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];
type Mode = "usage" | "delivery";

/** Trims floating-point noise for display: 2.50 → "2.5", 3.00 → "3". */
function formatQty(n: number): string {
  return Number(n.toFixed(2)).toString();
}

// ── page ─────────────────────────────────────────────────────────────────

function StockPage() {
  const { locations, locationId, overview } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  function selectLocation(id: string) {
    navigate({ search: (prev) => ({ ...prev, location: id }) });
  }

  const currentLocation = locations.find((l) => l.id === locationId);

  return (
    <div>
      <PageHeader
        kicker="Know tonight what you'll run out of tomorrow"
        title="Stock"
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

      {!locationId || !overview ? (
        <EmptyState
          icon={Boxes}
          title="No shop set up yet"
          hint="Ask the CEO to add a location before logging stock."
        />
      ) : (
        <>
          <UsageLogCard locationId={locationId} items={overview.items} />
          <RunningLevelsCard locationId={locationId} items={overview.items} />
          <OrderListCard
            orderList={overview.orderList}
            locationName={currentLocation?.name ?? "ZEZU"}
          />
          <RecentMovesCard moves={overview.recentMoves} />
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

// ── zone 1: log tonight's usage (the hero flow) ─────────────────────────

function UsageLogCard({ locationId, items }: { locationId: string; items: StockItemRow[] }) {
  const router = useRouter();
  const logDayUsageFn = useServerFn(logDayUsage);
  const logMoveFn = useServerFn(logMove);
  const [mode, setMode] = useState<Mode>("usage");
  const [staged, setStaged] = useState<Record<string, number>>({});
  const [openItem, setOpenItem] = useState<StockItemRow | null>(null);
  const [busy, setBusy] = useState(false);

  const active = items.filter((i) => i.active);
  const stagedEntries = Object.entries(staged).filter(([, q]) => q > 0);
  const stagedCount = stagedEntries.length;

  function switchMode(next: Mode) {
    setMode(next);
    setStaged({});
  }

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
      if (mode === "usage") {
        await logDayUsageFn({
          data: {
            locationId,
            entries: stagedEntries.map(([stockItemId, quantity]) => ({ stockItemId, quantity })),
          },
        });
      } else {
        await Promise.all(
          stagedEntries.map(([stockItemId, quantity]) =>
            logMoveFn({ data: { stockItemId, kind: "delivery", quantity } }),
          ),
        );
      }
      toast.success(`Logged ${stagedCount} item${stagedCount === 1 ? "" : "s"}`);
      setStaged({});
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card raised className={cn(mode === "delivery" && "border-gold")}>
      <CardHeader>
        <CardTitle>Log tonight's usage</CardTitle>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "font-mono text-[10px] font-bold uppercase tracking-widest",
              mode === "usage" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Usage
          </span>
          <Switch
            checked={mode === "delivery"}
            onCheckedChange={(v) => switchMode(v ? "delivery" : "usage")}
          />
          <span
            className={cn(
              "font-mono text-[10px] font-bold uppercase tracking-widest",
              mode === "delivery" ? "text-gold" : "text-muted-foreground",
            )}
          >
            Delivery
          </span>
        </div>
      </CardHeader>
      <CardBody>
        {active.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No active items"
            hint="Add stock items below to start logging."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {active.map((item) => {
                const qty = staged[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOpenItem(item)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start gap-1 border-2 px-3 py-3 text-left transition-all",
                      qty
                        ? mode === "usage"
                          ? "border-destructive bg-destructive/10"
                          : "border-gold bg-gold/10"
                        : "border-foreground/20 hover:border-foreground/50",
                    )}
                  >
                    <span className="w-full truncate text-sm font-bold text-foreground">
                      {item.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatQty(item.level)} {item.unit} on hand
                    </span>
                    {qty ? (
                      <span
                        className={cn(
                          "font-mono text-xs font-bold",
                          mode === "usage" ? "text-destructive" : "text-gold",
                        )}
                      >
                        {mode === "usage" ? "−" : "+"}
                        {formatQty(qty)} {item.unit}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="sticky bottom-4 z-10 mt-5">
              <Button className="w-full" disabled={stagedCount === 0 || busy} onClick={submit}>
                {mode === "usage" ? <Minus /> : <Plus />}
                {stagedCount === 0
                  ? `Log ${mode === "usage" ? "usage" : "delivery"}`
                  : `Log ${stagedCount} item${stagedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </CardBody>

      <QtyDialog
        item={openItem}
        mode={mode}
        initialQty={openItem ? (staged[openItem.id] ?? 0) : 0}
        onOpenChange={(open) => !open && setOpenItem(null)}
        onStage={(qty) => {
          if (openItem) stage(openItem.id, qty);
          setOpenItem(null);
        }}
      />
    </Card>
  );
}

const QUICK_AMOUNTS = [0.5, 1, 2, 5];

function QtyDialog({
  item,
  mode,
  initialQty,
  onOpenChange,
  onStage,
}: {
  item: StockItemRow | null;
  mode: Mode;
  initialQty: number;
  onOpenChange: (open: boolean) => void;
  onStage: (qty: number) => void;
}) {
  const [qty, setQty] = useState(initialQty > 0 ? String(initialQty) : "");

  useEffect(() => {
    setQty(initialQty > 0 ? String(initialQty) : "");
  }, [item, initialQty]);

  const numericQty = Number(qty);
  const step = (delta: number) => setQty((q) => String(Math.max(0, (Number(q) || 0) + delta)));

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={item?.name ?? "Quantity"}
        description={item ? `${formatQty(item.level)} ${item.unit} on hand` : undefined}
      >
        <div className="flex flex-col gap-5">
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

          <div className="flex flex-wrap justify-center gap-3">
            {QUICK_AMOUNTS.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQty(String(q))}
              >
                {q} {item?.unit}
              </Button>
            ))}
          </div>

          <Button
            className="w-full"
            disabled={!qty || numericQty <= 0}
            onClick={() => onStage(numericQty || 0)}
          >
            {mode === "usage" ? "Stage usage" : "Stage delivery"}
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

// ── zone 2: running levels ───────────────────────────────────────────────

function RunningLevelsCard({ locationId, items }: { locationId: string; items: StockItemRow[] }) {
  const router = useRouter();
  const setActiveFn = useServerFn(setStockItemActive);
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItemRow | null>(null);

  async function toggleActive(item: StockItemRow, active: boolean) {
    try {
      await setActiveFn({ data: { id: item.id, active } });
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update item");
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Running levels</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Add item
        </Button>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b-2 border-foreground/15 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right">Level</th>
              <th className="px-3 py-2.5">Supplier</th>
              <th className="px-3 py-2.5" />
              <th className="px-3 py-2.5 text-center">Active</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No stock items yet — add the first one.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className={cn("border-b border-foreground/10", !item.active && "opacity-50")}
                >
                  <td className="px-4 py-3 font-bold text-foreground">{item.name}</td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right font-mono text-sm font-bold",
                      item.level < 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {formatQty(item.level)} {item.unit}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {item.supplier ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {item.isLow ? (
                      <Badge tone="outline" className="border-gold text-gold">
                        Low
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Switch checked={item.active} onCheckedChange={(v) => toggleActive(item, v)} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditingItem(item)}>
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AddItemDialog locationId={locationId} open={addOpen} onOpenChange={setAddOpen} />
      <EditItemDialog item={editingItem} onOpenChange={(v) => !v && setEditingItem(null)} />
    </Card>
  );
}

function AddItemDialog({
  locationId,
  open,
  onOpenChange,
}: {
  locationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createFn = useServerFn(createStockItem);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [lowThreshold, setLowThreshold] = useState("");
  const [supplier, setSupplier] = useState("");
  const [initialLevel, setInitialLevel] = useState("");

  function reset() {
    setName("");
    setUnit("kg");
    setLowThreshold("");
    setSupplier("");
    setInitialLevel("");
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Item name is required");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          locationId,
          name: trimmedName,
          unit: unit.trim() || "kg",
          lowThreshold: lowThreshold.trim() ? Number(lowThreshold) : null,
          supplier: supplier.trim() || null,
          initialLevel: initialLevel.trim() ? Number(initialLevel) : undefined,
        },
      });
      toast.success(`${trimmedName} added`);
      reset();
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add item");
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
      <DialogContent title="Add stock item">
        <div className="flex flex-col gap-5">
          <Field label="Item name">
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
            <Field label="Low threshold" hint="Flag when level drops to this or below">
              <Input
                inputMode="decimal"
                value={lowThreshold}
                onChange={(e) => setLowThreshold(e.target.value)}
                placeholder="5"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Supplier (optional)">
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Bookers"
              />
            </Field>
            <Field label="Starting level (optional)">
              <Input
                inputMode="decimal"
                value={initialLevel}
                onChange={(e) => setInitialLevel(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Adding…" : "Add item"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditItemDialog({
  item,
  onOpenChange,
}: {
  item: StockItemRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const updateFn = useServerFn(updateStockItem);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [lowThreshold, setLowThreshold] = useState("");
  const [supplier, setSupplier] = useState("");

  useEffect(() => {
    if (item) {
      setName(item.name);
      setUnit(item.unit);
      setLowThreshold(item.lowThreshold != null ? String(item.lowThreshold) : "");
      setSupplier(item.supplier ?? "");
    }
  }, [item]);

  async function submit() {
    if (!item) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Item name is required");
      return;
    }
    setBusy(true);
    try {
      await updateFn({
        data: {
          id: item.id,
          patch: {
            name: trimmedName,
            unit: unit.trim() || "kg",
            lowThreshold: lowThreshold.trim() ? Number(lowThreshold) : null,
            supplier: supplier.trim() || null,
          },
        },
      });
      toast.success("Item updated");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent title={item?.name ?? "Edit item"}>
        <div className="flex flex-col gap-5">
          <Field label="Item name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <Field label="Low threshold">
              <Input
                inputMode="decimal"
                value={lowThreshold}
                onChange={(e) => setLowThreshold(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Supplier">
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── zone 3: order list ───────────────────────────────────────────────────

function OrderListCard({
  orderList,
  locationName,
}: {
  orderList: OrderGroup[];
  locationName: string;
}) {
  const hasLow = orderList.length > 0;
  return (
    <Card className="mt-8" raised={hasLow}>
      <CardHeader>
        <CardTitle>Order list</CardTitle>
      </CardHeader>
      <CardBody>
        {!hasLow ? (
          <EmptyState icon={PartyPopper} title="Nothing's running out. Sleep easy." />
        ) : (
          <div className="flex flex-col gap-5">
            {orderList.map((group) => (
              <SupplierGroup key={group.supplier} group={group} locationName={locationName} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SupplierGroup({ group, locationName }: { group: OrderGroup; locationName: string }) {
  function copyOrder() {
    const today = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const lines = group.items.map((i) => `- ${formatQty(i.suggestedQty)} ${i.unit} ${i.name}`);
    const message = [`${locationName} — order`, today, "", ...lines].join("\n");
    navigator.clipboard.writeText(message);
    toast.success(`${group.supplier} order copied`);
  }

  return (
    <div className="border-2 border-gold/60">
      <div className="flex items-center justify-between border-b-2 border-gold/60 bg-gold/10 px-3 py-2.5">
        <span className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          {group.supplier}
        </span>
        <Button size="sm" variant="outline" onClick={copyOrder}>
          <Copy /> Copy order
        </Button>
      </div>
      <ul className="divide-y divide-foreground/10">
        {group.items.map((i) => (
          <li key={i.name} className="flex items-center justify-between px-3 py-3 text-sm">
            <span className="text-foreground">{i.name}</span>
            <span className="font-mono text-xs font-bold text-gold">
              {formatQty(i.suggestedQty)} {i.unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── recent moves feed ────────────────────────────────────────────────────

const MOVE_META: Record<MoveRow["kind"], { glyph: string; cls: string }> = {
  usage: { glyph: "↓", cls: "text-destructive" },
  delivery: { glyph: "↑", cls: "text-gold" },
  adjustment: { glyph: "±", cls: "text-muted-foreground" },
};

function moveAmountLabel(m: MoveRow): string {
  if (m.kind === "usage") return `−${formatQty(m.quantity)} ${m.unit}`;
  if (m.kind === "delivery") return `+${formatQty(m.quantity)} ${m.unit}`;
  return `${m.quantity >= 0 ? "+" : ""}${formatQty(m.quantity)} ${m.unit}`;
}

function RecentMovesCard({ moves }: { moves: MoveRow[] }) {
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Recent moves</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col p-0">
        {moves.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          moves.map((m) => {
            const meta = MOVE_META[m.kind];
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center border-2 border-current font-mono text-xs font-bold",
                    meta.cls,
                  )}
                >
                  {meta.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{m.itemName}</p>
                  {m.note ? (
                    <p className="truncate text-xs text-muted-foreground">{m.note}</p>
                  ) : null}
                </div>
                <span className={cn("shrink-0 font-mono text-xs font-bold", meta.cls)}>
                  {moveAmountLabel(m)}
                </span>
                <span className="w-20 shrink-0 truncate text-right font-mono text-[10px] uppercase text-muted-foreground">
                  {m.byName ?? "—"}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-[9px] uppercase text-muted-foreground/60">
                  {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
