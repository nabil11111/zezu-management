import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF export, the house way: every "Download PDF" is the browser's
 * print-to-PDF against a hidden, print-only report portaled under <body>.
 * The print CSS (styles.css) hides the whole app and shows only this,
 * on paper-white with the light palette, flowing across pages.
 *
 * Usage — keep it mounted on the page, then any button can print it:
 *   <PrintReport title="Timesheets" subtitle="Lodge Lane — last 14 days">
 *     <table>…</table>
 *   </PrintReport>
 *   <DownloadPdfButton />
 */
export function PrintReport({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  // Portals need document — render only after mount (SSR-safe).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="print-report light">
      <div
        className="mb-6 flex items-end justify-between gap-4 border-b-4 pb-4"
        style={{ borderColor: "#ea2526" }}
      >
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#6e6455]">
            ZEZU — The Modern Chinese · Operations
          </p>
          <h1 className="mt-1 font-display text-4xl font-extrabold uppercase text-[#1b1510]">
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-[#6e6455]">{subtitle}</p> : null}
        </div>
        <img src="/zezu-logo.png" alt="ZEZU" className="h-16 w-auto" />
      </div>
      {children}
      <p className="mt-8 border-t pt-3 font-mono text-[9px] uppercase tracking-[0.25em] text-[#6e6455]">
        Generated{" "}
        {new Date().toLocaleString("en-GB", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Europe/London",
        })}{" "}
        · ZEZU Operations
      </p>
    </div>,
    document.body,
  );
}

/** The matching trigger — window.print() does the rest. */
export function DownloadPdfButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Download /> {label}
    </Button>
  );
}
