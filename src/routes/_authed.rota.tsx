import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  StickyNote,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState } from "@/components/ui/empty-state";
import { PrintReport, DownloadPdfButton } from "@/components/print-report";
import { listLocations } from "@/server/locations";
import { getRota, upsertRotaEntry, deleteRotaEntry, copyPreviousWeek } from "@/server/rota";
import { todayDateString } from "@/server/types";
import { cn } from "@/lib/utils";
import type { Actor } from "@/lib/auth.server";

/**
 * Rota — the manager plans the week ahead per shop; staff check when
 * they're working. Week + location live in search params so a link to
 * "next week at Lodge Lane" is shareable and survives a refresh.
 */

export const Route = createFileRoute("/_authed/rota")({
  validateSearch: (s: Record<string, unknown>): { location?: string; week?: string } => ({
    location: typeof s.location === "string" ? s.location : undefined,
    week: typeof s.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.week) ? s.week : undefined,
  }),
  loaderDeps: ({ search }) => ({ location: search.location, week: search.week }),
  loader: async ({ deps }) => {
    const locations = await listLocations();
    const locationId =
      deps.location && locations.some((l) => l.id === deps.location)
        ? deps.location
        : (locations[0]?.id ?? null);
    const weekStart = mondayOf(deps.week ?? todayDateString());
    const rota = locationId ? await getRota({ data: { locationId, weekStart } }) : null;
    return { locations, locationId, weekStart, rota };
  },
  component: RotaPage,
});

type RotaData = Awaited<ReturnType<typeof getRota>>;
type CrewRow = RotaData["crew"][number];
type EntryRow = RotaData["entries"][number];
type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];
type DialogState = { memberId: string | null; date: string; entry: EntryRow | null };

// ── pure date/time helpers ───────────────────────────────────────────────

/** Adds (or subtracts) whole days to a "YYYY-MM-DD" string, calendar-safe. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function dayLabel(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(date);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Total planned hours for a member across the given entries, "7.5h" style. */
function memberWeeklyHours(entries: EntryRow[], memberId: string): string {
  const minutes = entries
    .filter((e) => e.memberId === memberId)
    .reduce((sum, e) => sum + (timeToMinutes(e.endTime) - timeToMinutes(e.startTime)), 0);
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours}h`;
}

// ── page ─────────────────────────────────────────────────────────────────

function RotaPage() {
  const { locations, locationId, weekStart, rota } = Route.useLoaderData();
  const { actor } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const isManager = actor.role === "ceo" || actor.role === "manager";

  const currentLocation = locations.find((l) => l.id === locationId);
  const days = rota?.days ?? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = todayDateString();

  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  function selectLocation(id: string) {
    navigate({ search: (prev) => ({ ...prev, location: id }) });
  }
  function changeWeek(delta: number) {
    navigate({ search: (prev) => ({ ...prev, week: addDays(weekStart, delta) }) });
  }
  function resetWeek() {
    navigate({ search: (prev) => ({ ...prev, week: undefined }) });
  }

  return (
    <div>
      <PageHeader
        kicker="Who's on, when"
        title="Rota"
        actions={
          <>
            {locations.length > 1 ? (
              <LocationPicker
                locations={locations}
                value={locationId ?? ""}
                onChange={selectLocation}
              />
            ) : null}
            <DownloadPdfButton />
          </>
        }
      />

      <WeekNav
        weekStart={weekStart}
        onPrev={() => changeWeek(-7)}
        onNext={() => changeWeek(7)}
        onReset={resetWeek}
      />

      {!locationId || !rota ? (
        <EmptyState
          icon={UsersRound}
          title="No shop set up yet"
          hint="Ask the CEO to add a location before planning a rota."
        />
      ) : rota.crew.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No crew here yet"
          hint="Assign crew to this location in People before planning a rota."
        />
      ) : (
        <>
          {isManager ? (
            <div className="mb-6 flex justify-end">
              <CopyLastWeekButton locationId={locationId} weekStart={weekStart} />
            </div>
          ) : null}

          <DesktopGrid
            days={days}
            crew={rota.crew}
            entries={rota.entries}
            today={today}
            actor={actor}
            isManager={isManager}
            onOpenCell={(memberId, date, entry) =>
              setDialogState({ memberId, date, entry: entry ?? null })
            }
          />

          <MobileList
            days={days}
            crew={rota.crew}
            entries={rota.entries}
            today={today}
            actor={actor}
            isManager={isManager}
            onOpenDay={(date, entry) =>
              setDialogState({ memberId: entry?.memberId ?? null, date, entry: entry ?? null })
            }
          />

          <WeeklyHoursCard crew={rota.crew} entries={rota.entries} />

          <PrintReport
            title={`Rota — ${currentLocation?.name ?? "ZEZU"}`}
            subtitle={`${dayLabel(days[0], { weekday: "long", day: "numeric", month: "long" })} – ${dayLabel(days[6], { weekday: "long", day: "numeric", month: "long" })}`}
          >
            <RotaPrintTable days={days} crew={rota.crew} entries={rota.entries} />
          </PrintReport>

          {isManager ? (
            <ShiftDialog
              state={dialogState}
              crew={rota.crew}
              locationId={locationId}
              onOpenChange={(open) => !open && setDialogState(null)}
            />
          ) : null}
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

function WeekNav({
  weekStart,
  onPrev,
  onNext,
  onReset,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
}) {
  const isCurrentWeek = weekStart === mondayOf(todayDateString());
  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3">
      <Button variant="outline" size="icon" onClick={onPrev} aria-label="Previous week">
        <ChevronLeft />
      </Button>
      <span className="min-w-0 font-display text-xl uppercase text-foreground md:text-2xl">
        {dayLabel(weekStart, { weekday: "short", day: "numeric" })} –{" "}
        {dayLabel(weekEnd, { weekday: "short", day: "numeric", month: "short" })}
      </span>
      <Button variant="outline" size="icon" onClick={onNext} aria-label="Next week">
        <ChevronRight />
      </Button>
      {!isCurrentWeek ? (
        <Button variant="ghost" size="sm" onClick={onReset}>
          This week
        </Button>
      ) : null}
    </div>
  );
}

// ── desktop grid ─────────────────────────────────────────────────────────

function DesktopGrid({
  days,
  crew,
  entries,
  today,
  actor,
  isManager,
  onOpenCell,
}: {
  days: string[];
  crew: CrewRow[];
  entries: EntryRow[];
  today: string;
  actor: Actor;
  isManager: boolean;
  onOpenCell: (memberId: string, date: string, entry?: EntryRow) => void;
}) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <div className="grid min-w-[900px] grid-cols-[160px_repeat(7,minmax(0,1fr))]">
        <div className="border-b-2 border-foreground/15 px-3 py-2.5" />
        {days.map((d) => (
          <div
            key={d}
            className={cn(
              "border-b-2 border-foreground/15 px-3 py-2.5 text-center",
              d === today && "border-t-4 border-t-gold",
            )}
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {dayLabel(d, { weekday: "short" })}
            </p>
            <p className="font-display text-lg text-foreground">
              {dayLabel(d, { day: "numeric" })}
            </p>
          </div>
        ))}

        {crew.map((member) => {
          const isSelf = member.id === actor.memberId;
          return (
            <div key={member.id} className="contents">
              <div
                className={cn(
                  "flex flex-col justify-center border-b border-foreground/10 px-3 py-2",
                  isSelf && "bg-pop/5",
                )}
              >
                <p className="truncate text-sm font-bold text-foreground">{member.name}</p>
                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {member.role}
                </p>
              </div>
              {days.map((d) => {
                const cellEntries = entries.filter((e) => e.memberId === member.id && e.date === d);
                const cellClasses = cn(
                  "flex min-h-[64px] flex-col gap-1 border-b border-l border-foreground/10 p-1.5 text-left",
                  isSelf && "border-l-pop/40",
                );

                if (isManager && cellEntries.length === 0) {
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onOpenCell(member.id, d)}
                      aria-label={`Add shift for ${member.name} on ${dayLabel(d, { weekday: "long", day: "numeric" })}`}
                      className={cn(cellClasses, "cursor-pointer hover:bg-foreground/5")}
                    />
                  );
                }

                return (
                  <div key={d} className={cellClasses}>
                    {cellEntries.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        disabled={!isManager}
                        onClick={() => isManager && onOpenCell(member.id, d, e)}
                        className={cn(
                          "flex items-center gap-1 border border-foreground/25 bg-pop/10 px-1.5 py-1 text-left font-mono text-[10px] font-bold text-foreground",
                          isManager && "cursor-pointer hover:border-pop",
                        )}
                      >
                        {e.startTime}–{e.endTime}
                        {e.note ? (
                          <StickyNote className="size-3 shrink-0 text-gold" strokeWidth={2.5} />
                        ) : null}
                      </button>
                    ))}
                    {isManager ? (
                      <button
                        type="button"
                        onClick={() => onOpenCell(member.id, d)}
                        aria-label={`Add another shift for ${member.name} on ${dayLabel(d, { weekday: "long", day: "numeric" })}`}
                        className="text-left font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground"
                      >
                        + Add
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── mobile stacked days ──────────────────────────────────────────────────

function MobileList({
  days,
  crew,
  entries,
  today,
  actor,
  isManager,
  onOpenDay,
}: {
  days: string[];
  crew: CrewRow[];
  entries: EntryRow[];
  today: string;
  actor: Actor;
  isManager: boolean;
  onOpenDay: (date: string, entry?: EntryRow) => void;
}) {
  const memberName = new Map(crew.map((m) => [m.id, m.name]));

  return (
    <div className="flex flex-col gap-4 lg:hidden">
      {days.map((d) => {
        const dayEntries = entries
          .filter((e) => e.date === d)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <Card key={d} className={cn(d === today && "border-t-4 border-t-gold")}>
            <CardHeader>
              <CardTitle>
                {dayLabel(d, { weekday: "long", day: "numeric", month: "short" })}
              </CardTitle>
              {isManager ? (
                <Button size="sm" variant="outline" onClick={() => onOpenDay(d)}>
                  <Plus /> Add
                </Button>
              ) : null}
            </CardHeader>
            <CardBody className="flex flex-col gap-0 p-0">
              {dayEntries.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">Nothing planned</p>
              ) : (
                dayEntries.map((e) => {
                  const isSelf = e.memberId === actor.memberId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={!isManager}
                      onClick={() => isManager && onOpenDay(d, e)}
                      className={cn(
                        "flex items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3 text-left text-sm last:border-b-0",
                        isSelf && "bg-pop/5",
                        isManager && "cursor-pointer hover:bg-foreground/5",
                      )}
                    >
                      <span className="text-foreground">
                        {memberName.get(e.memberId) ?? "Unknown"} · {e.startTime}–{e.endTime}
                      </span>
                      {e.note ? (
                        <StickyNote className="size-3.5 shrink-0 text-gold" strokeWidth={2.5} />
                      ) : null}
                    </button>
                  );
                })
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// ── weekly hours summary ─────────────────────────────────────────────────

function WeeklyHoursCard({ crew, entries }: { crew: CrewRow[]; entries: EntryRow[] }) {
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Weekly hours</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-wrap gap-3">
        {crew.map((m) => (
          <span
            key={m.id}
            className="border-2 border-foreground/20 px-3 py-1.5 font-mono text-xs font-bold text-foreground"
          >
            {m.name} <span className="text-gold">{memberWeeklyHours(entries, m.id)}</span>
          </span>
        ))}
      </CardBody>
    </Card>
  );
}

// ── print table ──────────────────────────────────────────────────────────

function RotaPrintTable({
  days,
  crew,
  entries,
}: {
  days: string[];
  crew: CrewRow[];
  entries: EntryRow[];
}) {
  const border = { borderColor: "#d8d0c0" };
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border px-2 py-1.5 text-left" style={border}>
            Crew
          </th>
          {days.map((d) => (
            <th key={d} className="border px-2 py-1.5 text-left" style={border}>
              {dayLabel(d, { weekday: "short", day: "numeric", month: "short" })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {crew.map((m) => (
          <tr key={m.id}>
            <td className="border px-2 py-1.5 font-bold" style={border}>
              {m.name}
            </td>
            {days.map((d) => {
              const cellEntries = entries.filter((e) => e.memberId === m.id && e.date === d);
              return (
                <td key={d} className="border px-2 py-1.5" style={border}>
                  {cellEntries.length > 0
                    ? cellEntries.map((e) => `${e.startTime}–${e.endTime}`).join(", ")
                    : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── copy last week ───────────────────────────────────────────────────────

function CopyLastWeekButton({ locationId, weekStart }: { locationId: string; weekStart: string }) {
  const router = useRouter();
  const copyFn = useServerFn(copyPreviousWeek);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!window.confirm("Copy last week's rota into this week?")) return;
    setBusy(true);
    try {
      const result = await copyFn({ data: { locationId, weekStart } });
      toast.success(`Copied ${result.copied} shift${result.copied === 1 ? "" : "s"}`);
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't copy last week");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={run}>
      <Copy /> Copy last week
    </Button>
  );
}

// ── shift dialog (create / edit) ────────────────────────────────────────

function ShiftDialog({
  state,
  crew,
  locationId,
  onOpenChange,
}: {
  state: DialogState | null;
  crew: CrewRow[];
  locationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const upsertFn = useServerFn(upsertRotaEntry);
  const deleteFn = useServerFn(deleteRotaEntry);
  const [memberId, setMemberId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setMemberId(state.entry?.memberId ?? state.memberId ?? "");
    setStartTime(state.entry?.startTime ?? "");
    setEndTime(state.entry?.endTime ?? "");
    setNote(state.entry?.note ?? "");
  }, [state]);

  const isEditing = Boolean(state?.entry);
  const showMemberSelect = !isEditing && !state?.memberId;
  const memberName = crew.find((m) => m.id === memberId)?.name;

  async function submit() {
    if (!state) return;
    if (!memberId) {
      toast.error("Choose who's working");
      return;
    }
    if (!startTime || !endTime) {
      toast.error("Set a start and end time");
      return;
    }
    setBusy(true);
    try {
      await upsertFn({
        data: {
          id: state.entry?.id,
          locationId,
          memberId,
          date: state.date,
          startTime,
          endTime,
          note: note.trim() || undefined,
        },
      });
      toast.success(isEditing ? "Shift updated" : "Shift added");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the shift");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!state?.entry) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: state.entry.id } });
      toast.success("Shift removed");
      router.invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the shift");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEditing ? "Edit shift" : "Add shift"}
        description={
          state
            ? dayLabel(state.date, { weekday: "long", day: "numeric", month: "long" })
            : undefined
        }
      >
        <div className="flex flex-col gap-5">
          {showMemberSelect ? (
            <Field label="Crew member">
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose who's working" />
                </SelectTrigger>
                <SelectContent>
                  {crew.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="font-display text-xl uppercase text-foreground">{memberName ?? "—"}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start">
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End">
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>

          <Field label="Note (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Trial shift, cover, etc."
            />
          </Field>

          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : isEditing ? "Save changes" : "Add shift"}
          </Button>
          {isEditing ? (
            <Button type="button" variant="destructive" disabled={busy} onClick={remove}>
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
