import { useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, QrCode, Printer, RefreshCw, MapPin } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { QrPoster } from "@/components/qr-poster";
import {
  listLocationsAdmin,
  createLocation,
  updateLocation,
  setLocationActive,
  regenerateQrToken,
} from "@/server/locations";
import { listActivity } from "@/server/activity-feed";

/**
 * CEO-only. Locations (the switch-on flow + QR door posters), a live
 * activity feed ("every change is logged with a name and a time — quiet
 * accountability"), and the static brand card.
 */
export const Route = createFileRoute("/_authed/settings")({
  beforeLoad: ({ context }) => {
    if (context.actor.role !== "ceo") throw redirect({ to: "/" });
  },
  loader: async () => {
    const [locations, activity] = await Promise.all([
      listLocationsAdmin(),
      listActivity({ data: { limit: 30 } }),
    ]);
    return { locations, activity };
  },
  component: SettingsPage,
});

type LocationAdminRow = Awaited<ReturnType<typeof listLocationsAdmin>>[number];
type ActivityRow = Awaited<ReturnType<typeof listActivity>>[number];

function SettingsPage() {
  const { locations, activity } = Route.useLoaderData();
  const [posterLocation, setPosterLocation] = useState<LocationAdminRow | null>(null);

  return (
    <div className="max-w-4xl">
      <PageHeader kicker="CEO only" title="Settings" />

      <div className="flex flex-col gap-8">
        <LocationsCard locations={locations} onShowPoster={setPosterLocation} />
        <ActivityCard activity={activity} />
        <BrandCard />
      </div>

      {posterLocation ? (
        <PosterDialog location={posterLocation} onClose={() => setPosterLocation(null)} />
      ) : null}
    </div>
  );
}

// ── Locations ────────────────────────────────────────────────────────────

function LocationsCard({
  locations,
  onShowPoster,
}: {
  locations: LocationAdminRow[];
  onShowPoster: (location: LocationAdminRow) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
        <AddLocationDialog />
      </CardHeader>
      <CardBody className="flex flex-col gap-3 p-4">
        {locations.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            hint="Add your first shop — it appears with its own card, its own ledgers, empty and ready."
          />
        ) : (
          <div className="flex flex-col">
            {locations.map((location) => (
              <LocationRow
                key={location.id}
                location={location}
                onShowPoster={() => onShowPoster(location)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LocationRow({
  location,
  onShowPoster,
}: {
  location: LocationAdminRow;
  onShowPoster: () => void;
}) {
  const router = useRouter();
  const setActiveFn = useServerFn(setLocationActive);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3 border-b border-foreground/10 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-bold text-foreground">{location.name}</p>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            /{location.slug}
          </span>
          {!location.active ? <Badge tone="outline">inactive</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {location.address ?? "No address on file"}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {location.memberCount} {location.memberCount === 1 ? "member" : "members"} · order{" "}
          {location.sortOrder}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={location.active}
          disabled={busy}
          onCheckedChange={async (checked) => {
            setBusy(true);
            try {
              await setActiveFn({ data: { id: location.id, active: checked } });
              toast.success(
                checked ? `${location.name} switched on` : `${location.name} switched off`,
              );
              router.invalidate();
            } catch {
              toast.error("Couldn't update the location");
            } finally {
              setBusy(false);
            }
          }}
        />
        <EditLocationDialog location={location} />
        <Button variant="outline" size="sm" onClick={onShowPoster}>
          <QrCode /> QR poster
        </Button>
      </div>
    </div>
  );
}

function AddLocationDialog() {
  const router = useRouter();
  const createFn = useServerFn(createLocation);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    try {
      await createFn({
        data: { name: trimmedName, address: address.trim() || undefined },
      });
      setOpen(false);
      setName("");
      setAddress("");
      toast.success(`${trimmedName} is ready to switch on`);
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add location");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add location
        </Button>
      </DialogTrigger>
      <DialogContent title="Add Location">
        <div className="flex flex-col gap-5">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lodge Lane"
            />
          </Field>
          <Field label="Address" hint="Optional — for your reference, not printed anywhere">
            <Textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="46E Lodge Ln, Liverpool L8 0QT"
            />
          </Field>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Adding…" : "Add location"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditLocationDialog({ location }: { location: LocationAdminRow }) {
  const router = useRouter();
  const updateFn = useServerFn(updateLocation);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? "");
  const [sortOrder, setSortOrder] = useState(String(location.sortOrder));
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: location.id,
          patch: {
            name: trimmedName,
            address: address.trim() || null,
            sortOrder: sortOrder.trim() === "" ? undefined : Number(sortOrder),
          },
        },
      });
      setOpen(false);
      toast.success("Saved");
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the location");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${location.name}`}>
        <div className="flex flex-col gap-5">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Address">
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Sort order" hint="Lower numbers show first">
            <Input
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9-]/g, ""))}
            />
          </Field>
          <Field label="Slug" hint="Locked once minted — used in internal URLs">
            <Input value={location.slug} disabled readOnly className="font-mono opacity-70" />
          </Field>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── QR poster ────────────────────────────────────────────────────────────

function PosterDialog({ location, onClose }: { location: LocationAdminRow; onClose: () => void }) {
  const router = useRouter();
  const regenFn = useServerFn(regenerateQrToken);
  const [qrToken, setQrToken] = useState(location.qrToken);
  const [regenerating, setRegenerating] = useState(false);

  const clockUrl = `${window.location.origin}/clock/${qrToken}`;

  async function regenerate() {
    const confirmed = window.confirm(
      `Regenerate the QR code for ${location.name}? The old poster stops working the instant this runs — you'll need to print and hang the new one straight away.`,
    );
    if (!confirmed) return;

    setRegenerating(true);
    try {
      const result = await regenFn({ data: { id: location.id } });
      setQrToken(result.qrToken);
      toast.success("New QR code generated — print and swap the poster");
      router.invalidate();
    } catch {
      toast.error("Couldn't regenerate the QR code");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title={`${location.name} — Door Poster`} wide className="max-w-2xl">
        <div className="flex flex-col items-center gap-5">
          <div className="no-print flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => window.print()}>
              <Printer /> Print
            </Button>
            <Button variant="outline" onClick={regenerate} disabled={regenerating}>
              <RefreshCw /> {regenerating ? "Regenerating…" : "Regenerate token"}
            </Button>
          </div>
          <QrPoster locationName={location.name} clockUrl={clockUrl} />
        </div>
      </DialogContent>
      {/* Print-only copy, portaled straight under <body>: the dialog's
          transform makes anything inside it unpaginatable, so the print CSS
          hides the whole app and prints only this (see styles.css). */}
      {createPortal(
        <div className="qr-poster-print">
          <QrPoster locationName={location.name} clockUrl={clockUrl} />
        </div>,
        document.body,
      )}
    </Dialog>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────

function ActivityCard({ activity }: { activity: ActivityRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col p-4">
        {activity.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing logged yet — every change gets a name and a time here.
          </p>
        ) : (
          activity.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-3 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="outline" className="shrink-0">
                  {a.entityType.replace(/_/g, " ")}
                </Badge>
                <p className="min-w-0 truncate font-mono text-xs">
                  <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>
                  {a.actorName ? (
                    <span className="font-bold text-pop"> · {a.actorName}</span>
                  ) : null}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                {new Date(a.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

// ── The brand ────────────────────────────────────────────────────────────

function BrandCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The brand</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="font-display text-3xl uppercase leading-none text-foreground">
            ZEZU <span className="text-pop">· The Modern Chinese</span>
          </p>
          <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Est. 2023 · Liverpool
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Where one bite is never enough. Born from the hustle, fuelled by the flavour.
        </p>
        <p className="font-chinese text-sm tracking-[0.4em] text-gold">正宗 · 现代 · 利物浦</p>
      </CardBody>
    </Card>
  );
}
