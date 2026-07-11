import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-foreground/30 text-muted-foreground",
        pop: "border-foreground bg-pop text-ink",
        solid: "border-foreground bg-foreground text-background",
        outline: "border-foreground text-foreground",
        danger: "border-destructive text-destructive",
        success: "border-emerald-500/70 text-emerald-400",
        warning: "border-amber-500/70 text-amber-400",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Consistent status → tone mapping across the app. */
export const STATUS_TONE: Record<string, VariantProps<typeof badgeVariants>["tone"]> = {
  // clients
  lead: "neutral",
  onboarded: "warning",
  active: "pop",
  completed: "success",
  archived: "neutral",
  // projects
  planned: "neutral",
  in_progress: "pop",
  delivered: "success",
  published: "solid",
  // steps
  upcoming: "neutral",
  done: "success",
  skipped: "neutral",
  // documents
  draft: "neutral",
  sent: "warning",
  accepted: "success",
  paid: "success",
  void: "danger",
  // testimonials
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} className={className}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
