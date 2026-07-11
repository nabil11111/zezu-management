import { cn } from "@/lib/utils";

/**
 * The ZEZU wordmark — bold condensed caps with the brand red, and an
 * optional Chinese accent line (正宗 · 现代 · 利物浦). Pure type, no image
 * assets, so it scales anywhere from the sidebar to the login screen.
 */
export function ZezuLogo({
  className,
  animate = false,
  subtitle,
}: {
  className?: string;
  animate?: boolean;
  /** Small mono line under the wordmark, e.g. "OPERATIONS". */
  subtitle?: string;
}) {
  const letters = ["Z", "E", "Z", "U"];
  return (
    <span className={cn("inline-flex flex-col items-center leading-none", className)}>
      <span className="flex items-baseline">
        {letters.map((letter, i) => (
          <span
            key={i}
            className={cn(
              "font-display text-[2.6em] font-extrabold uppercase leading-[0.85]",
              i >= 2 ? "text-pop" : "text-foreground",
              animate && "letter-pop",
            )}
            style={
              animate
                ? {
                    animationDelay: `${i * 90}ms`,
                    ["--pop-from" as string]: i % 2 ? "-48px" : "-28px",
                    ["--pop-rot" as string]: i % 2 ? "-8deg" : "8deg",
                  }
                : undefined
            }
          >
            {letter}
          </span>
        ))}
        <span
          className={cn(
            "ml-1.5 self-start font-chinese text-[0.8em] leading-none text-gold",
            animate && "fade-up",
          )}
          style={animate ? { animationDelay: "420ms" } : undefined}
        >
          泽
        </span>
      </span>
      {subtitle ? (
        <span className="mt-[0.5em] font-mono text-[0.55em] font-bold uppercase tracking-[0.4em] text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
