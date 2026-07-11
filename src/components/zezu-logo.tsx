import { cn } from "@/lib/utils";

/**
 * The real ZEZU logo from zezu.co.uk (/public/zezu-logo.png, transparent):
 * red ZEZU with the bowl-and-chopsticks U, gold "The Modern Chinese"
 * tagline baked in. `className` sizes the IMAGE (set a height, e.g. h-10 —
 * width follows the logo's aspect ratio).
 */
export function ZezuLogo({
  className,
  animate = false,
  subtitle,
}: {
  /** Applied to the img — set a height (h-8, h-28, …); defaults to h-10. */
  className?: string;
  animate?: boolean;
  /** Small mono line under the logo, e.g. "OPERATIONS". */
  subtitle?: string;
}) {
  return (
    <span className="inline-flex flex-col items-center">
      <img
        src="/zezu-logo.png"
        alt="ZEZU — The Modern Chinese"
        draggable={false}
        className={cn("w-auto select-none", animate && "fade-up", className ?? "h-10")}
      />
      {subtitle ? (
        <span
          className={cn(
            "mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground",
            animate && "fade-up",
          )}
          style={animate ? { animationDelay: "250ms" } : undefined}
        >
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
