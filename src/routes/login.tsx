import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { OTPInput, type SlotProps } from "input-otp";
import { toast } from "sonner";
import { login, checkSession } from "@/lib/auth";
import { ZezuLogo } from "@/components/zezu-logo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    // Already unlocked? Straight to the dashboard.
    if (await checkSession()) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

// One code each — exactly four digits, no usernames, no passwords.
const CODE_LENGTH = 4;

function CodeSlot({ slot }: { slot: SlotProps }) {
  return (
    <div
      className={cn(
        "relative flex size-14 items-center justify-center border-2 bg-background font-mono text-2xl font-bold text-foreground transition-all md:size-16",
        slot.isActive ? "border-pop shadow-pop" : "border-foreground/30",
      )}
    >
      {slot.char ? "•" : null}
      {slot.isActive && !slot.char ? <span className="h-7 w-0.5 animate-pulse bg-pop" /> : null}
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const loginFn = useServerFn(login);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit(value: string) {
    setChecking(true);
    setError(false);
    try {
      const result = await loginFn({ data: { code: value } });
      if (result?.name) toast.success(`Welcome back, ${result.name}`);
      await navigate({ to: "/" });
    } catch {
      setError(true);
      setCode("");
      setChecking(false);
    }
  }

  return (
    <div className="grain relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6">
      {/* corner marks — the poster frame */}
      <div className="pointer-events-none absolute inset-6 hidden md:block">
        <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-pop/50" />
        <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-pop/50" />
        <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-pop/50" />
        <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-pop/50" />
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        <ZezuLogo animate className="text-4xl" subtitle="Operations" />
        <p className="mt-4 font-chinese text-xs tracking-[0.5em] text-gold/80">
          正宗 · 现代 · 利物浦
        </p>

        <div className={cn("mt-12 flex flex-col items-center gap-5", error && "shake")}>
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
            {checking ? "Checking…" : error ? "Wrong code — try again" : "Enter your 4-digit code"}
          </p>
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground/40">
        ZEZU — The Modern Chinese · one bite is never enough
      </p>
    </div>
  );
}
