import { useEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { markWelcomeSeen } from "@/lib/auth";
import { ZezuLogo } from "@/components/zezu-logo";
import { cn } from "@/lib/utils";

/**
 * First-login welcome. New crew are held here (see the `_authed` layout
 * redirect) until they've watched the intro video through. There's no skip:
 * a direct video file plays with no seek controls and only unlocks Continue
 * on `ended`; an embedded (YouTube/Vimeo) link unlocks after a minimum
 * watch time. Once past, `markWelcomeSeen` stamps them so it never reappears.
 */
export const Route = createFileRoute("/_authed/welcome")({
  beforeLoad: ({ context }) => {
    // No video configured, or already watched → nothing to do here.
    if (!context.welcome.needsToWatch) throw redirect({ to: "/" });
    return { videoUrl: context.welcome.videoUrl };
  },
  component: WelcomePage,
});

const IFRAME_MIN_WATCH_MS = 20_000;

type Embed = { kind: "video" | "iframe" | "link"; src: string };

function toEmbed(url: string): Embed {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return { kind: "iframe", src: `https://www.youtube.com/embed/${v}?autoplay=1` };
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts)
        return { kind: "iframe", src: `https://www.youtube.com/embed/${shorts[1]}?autoplay=1` };
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}?autoplay=1` };
    }
    if (host === "vimeo.com") {
      const id = u.pathname.match(/^\/(\d+)/);
      if (id) return { kind: "iframe", src: `https://player.vimeo.com/video/${id[1]}?autoplay=1` };
    }
    if (/\.(mp4|webm|mov)$/i.test(u.pathname)) return { kind: "video", src: url };
  } catch {
    // fall through
  }
  return { kind: "link", src: url };
}

function WelcomePage() {
  const { videoUrl } = Route.useRouteContext();
  const navigate = useNavigate();
  const markSeen = useServerFn(markWelcomeSeen);
  const [done, setDone] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const embed = toEmbed(videoUrl ?? "");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Embedded players can't tell us when they've finished, so gate on a
  // minimum watch time instead. Direct <video> gates on the real `ended`.
  useEffect(() => {
    if (embed.kind === "video") return;
    const t = setTimeout(() => setDone(true), IFRAME_MIN_WATCH_MS);
    return () => clearTimeout(t);
  }, [embed.kind]);

  async function proceed() {
    setContinuing(true);
    try {
      await markSeen({});
      await navigate({ to: "/" });
    } catch {
      toast.error("Something went wrong — try again");
      setContinuing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <ZezuLogo className="h-16" />
        <p className="font-display text-3xl uppercase text-foreground md:text-4xl">
          Welcome to the team
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Watch this before you start — it only plays once.
        </p>
      </div>

      <div className="w-full max-w-3xl border-2 border-foreground bg-black shadow-neo">
        {embed.kind === "video" ? (
          <video
            ref={videoRef}
            src={embed.src}
            autoPlay
            playsInline
            onEnded={() => setDone(true)}
            className="aspect-video w-full"
          />
        ) : embed.kind === "iframe" ? (
          <iframe
            src={embed.src}
            title="ZEZU welcome"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="aspect-video w-full"
          />
        ) : (
          <a
            href={embed.src}
            target="_blank"
            rel="noreferrer"
            onClick={() => setDone(true)}
            className="flex aspect-video w-full items-center justify-center font-mono text-xs font-bold uppercase tracking-widest text-pop"
          >
            Open the welcome video ↗
          </a>
        )}
      </div>

      <button
        onClick={proceed}
        disabled={!done || continuing}
        className={cn(
          "border-2 px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest transition-all",
          done
            ? "cursor-pointer border-foreground bg-pop text-ink shadow-neo hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-none"
            : "cursor-not-allowed border-foreground/20 text-muted-foreground",
        )}
      >
        {continuing ? "One sec…" : done ? "I've watched it — let's go" : "Watch to continue…"}
      </button>
    </div>
  );
}
