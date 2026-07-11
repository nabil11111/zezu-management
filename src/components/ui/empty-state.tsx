import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 border-2 border-dashed border-foreground/20 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="border-2 border-foreground bg-pop p-3 text-ink shadow-neo-sm">
        <Icon className="size-6" strokeWidth={2.5} />
      </div>
      <p className="font-display text-2xl uppercase text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20">
      <span className="size-3 animate-pulse bg-pop" />
      <span className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}…
      </span>
    </div>
  );
}
