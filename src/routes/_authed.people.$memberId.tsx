import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PrintReport, DownloadPdfButton } from "@/components/print-report";
import {
  getMember,
  updateMember,
  setMemberLocations,
  regenerateCode,
  setMemberActive,
  toggleOnboardingStep,
  addOnboardingStep,
  deleteOnboardingStep,
  listLocationOptions,
  recordPayment,
} from "@/server/people";
import { getCurrentActor } from "@/lib/auth";
import {
  MEMBER_ROLES,
  MEMBER_CAPABILITIES,
  CAPABILITY_LABEL,
  CAPABILITY_HINT,
  MANAGER_DEFAULT_CAPABILITIES,
  formatGBP,
  type MemberRole,
  type ShiftStatus,
  type Capability,
} from "@/server/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/people/$memberId")({
  loader: async ({ params }) => {
    let member: Awaited<ReturnType<typeof getMember>>;
    try {
      member = await getMember({ data: { id: params.memberId } });
    } catch {
      throw notFound();
    }
    const actor = await getCurrentActor();
    const locationOptions = actor.role === "ceo" ? await listLocationOptions() : [];
    return { member, locationOptions };
  },
  component: MemberDetail,
});

type MemberDetail = Awaited<ReturnType<typeof getMember>>;
type LocationOption = Awaited<ReturnType<typeof listLocationOptions>>[number];

const ROLE_LABEL: Record<MemberRole, string> = {
  ceo: "CEO",
  manager: "Manager",
  staff: "Crew",
  warehouse: "Warehouse",
};

const SHIFT_STATUS_TONE: Record<ShiftStatus, "warning" | "success" | "danger"> = {
  pending: "warning",
  verified: "success",
  rejected: "danger",
};

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === "ceo") {
    return (
      <Badge tone="outline" className="border-gold text-gold">
        CEO
      </Badge>
    );
  }
  if (role === "manager") return <Badge tone="pop">Manager</Badge>;
  if (role === "warehouse") return <Badge tone="outline">Warehouse</Badge>;
  return <Badge tone="neutral">{ROLE_LABEL[role] ?? role}</Badge>;
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-2 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer",
        active
          ? "border-foreground bg-pop text-ink"
          : "border-foreground/25 text-muted-foreground hover:border-foreground/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string | Date): string {
  return `${new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${formatTime(value)}`;
}

/** Defaults applied whenever the role field changes in an add/edit dialog. */
function defaultCapabilitiesForRole(role: MemberRole): Capability[] {
  if (role === "manager") return MANAGER_DEFAULT_CAPABILITIES;
  return [];
}

/**
 * "What they can do" checklist — hidden entirely for ceo/warehouse (their
 * access isn't per-capability), otherwise a toggle per MEMBER_CAPABILITIES.
 */
function CapabilitiesSection({
  role,
  selected,
  onChange,
}: {
  role: MemberRole;
  selected: Capability[];
  onChange: (next: Capability[]) => void;
}) {
  if (role === "ceo" || role === "warehouse") return null;

  return (
    <Field label="What they can do">
      <div className="flex flex-col gap-3 border-2 border-foreground/15 p-4">
        {MEMBER_CAPABILITIES.map((cap) => {
          const checked = selected.includes(cap);
          return (
            <div
              key={cap}
              className="flex items-start justify-between gap-3 border-b border-foreground/10 pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{CAPABILITY_LABEL[cap]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{CAPABILITY_HINT[cap]}</p>
              </div>
              <Switch
                checked={checked}
                onCheckedChange={(v) =>
                  onChange(v ? [...selected, cap] : selected.filter((c) => c !== cap))
                }
              />
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function MemberDetail() {
  const { member, locationOptions } = Route.useLoaderData();
  const { actor, flags } = Route.useRouteContext();
  const isCeo = actor.role === "ceo";
  const isMemberCeo = member.role === "ceo";
  const canSeePay = isCeo && flags.salaryVisible;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <Button asChild variant="ghost" size="icon-sm" className="mt-2">
            <Link to="/people">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
              — {member.locations.map((l) => l.name).join(" · ") || "No site assigned"}
            </p>
            <h1 className="font-display text-4xl uppercase text-foreground md:text-5xl">
              {member.name}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <RoleBadge role={member.role} />
              {!member.active ? <Badge tone="danger">OFF</Badge> : null}
            </div>
          </div>
        </div>
        <DownloadPdfButton />
      </div>

      {!isMemberCeo && canSeePay ? <PayCard member={member} /> : null}

      <div
        className={cn("grid grid-cols-1 gap-5 lg:grid-cols-2", !isMemberCeo && canSeePay && "mt-6")}
      >
        <ProfileCard member={member} isCeo={isCeo} />
        {isCeo ? <LocationsCard member={member} locationOptions={locationOptions} /> : null}
        {isCeo ? <CodeCard member={member} /> : null}
        {isCeo ? <ActiveCard member={member} /> : null}
      </div>

      {/* Once onboarding is done, the checklist disappears — pay takes its place. */}
      {!member.onboardingComplete ? (
        <div className="mt-6">
          <OnboardingCard member={member} />
        </div>
      ) : null}

      {!isMemberCeo ? (
        <div className="mt-6">
          <TimesheetCard member={member} canSeePay={canSeePay} />
        </div>
      ) : null}

      <MemberPrintReport member={member} canSeePay={canSeePay} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-foreground/10 pb-2.5 last:border-b-0 last:pb-0">
      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

function ProfileCard({ member, isCeo }: { member: MemberDetail; isCeo: boolean }) {
  const usesCapabilities = member.role === "staff" || member.role === "manager";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        {isCeo ? <EditMemberDialog member={member} /> : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <InfoRow label="Role" value={ROLE_LABEL[member.role]} />
        <InfoRow label="Phone" value={member.phone ?? "Not set"} />
        <InfoRow
          label="Hourly rate"
          value={member.hourlyRate ? formatGBP(member.hourlyRate) : "Not set"}
        />
        <InfoRow
          label="Started"
          value={member.startedAt ? formatDate(member.startedAt) : "Not set"}
        />
        {member.notes ? <InfoRow label="Notes" value={member.notes} /> : null}
        {usesCapabilities ? (
          <div className="pt-1">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Can do
            </p>
            {member.permissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No capabilities granted yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {member.permissions.map((cap) => (
                  <span
                    key={cap}
                    className="border-2 border-foreground/25 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-foreground"
                  >
                    {CAPABILITY_LABEL[cap]}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function EditMemberDialog({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const updateFn = useServerFn(updateMember);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [hourlyRate, setHourlyRate] = useState(member.hourlyRate ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [startedAt, setStartedAt] = useState(member.startedAt ?? "");
  const [notes, setNotes] = useState(member.notes ?? "");
  const [permissions, setPermissions] = useState<Capability[]>(member.permissions);
  const [saving, setSaving] = useState(false);

  function onRoleChange(next: MemberRole) {
    setRole(next);
    setPermissions(defaultCapabilitiesForRole(next));
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: member.id,
          name: name.trim(),
          role,
          hourlyRate: hourlyRate === "" ? null : Number(hourlyRate),
          phone: phone.trim() || null,
          startedAt: startedAt || null,
          notes: notes.trim() || null,
          permissions,
        },
      });
      setOpen(false);
      toast.success("Saved");
      router.invalidate();
    } catch {
      toast.error("Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit profile">
        <div className="flex flex-col gap-5">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <Select value={role} onValueChange={(v) => onRoleChange(v as MemberRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Hourly rate (£)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Start date">
              <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </Field>
          </div>
          <CapabilitiesSection role={role} selected={permissions} onChange={setPermissions} />
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LocationsCard({
  member,
  locationOptions,
}: {
  member: MemberDetail;
  locationOptions: LocationOption[];
}) {
  const router = useRouter();
  const setLocationsFn = useServerFn(setMemberLocations);
  const [selected, setSelected] = useState<string[]>(member.locations.map((l) => l.id));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await setLocationsFn({ data: { memberId: member.id, locationIds: selected } });
      toast.success("Sites updated");
      router.invalidate();
    } catch {
      toast.error("Couldn't update sites");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sites</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {locationOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sites set up yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {locationOptions.map((loc) => {
              const active = selected.includes(loc.id);
              return (
                <ChipButton
                  key={loc.id}
                  active={active}
                  onClick={() =>
                    setSelected((prev) =>
                      active ? prev.filter((id) => id !== loc.id) : [...prev, loc.id],
                    )
                  }
                >
                  {loc.name}
                </ChipButton>
              );
            })}
          </div>
        )}
        <Button size="sm" variant="outline" onClick={save} disabled={saving} className="self-start">
          {saving ? "Saving…" : "Save sites"}
        </Button>
      </CardBody>
    </Card>
  );
}

function CodeCard({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const regenFn = useServerFn(regenerateCode);
  const [open, setOpen] = useState(false);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doRegenerate() {
    setBusy(true);
    try {
      const result = await regenFn({ data: { id: member.id } });
      setRevealedCode(result.code);
      router.invalidate();
    } catch {
      toast.error("Couldn't regenerate code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access code</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col items-center gap-3 py-6">
        <p className="font-display text-4xl tracking-[0.3em] text-foreground">••••</p>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setRevealedCode(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Regenerate
            </Button>
          </DialogTrigger>
          <DialogContent title={revealedCode ? "New code" : "Regenerate code?"}>
            {revealedCode ? (
              <div className="flex flex-col items-center gap-5 py-2 text-center">
                <div className="flex gap-3">
                  {revealedCode.split("").map((d, i) => (
                    <span
                      key={i}
                      className="flex size-16 items-center justify-center border-2 border-gold font-display text-4xl text-gold shadow-gold"
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
                  Write it down — it will never be shown again
                </p>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-5 text-center">
                <p className="text-sm text-muted-foreground">
                  {member.name}&rsquo;s old code stops working the moment you generate a new one.
                </p>
                <Button variant="destructive" onClick={doRegenerate} disabled={busy}>
                  {busy ? "Generating…" : "Yes, regenerate"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardBody>
    </Card>
  );
}

function ActiveCard({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const setActiveFn = useServerFn(setMemberActive);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply(active: boolean) {
    setBusy(true);
    try {
      await setActiveFn({ data: { id: member.id, active } });
      toast.success(active ? "Access switched on" : "Access switched off");
      router.invalidate();
    } catch {
      toast.error("Couldn't update access");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
      </CardHeader>
      <CardBody className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-foreground">
            {member.active ? "Code is live" : "Code switched off"}
          </p>
          <p className="text-xs text-muted-foreground">
            {member.active
              ? "They can clock in and sign in right now."
              : "Their code no longer opens anything."}
          </p>
        </div>
        <Switch
          checked={member.active}
          disabled={busy}
          onCheckedChange={(checked) => {
            if (!checked) setConfirmOpen(true);
            else void apply(true);
          }}
        />
      </CardBody>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title="Switch off access?">
          <div className="flex flex-col gap-5 text-center">
            <p className="text-sm text-muted-foreground">
              {member.name} won&rsquo;t be able to clock in or sign in — effective immediately.
            </p>
            <Button variant="destructive" onClick={() => apply(false)} disabled={busy}>
              {busy ? "Switching off…" : "Yes, switch off"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Prominent pay ledger, shown once onboarding is complete. Outstanding
 * hours + payable amount up top, "Record payment" opens a dialog prefilled
 * from the current balance, then the recent payment history below.
 */
function PayCard({ member }: { member: MemberDetail }) {
  if (!member.onboardingComplete) {
    return (
      <Card className="mt-6">
        <CardBody>
          <p className="text-sm text-muted-foreground">
            Pay tracking unlocks when onboarding is complete.
          </p>
        </CardBody>
      </Card>
    );
  }

  const rate = member.hourlyRate !== null ? Number(member.hourlyRate) : null;

  return (
    <Card raised className="mt-6 border-gold">
      <CardHeader>
        <CardTitle>Pay</CardTitle>
        <RecordPaymentDialog member={member} />
      </CardHeader>
      <CardBody className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Outstanding hours
            </p>
            <p className="mt-1 font-display text-5xl text-foreground">{member.outstandingHours}h</p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Payable
            </p>
            <p className="mt-1 font-display text-5xl text-gold">
              {member.payableAmount !== null ? formatGBP(member.payableAmount) : "—"}
            </p>
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {rate !== null
            ? `Rate ${formatGBP(rate)}/hr`
            : "No hourly rate set — add one on the profile to calculate payable amount."}
        </p>

        <PaymentHistory payments={member.payments} />
      </CardBody>
    </Card>
  );
}

function RecordPaymentDialog({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const recordFn = useServerFn(recordPayment);
  const rate = member.hourlyRate !== null ? Number(member.hourlyRate) : null;
  // Only rendered from PayCard, which only renders once pay is visible to
  // this caller (ceo + salary toggle on) — outstandingHours is a real number
  // in that case, but the type stays nullable since it's shared with callers
  // that can't see pay, so fall back to 0 defensively.
  const outstandingHours = member.outstandingHours ?? 0;
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(String(outstandingHours));
  const [amount, setAmount] = useState(
    rate !== null ? String(Math.round(outstandingHours * rate * 100) / 100) : "",
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setHours(String(outstandingHours));
    setAmount(rate !== null ? String(Math.round(outstandingHours * rate * 100) / 100) : "");
    setNote("");
  }

  function onHoursChange(value: string) {
    setHours(value);
    const h = Number(value);
    if (rate !== null && Number.isFinite(h)) {
      setAmount(String(Math.round(h * rate * 100) / 100));
    }
  }

  async function submit() {
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    if (!(hoursNum > 0)) {
      toast.error("Enter the hours this payment covers");
      return;
    }
    if (!(amountNum > 0)) {
      toast.error("Enter the amount paid");
      return;
    }
    setSaving(true);
    try {
      await recordFn({
        data: {
          memberId: member.id,
          amount: amountNum,
          hours: hoursNum,
          note: note.trim() || undefined,
        },
      });
      setOpen(false);
      reset();
      toast.success(`Paid ${member.name} — balance updated`);
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={outstandingHours <= 0}>Record payment</Button>
      </DialogTrigger>
      <DialogContent title="Record payment">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            {outstandingHours}h outstanding
            {rate !== null ? ` at ${formatGBP(rate)}/hr` : ""} — hours paid can&rsquo;t exceed this.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hours covered">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={hours}
                onChange={(e) => onHoursChange(e.target.value)}
              />
            </Field>
            <Field label="Amount (£)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Note (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaymentHistory({ payments }: { payments: MemberDetail["payments"] }) {
  return (
    <div className="border-t-2 border-foreground/10 pt-5">
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Payment history
      </p>
      {payments.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <div className="flex flex-col">
          {payments.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 border-b border-foreground/10 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">{formatDateTime(p.createdAt)}</p>
                <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
                  By {p.paidByName}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-bold text-pop">{formatGBP(p.amount)}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{p.hours}h</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingCard({ member }: { member: MemberDetail }) {
  const router = useRouter();
  const toggleFn = useServerFn(toggleOnboardingStep);
  const addFn = useServerFn(addOnboardingStep);
  const deleteFn = useServerFn(deleteOnboardingStep);
  const [newStep, setNewStep] = useState("");
  const [adding, setAdding] = useState(false);

  const done = member.onboardingSteps.filter((s) => s.done).length;
  const total = member.onboardingSteps.length;

  async function submitStep() {
    if (!newStep.trim()) return;
    setAdding(true);
    try {
      await addFn({ data: { memberId: member.id, title: newStep.trim() } });
      setNewStep("");
      router.invalidate();
    } catch {
      toast.error("Couldn't add step");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Onboarding · {done}/{total}
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-0 p-0">
        {member.onboardingSteps.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No steps yet.</p>
        ) : (
          member.onboardingSteps.map((step) => (
            <div
              key={step.id}
              className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0"
            >
              <button
                type="button"
                onClick={async () => {
                  try {
                    await toggleFn({ data: { stepId: step.id, done: !step.done } });
                    router.invalidate();
                  } catch {
                    toast.error("Couldn't update step");
                  }
                }}
                className="flex flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center border-2",
                    step.done ? "border-pop bg-pop text-ink" : "border-foreground/40",
                  )}
                >
                  {step.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    step.done ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {step.title}
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deleteFn({ data: { stepId: step.id } });
                    router.invalidate();
                    toast.success("Step removed");
                  } catch {
                    toast.error("Couldn't remove step");
                  }
                }}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                aria-label="Remove step"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
        <div className="flex items-center gap-3 border-t-2 border-foreground/15 p-3">
          <Input
            placeholder="Add a step…"
            value={newStep}
            onChange={(e) => setNewStep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitStep();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={adding || !newStep.trim()}
            onClick={submitStep}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return <Badge tone={SHIFT_STATUS_TONE[status]}>{status}</Badge>;
}

function TimesheetCard({ member, canSeePay }: { member: MemberDetail; canSeePay: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timesheet</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-foreground/15 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="whitespace-nowrap py-2.5 pr-4">Month</th>
                <th className="whitespace-nowrap py-2.5 pr-4">Verified</th>
                <th className="whitespace-nowrap py-2.5 pr-4">Pending</th>
                {canSeePay ? <th className="whitespace-nowrap py-2.5">Pay</th> : null}
              </tr>
            </thead>
            <tbody>
              {member.monthlySummary.map((row) => (
                <tr key={row.month} className="border-b border-foreground/10 last:border-b-0">
                  <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs text-foreground">
                    {formatMonth(row.month)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs text-foreground">
                    {row.verifiedHours}h
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs text-muted-foreground">
                    {row.pendingHours}h
                  </td>
                  {canSeePay ? (
                    <td className="whitespace-nowrap py-3 font-mono text-xs font-bold text-pop">
                      {row.pay !== null ? formatGBP(row.pay) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Recent shifts
          </p>
          {member.recentShifts.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No shifts logged yet.</p>
          ) : (
            <div className="flex flex-col">
              {member.recentShifts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-foreground/10 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{s.locationName}</p>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      {formatDateTime(s.clockInAt)} –{" "}
                      {s.clockOutAt ? formatTime(s.clockOutAt) : "still in"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {s.hours !== null ? `${s.hours}h` : "—"}
                    </span>
                    <ShiftStatusBadge status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * PDF export: profile summary always; recent shifts for non-CEO members;
 * pay balance + payments only for non-CEO members AND when pay is visible
 * to this caller (CEO + salary toggle on) — otherwise that section is
 * omitted entirely, same as the on-screen Pay card.
 */
function MemberPrintReport({ member, canSeePay }: { member: MemberDetail; canSeePay: boolean }) {
  const isMemberCeo = member.role === "ceo";

  return (
    <PrintReport
      title={`${member.name} — profile`}
      subtitle={member.locations.map((l) => l.name).join(" · ") || undefined}
    >
      <div className="mb-6 grid grid-cols-2 gap-4 text-sm text-[#1b1510] sm:grid-cols-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">Role</p>
          <p className="mt-1">{ROLE_LABEL[member.role]}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">Phone</p>
          <p className="mt-1">{member.phone ?? "Not set"}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">Started</p>
          <p className="mt-1">{member.startedAt ? formatDate(member.startedAt) : "Not set"}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
            Hourly rate
          </p>
          <p className="mt-1">{member.hourlyRate ? formatGBP(member.hourlyRate) : "Not set"}</p>
        </div>
      </div>

      {isMemberCeo ? null : (
        <>
          {canSeePay ? (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
                    Outstanding hours
                  </p>
                  <p className="mt-1 text-2xl font-bold text-[#1b1510]">
                    {member.outstandingHours}h
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
                    Payable
                  </p>
                  <p className="mt-1 text-2xl font-bold text-[#1b1510]">
                    {member.payableAmount !== null ? formatGBP(member.payableAmount) : "—"}
                  </p>
                </div>
              </div>

              <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-[#1b1510]">
                Payments
              </h2>
              <table className="mb-6 w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-[#1b1510]/20 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Hours</th>
                    <th className="py-2 pr-4">By</th>
                    <th className="py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {member.payments.length === 0 ? (
                    <tr>
                      <td className="py-3 text-[#6e6455]" colSpan={5}>
                        No payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    member.payments.map((p) => (
                      <tr key={p.id} className="border-b border-[#1b1510]/10">
                        <td className="py-2 pr-4">{formatDateTime(p.createdAt)}</td>
                        <td className="py-2 pr-4">{formatGBP(p.amount)}</td>
                        <td className="py-2 pr-4">{p.hours}h</td>
                        <td className="py-2 pr-4">{p.paidByName}</td>
                        <td className="py-2">{p.note ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          ) : null}

          <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-[#1b1510]">
            Recent shifts
          </h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-[#1b1510]/20 font-mono text-[10px] uppercase tracking-widest text-[#6e6455]">
                <th className="py-2 pr-4">Site</th>
                <th className="py-2 pr-4">Clock in</th>
                <th className="py-2 pr-4">Clock out</th>
                <th className="py-2 pr-4">Hours</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {member.recentShifts.length === 0 ? (
                <tr>
                  <td className="py-3 text-[#6e6455]" colSpan={5}>
                    No shifts logged yet.
                  </td>
                </tr>
              ) : (
                member.recentShifts.map((s) => (
                  <tr key={s.id} className="border-b border-[#1b1510]/10">
                    <td className="py-2 pr-4">{s.locationName}</td>
                    <td className="py-2 pr-4">{formatDateTime(s.clockInAt)}</td>
                    <td className="py-2 pr-4">
                      {s.clockOutAt ? formatTime(s.clockOutAt) : "still in"}
                    </td>
                    <td className="py-2 pr-4">{s.hours !== null ? `${s.hours}h` : "—"}</td>
                    <td className="py-2">{s.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </PrintReport>
  );
}
