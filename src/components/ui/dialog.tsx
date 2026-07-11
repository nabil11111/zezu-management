import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  wide = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          wide ? "max-w-3xl" : "max-w-lg",
          "border-2 border-foreground bg-background shadow-neo",
          "max-h-[85vh] flex flex-col",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b-2 border-foreground bg-pop px-4 py-2.5 shrink-0">
          <DialogPrimitive.Title className="font-mono text-xs font-bold uppercase tracking-widest text-ink">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="text-ink hover:opacity-70 transition-opacity cursor-pointer"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={3} />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="px-4 pt-3 text-xs text-muted-foreground shrink-0">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="overflow-y-auto p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
