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
} from "@/server/people";
import { getCurrentActor } from "@/lib/auth";
import { MEMBER_ROLES, formatGBP, type MemberRole, type ShiftStatus } from "@/server/types";
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

function MemberDetail() {
  const { member, locationOptions } = Route.useLoaderData();
  const { actor } = Route.useRouteContext();
  const isCeo = actor.role === "ceo";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-wrap items-start gap-3">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ProfileCard member={member} isCeo={isCeo} />
        {isCeo ? <LocationsCard member={member} locationOptions={locationOptions} /> : null}
        {isCeo ? <CodeCard member={member} /> : null}
        {isCeo ? <ActiveCard member={member} /> : null}
      </div>

      <div className="mt-6">
        <OnboardingCard member={member} />
      </div>

      <div className="mt-6">
        <TimesheetCard member={member} />
      </div>
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
  const [saving, setSaving] = useState(false);

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
              <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
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

function TimesheetCard({ member }: { member: MemberDetail }) {
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
                <th className="whitespace-nowrap py-2.5">Pay</th>
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
                  <td className="whitespace-nowrap py-3 font-mono text-xs font-bold text-pop">
                    {row.pay !== null ? formatGBP(row.pay) : "—"}
                  </td>
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
