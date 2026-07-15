import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  PoundSterling,
  Package,
  PackageCheck,
  Truck,
  UtensilsCrossed,
  UserRound,
  Clock,
  Settings,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { logout } from "@/lib/auth";
import type { Actor } from "@/lib/auth.server";
import { ZezuLogo } from "@/components/zezu-logo";
import { cn } from "@/lib/utils";

/**
 * Role-aware nav. What your code opens depends on who you are:
 *   ceo       → everything, every location
 *   manager   → their locations: live view, sales, stock, orders, shifts, crew
 *   staff     → their own shifts, stock orders, the menu (training videos)
 *   warehouse → every branch's stock orders, to dispatch them
 */
const NAV = [
  { to: "/", label: "Live", icon: LayoutDashboard, exact: true, roles: ["ceo", "manager"] },
  { to: "/insights", label: "Insights", icon: BarChart3, roles: ["ceo"] },
  { to: "/sales", label: "Sales", icon: PoundSterling, roles: ["ceo", "manager"] },
  { to: "/stock", label: "Stock", icon: Package, roles: ["ceo", "manager"] },
  { to: "/orders", label: "Orders", icon: PackageCheck, roles: ["ceo", "manager", "staff"] },
  { to: "/warehouse", label: "Warehouse", icon: Truck, roles: ["ceo", "warehouse"] },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["ceo", "manager", "staff"] },
  { to: "/people", label: "People", icon: UserRound, roles: ["ceo", "manager"] },
  { to: "/rota", label: "Rota", icon: CalendarDays, roles: ["ceo", "manager", "staff"] },
  { to: "/shifts", label: "Shifts", icon: Clock, roles: ["ceo", "manager"] },
  { to: "/my", label: "My Shifts", icon: Clock, roles: ["staff", "warehouse"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["ceo"] },
] as const;

const ROLE_LABEL: Record<Actor["role"], string> = {
  ceo: "CEO",
  manager: "Manager",
  staff: "Crew",
  warehouse: "Warehouse",
};

/** Swaps .dark/.light on <html> and remembers the choice. Default is dark. */
function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !light;
    const cls = document.documentElement.classList;
    cls.toggle("light", next);
    cls.toggle("dark", !next);
    try {
      localStorage.setItem("zezu-theme", next ? "light" : "dark");
    } catch {
      // Private browsing — the toggle still works for this visit.
    }
    setLight(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      className="flex w-full cursor-pointer items-center gap-3 border-2 border-transparent px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground transition-all hover:border-foreground/30 hover:text-foreground"
    >
      {light ? (
        <Moon className="size-4" strokeWidth={2.5} />
      ) : (
        <Sun className="size-4" strokeWidth={2.5} />
      )}
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}

function NavLinks({ role, onNavigate }: { role: Actor["role"]; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-col gap-1">
      {NAV.filter((item) => (item.roles as readonly string[]).includes(role)).map(
        ({ to, label, icon: Icon, ...rest }) => {
          const exact = "exact" in rest && rest.exact;
          const active = exact ? pathname === to : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 border-2 px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-widest transition-all",
                active
                  ? "border-foreground bg-pop text-ink shadow-neo-sm"
                  : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={2.5} />
              {label}
            </Link>
          );
        },
      )}
    </nav>
  );
}

function LogoutButton() {
  const navigate = useNavigate();
  const logoutFn = useServerFn(logout);
  return (
    <button
      onClick={async () => {
        await logoutFn({});
        navigate({ to: "/login" });
      }}
      className="flex w-full cursor-pointer items-center gap-3 border-2 border-transparent px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground transition-all hover:border-destructive hover:text-destructive"
    >
      <LogOut className="size-4" strokeWidth={2.5} />
      Lock up
    </button>
  );
}

export function AppShell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const identity = (
    <div className="border-t-2 border-foreground/15 px-3 py-3">
      <p className="truncate text-sm font-bold text-foreground">{actor.name}</p>
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-gold">
        {ROLE_LABEL[actor.role]}
      </p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r-2 border-foreground/15 bg-sidebar lg:flex">
        <Link to="/" className="flex items-center border-b-2 border-foreground/15 px-5 py-4">
          <ZezuLogo className="h-10" />
          <span className="ml-3 mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
            OPS
          </span>
        </Link>
        <div className="flex flex-1 flex-col justify-between overflow-y-auto p-3">
          <NavLinks role={actor.role} />
          <div>
            {identity}
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b-2 border-foreground/15 bg-background px-4 py-3 lg:hidden">
        <Link to="/" onClick={() => setMobileOpen(false)}>
          <ZezuLogo className="h-8" />
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="border-2 border-foreground p-2 text-foreground shadow-neo-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? (
            <X className="size-5" strokeWidth={2.5} />
          ) : (
            <Menu className="size-5" strokeWidth={2.5} />
          )}
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-background pt-16 lg:hidden">
          <div className="flex h-full flex-col justify-between p-4">
            <NavLinks role={actor.role} onNavigate={() => setMobileOpen(false)} />
            <div>
              {identity}
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="min-w-0 flex-1 px-5 pb-20 pt-22 lg:ml-60 lg:px-12 lg:pb-24 lg:pt-12">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}

/** Standard page header: mono kicker + condensed display title + actions slot. */
export function PageHeader({
  kicker,
  title,
  actions,
  className,
}: {
  kicker: string;
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-10 flex flex-wrap items-end justify-between gap-5", className)}>
      <div>
        <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
          — {kicker}
        </p>
        <h1 className="font-display text-4xl font-extrabold uppercase text-foreground md:text-5xl">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
