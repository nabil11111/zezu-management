import { QRCodeSVG } from "qrcode.react";
import { ZezuLogo } from "@/components/zezu-logo";

/**
 * The door poster — one printed per location, framed by the entrance.
 * Scanning the code opens `/clock/$qrToken`, which clocks the scanning
 * crew member into THIS shop. Regenerating the token (see Settings) kills
 * the old poster dead, so this needs reprinting whenever that happens.
 *
 * Styled by the `.qr-poster` rules in src/styles.css: on-screen it renders
 * as an A4-proportioned card, on `window.print()` it's the only thing that
 * survives, sized to a real A4 sheet.
 */
export function QrPoster({ locationName, clockUrl }: { locationName: string; clockUrl: string }) {
  return (
    <div className="qr-poster dark relative mx-auto flex aspect-[210/297] w-full max-w-[540px] flex-col items-center bg-background px-8 py-10 text-center text-foreground sm:px-10 sm:py-12">
      {/* corner marks — the poster frame, same device as the login screen */}
      <span className="pointer-events-none absolute left-5 top-5 h-8 w-8 border-l-2 border-t-2 border-pop" />
      <span className="pointer-events-none absolute right-5 top-5 h-8 w-8 border-r-2 border-t-2 border-pop" />
      <span className="pointer-events-none absolute bottom-5 left-5 h-8 w-8 border-b-2 border-l-2 border-pop" />
      <span className="pointer-events-none absolute bottom-5 right-5 h-8 w-8 border-b-2 border-r-2 border-pop" />

      <ZezuLogo className="mt-2 h-24 sm:h-28" subtitle="Operations" />
      <p className="mt-3 font-chinese text-xs tracking-[0.5em] text-gold/80">
        正宗 · 现代 · 利物浦
      </p>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
        <h1 className="font-display text-5xl font-extrabold uppercase leading-[0.88] text-foreground sm:text-6xl">
          Scan to
          <br />
          <span className="text-pop">Clock In</span>
        </h1>

        <div className="border-2 border-foreground bg-ink p-5 shadow-pop">
          <QRCodeSVG value={clockUrl} size={256} level="M" fgColor="#080808" bgColor="#F2EDE6" />
        </div>

        <div>
          <p className="font-display text-3xl font-extrabold uppercase text-gold sm:text-4xl">
            {locationName}
          </p>
          <p className="mt-2 font-chinese text-lg text-gold/70">扫码上班</p>
        </div>

        <p className="max-w-xs font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Scan · tap in your 4-digit code · start your shift
        </p>
      </div>

      <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60">
        ZEZU — The Modern Chinese · one bite is never enough
      </p>
    </div>
  );
}
