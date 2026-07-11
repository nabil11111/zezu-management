import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-xs font-bold uppercase tracking-wide transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        // The signature: yellow slab, hard shadow, presses into place on hover
        pop: "bg-pop text-ink border-2 border-foreground shadow-neo hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]",
        outline:
          "bg-transparent text-foreground border-2 border-foreground shadow-neo-sm hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-foreground hover:text-background",
        ghost: "text-foreground hover:bg-muted border-2 border-transparent",
        destructive:
          "bg-destructive text-destructive-foreground border-2 border-foreground shadow-neo-sm hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]",
        solid:
          "bg-foreground text-background border-2 border-foreground shadow-pop hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px]",
      },
      size: {
        sm: "h-8 px-3 text-[10px] [&_svg]:size-3.5",
        default: "h-10 px-5 [&_svg]:size-4",
        lg: "h-12 px-7 text-sm [&_svg]:size-4",
        icon: "size-10 [&_svg]:size-4",
        "icon-sm": "size-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "pop", size: "default" },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
