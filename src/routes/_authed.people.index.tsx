import { useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
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
import { EmptyState } from "@/components/ui/empty-state";
import { listMembers, createMember, listLocationOptions } from "@/server/people";
import { getCurrentActor } from "@/lib/auth";
import { MEMBER_ROLES, type MemberRole } from "@/server/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/people/")({
  loader: async () => {
    const [members, actor] = await Promise.all([listMembers(), getCurrentActor()]);
    const locationOptions = actor.role === "ceo" ? await listLocationOptions() : [];
    return { members, locationOptions };
  },
  component: PeoplePage,
});

type PeopleMember = Awaited<ReturnType<typeof listMembers>>[number];
type LocationOption = Awaited<ReturnType<typeof listLocationOptions>>[number];

const ROLE_LABEL: Record<MemberRole, string> = { ceo: "CEO", manager: "Manager", staff: "Crew" };

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === "ceo") {
    return (
      <Badge tone="outline" className="border-gold text-gold">
        CEO
      </Badge>
    );
  }
  if (role === "manager") return <Badge tone="pop">Manager</Badge>;
  return <Badge tone="neutral">Crew</Badge>;
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

function PeoplePage() {
  const { members, locationOptions } = Route.useLoaderData();
  const { actor } = Route.useRouteContext();
  const isCeo = actor.role === "ceo";

  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const availableLocations = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => m.locations.forEach((l) => map.set(l.id, l.name)));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [members]);

  const filtered = members.filter((m) => {
    if (locationFilter !== "all" && !m.locations.some((l) => l.id === locationFilter)) return false;
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    return true;
  });

  const addButton = isCeo ? <AddMemberDialog locationOptions={locationOptions} /> : undefined;

  return (
    <div>
      <PageHeader kicker="ZEZU Operations" title="People" actions={addButton} />

      {members.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipButton active={locationFilter === "all"} onClick={() => setLocationFilter("all")}>
              All sites
            </ChipButton>
            {availableLocations.map((loc) => (
              <ChipButton
                key={loc.id}
                active={locationFilter === loc.id}
                onClick={() => setLocationFilter(loc.id)}
              >
                {loc.name}
              </ChipButton>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipButton active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
              All roles
            </ChipButton>
            {MEMBER_ROLES.map((r) => (
              <ChipButton key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>
                {ROLE_LABEL[r]}
              </ChipButton>
            ))}
          </div>
        </div>
      ) : null}

      {members.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No one here yet"
          hint="Every hire gets a profile, a site, and a code that's theirs alone — add the first one."
          action={addButton}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No matches"
          hint="Try a different site or role filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => (
            <MemberCard key={m.id} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({ member }: { member: PeopleMember }) {
  const pct =
    member.onboarding.total > 0
      ? Math.round((member.onboarding.done / member.onboarding.total) * 100)
      : 0;

  return (
    <Link to="/people/$memberId" params={{ memberId: member.id }} className="group">
      <Card
        className={cn(
          "h-full transition-all group-hover:border-foreground group-hover:shadow-neo",
          !member.active && "opacity-50",
        )}
      >
        <CardBody className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-2xl uppercase text-foreground">
                {member.name}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {member.locations.map((l) => l.name).join(" · ") || "No site assigned"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <RoleBadge role={member.role} />
              {!member.active ? <Badge tone="danger">OFF</Badge> : null}
            </div>
          </div>

          <div className="mt-auto grid grid-cols-2 gap-3 border-t-2 border-foreground/10 pt-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Onboarding
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 bg-muted">
                  <div className="h-full bg-pop" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 font-mono text-[10px] font-bold text-foreground">
                  {member.onboarding.done}/{member.onboarding.total}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                This month
              </p>
              <p className="mt-1.5 font-mono text-xs font-bold text-foreground">
                {member.thisMonthVerifiedHours}h
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

function AddMemberDialog({ locationOptions }: { locationOptions: LocationOption[] }) {
  const router = useRouter();
  const createFn = useServerFn(createMember);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("staff");
  const [hourlyRate, setHourlyRate] = useState("");
  const [phone, setPhone] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; code: string } | null>(null);

  function reset() {
    setName("");
    setRole("staff");
    setHourlyRate("");
    setPhone("");
    setStartedAt("");
    setNotes("");
    setSelectedLocations([]);
    setRevealed(null);
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await createFn({
        data: {
          name: name.trim(),
          role,
          hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
          phone: phone.trim() || undefined,
          startedAt: startedAt || undefined,
          notes: notes.trim() || undefined,
          locationIds: selectedLocations,
        },
      });
      setRevealed({ name: result.member.name, code: result.code });
      router.invalidate();
    } catch {
      toast.error("Couldn't add member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent title={revealed ? "Write it down" : "Add member"}>
        {revealed ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {revealed.name}&rsquo;s code
            </p>
            <div className="flex gap-3">
              {revealed.code.split("").map((digit, i) => (
                <span
                  key={i}
                  className="flex size-16 items-center justify-center border-2 border-gold font-display text-4xl text-gold shadow-gold"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
              Write it down — it will never be shown again
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                setOpen(false);
                reset();
                toast.success("Member added");
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Start date">
                <Input
                  type="date"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Sites">
              {locationOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sites set up yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {locationOptions.map((loc) => {
                    const active = selectedLocations.includes(loc.id);
                    return (
                      <ChipButton
                        key={loc.id}
                        active={active}
                        onClick={() =>
                          setSelectedLocations((prev) =>
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
            </Field>
            <Field label="Notes (optional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Adding…" : "Add member"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
