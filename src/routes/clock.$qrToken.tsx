import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { OTPInput, type SlotProps } from "input-otp";
import { ZezuLogo } from "@/components/zezu-logo";
import { cn } from "@/lib/utils";
import { getClockContext, clockAction, openShopViaQr } from "@/server/shifts";

/**
 * The door poster. No auth — anyone scanning the QR lands here, taps their
 * 4-digit code, and clocks in or out. Lives outside `_authed` on purpose:
 * this is used standing at the shop door, often before anyone's signed in
 * on the dashboard at all.
 */
export const Route = createFileRoute("/clock/$qrToken")({
  loader: async ({ params }) => ({
    context: await getClockContext({ data: { qrToken: params.qrToken } }),
  }),
  errorComponent: ClockErrorScreen,
  component: ClockPage,
});

const CODE_LENGTH = 4;
const RESET_MS = 6000;

function PosterFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 py-10">
      <div className="pointer-events-none absolute inset-6 hidden md:block">
        <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-pop/50" />
        <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-pop/50" />
        <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-pop/50" />
        <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-pop/50" />
      </div>
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        {children}
      </div>
      <p className="absolute bottom-6 font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40">
        ZEZU — The Modern Chinese · scan, tap, clocked
      </p>
    </div>
  );
}

function ClockErrorScreen() {
  return (
    <PosterFrame>
      <ZezuLogo className="h-20" />
      <p className="mt-10 font-display text-3xl uppercase leading-tight text-foreground">
        This poster isn&apos;t active
      </p>
      <p className="mt-3 max-w-xs text-sm text-muted-foreground">
        This QR code isn&apos;t linked to a shop. Find a manager, or check the poster by the door.
      </p>
    </PosterFrame>
  );
}

function CodeSlot({ slot }: { slot: SlotProps }) {
  return (
    <div
      className={cn(
        "relative flex size-16 items-center justify-center border-2 bg-background font-mono text-3xl font-bold text-foreground transition-all md:size-20",
        slot.isActive ? "border-pop shadow-pop" : "border-foreground/30",
      )}
    >
      {slot.char ? "•" : null}
      {slot.isActive && !slot.char ? <span className="h-8 w-0.5 animate-pulse bg-pop" /> : null}
    </div>
  );
}

type ClockOutcome = Awaited<ReturnType<typeof clockAction>>;
type OpenOutcome = Awaited<ReturnType<typeof openShopViaQr>>;
type Outcome = ClockOutcome | OpenOutcome;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function OutcomeView({
  outcome,
  checking,
  onOpenShop,
  onDone,
}: {
  outcome: Outcome;
  checking: boolean;
  onOpenShop: () => void;
  onDone: () => void;
}) {
  switch (outcome.kind) {
    case "clocked_in":
      return (
        <button onClick={onDone} className="flex w-full flex-col items-center gap-3 text-center">
          <p className="font-display text-4xl uppercase leading-[0.95] text-pop md:text-5xl">
            You&apos;re in, {outcome.name}
          </p>
          <p className="font-mono text-sm font-bold uppercase tracking-widest text-foreground">
            {formatTime(outcome.clockInAt)}
          </p>
        </button>
      );
    case "clocked_out":
      return (
        <button onClick={onDone} className="flex w-full flex-col items-center gap-3 text-center">
          <p className="font-display text-4xl uppercase leading-[0.95] text-foreground md:text-5xl">
            Clocked out, {outcome.name}
          </p>
          <p className="font-mono text-sm font-bold uppercase tracking-widest text-gold">
            {outcome.hours != null ? `${outcome.hours.toFixed(2)} hrs worked` : "shift logged"} ·{" "}
            {formatTime(outcome.clockOutAt)}
          </p>
        </button>
      );
    case "shop_closed":
      return (
        <button onClick={onDone} className="flex w-full flex-col items-center gap-3 text-center">
          <p className="font-display text-3xl uppercase leading-tight text-foreground md:text-4xl">
            The shop isn&apos;t open yet
          </p>
          <p className="text-sm text-muted-foreground">Find your manager to get the day started.</p>
        </button>
      );
    case "open_elsewhere":
      return (
        <button onClick={onDone} className="flex w-full flex-col items-center gap-3 text-center">
          <p className="font-display text-3xl uppercase leading-tight text-foreground md:text-4xl">
            Still clocked in at {outcome.locationName}
          </p>
          <p className="text-sm text-muted-foreground">Clock out there first, {outcome.name}.</p>
        </button>
      );
    case "can_open":
      return (
        <div className="flex w-full flex-col items-center gap-4 text-center">
          <p className="font-display text-3xl uppercase leading-tight text-foreground md:text-4xl">
            Morning, {outcome.name}
          </p>
          <p className="text-sm text-muted-foreground">
            Nobody&apos;s opened up yet — you&apos;re clear to start the day.
          </p>
          <button
            onClick={onOpenShop}
            disabled={checking}
            className="w-full border-2 border-foreground bg-pop px-6 py-4 font-mono text-sm font-bold uppercase tracking-widest text-ink shadow-neo transition-all hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none disabled:opacity-60"
          >
            {checking ? "Opening…" : "Open the shop"}
          </button>
        </div>
      );
    case "opened_and_clocked_in":
      return (
        <button onClick={onDone} className="flex w-full flex-col items-center gap-3 text-center">
          <p className="font-display text-4xl uppercase leading-[0.95] text-pop md:text-5xl">
            Shop&apos;s open.
          </p>
          <p className="font-display text-2xl uppercase text-foreground">
            You&apos;re on the clock, {outcome.name}.
          </p>
        </button>
      );
    default:
      return null;
  }
}

function ClockPage() {
  const { context } = Route.useLoaderData();
  const { qrToken } = Route.useParams();

  const clockFn = useServerFn(clockAction);
  const openFn = useServerFn(openShopViaQr);

  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [shopOpen, setShopOpen] = useState(context.isOpen);
  const lastCode = useRef("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  function scheduleReset() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setOutcome(null);
      setCode("");
    }, RESET_MS);
  }

  function resetNow() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setOutcome(null);
    setCode("");
  }

  async function submit(value: string) {
    setChecking(true);
    setError(false);
    lastCode.current = value;
    try {
      const result = await clockFn({ data: { qrToken, code: value } });
      if (result.kind === "clocked_in") setShopOpen(true);
      setOutcome(result);
      setChecking(false);
      scheduleReset();
    } catch {
      setError(true);
      setCode("");
      setChecking(false);
    }
  }

  async function handleOpenShop() {
    setChecking(true);
    try {
      const result = await openFn({ data: { qrToken, code: lastCode.current } });
      setShopOpen(true);
      setOutcome(result);
      setChecking(false);
      scheduleReset();
    } catch {
      setError(true);
      setOutcome(null);
      setCode("");
      setChecking(false);
    }
  }

  return (
    <PosterFrame>
      <ZezuLogo className="h-20" />
      <p className="mt-6 font-display text-3xl uppercase leading-none text-foreground md:text-4xl">
        {context.locationName}
      </p>
      <span
        className={cn(
          "mt-3 border-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest",
          shopOpen
            ? "border-foreground bg-pop text-ink"
            : "border-foreground/30 text-muted-foreground",
        )}
      >
        {shopOpen ? "Open" : "Closed"}
      </span>

      <div className="mt-12 w-full">
        {outcome ? (
          <OutcomeView
            outcome={outcome}
            checking={checking}
            onOpenShop={handleOpenShop}
            onDone={resetNow}
          />
        ) : (
          <div className={cn("flex flex-col items-center gap-5", error && "shake")}>
            <OTPInput
              autoFocus
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(v) => {
                setCode(v);
                setError(false);
                if (v.length === CODE_LENGTH) submit(v);
              }}
              disabled={checking}
              containerClassName="flex items-center gap-3"
              render={({ slots }) => (
                <>
                  {slots.map((slot, i) => (
                    <CodeSlot key={i} slot={slot} />
                  ))}
                </>
              )}
            />
            <p
              className={cn(
                "h-4 font-mono text-[10px] font-bold uppercase tracking-widest",
                error ? "text-destructive" : "text-muted-foreground/60",
              )}
            >
              {checking ? "Checking…" : error ? "Wrong code — try again" : "Tap your 4-digit code"}
            </p>
          </div>
        )}
      </div>
    </PosterFrame>
  );
}
