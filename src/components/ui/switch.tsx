import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border-2 border-foreground transition-colors",
        "data-[state=checked]:bg-pop data-[state=unchecked]:bg-muted",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 bg-foreground transition-transform",
          "data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-ink data-[state=unchecked]:translate-x-[2px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
