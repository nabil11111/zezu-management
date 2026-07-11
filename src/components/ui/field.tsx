import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type LabelHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full border-2 border-foreground/25 bg-background px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground/60 transition-colors",
        "focus-visible:outline-none focus-visible:border-pop",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:font-mono file:text-xs file:font-bold file:uppercase file:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full border-2 border-foreground/25 bg-background px-3 py-2 text-sm text-foreground",
      "placeholder:text-muted-foreground/60 transition-colors resize-y",
      "focus-visible:outline-none focus-visible:border-pop",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Label + control stacked with consistent spacing. */
export function Field({
  label,
  className,
  children,
  hint,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}
