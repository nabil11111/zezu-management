import { cn } from "@/lib/utils";

/**
 * The miniature: a tiny top-down pixel shop floor, one little character per
 * person currently on the clock. Hover (or tap) a character for their name,
 * role and how long they've been in. Pure SVG/CSS — no image assets — with
 * a fixed illustration palette so the scene reads the same in both themes.
 */

export interface PixelCrewMember {
  memberId: string;
  name: string;
  role: string;
  clockInAt: string;
}

// ── deterministic looks ─────────────────────────────────────────────────

const SKIN = ["#f2c9a1", "#e0ac7e", "#c68d5e", "#a06a42", "#7c4f2c"];
const HAIR = ["#241f1c", "#4a3323", "#7b4a12", "#b3822e", "#111111", "#5b5b5b"];
const STAFF_SHIRT = ["#3f6bb5", "#3e8f5a", "#c9a44c", "#7c5cbf", "#4f8f8b", "#b55e3f"];
const MANAGER_SHIRT = "#ea2526"; // managers wear the brand red

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function look(member: PixelCrewMember) {
  const h = hash(member.memberId);
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >> 3) % HAIR.length],
    shirt:
      member.role === "manager" || member.role === "ceo"
        ? MANAGER_SHIRT
        : STAFF_SHIRT[(h >> 6) % STAFF_SHIRT.length],
    flip: (h >> 9) % 2 === 1,
  };
}

function elapsedLabel(clockInAt: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(clockInAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

// ── sprites ─────────────────────────────────────────────────────────────

/** A 14×18 pixel person, drawn in rects. */
function PixelPerson({
  skin,
  hair,
  shirt,
  flip,
}: {
  skin: string;
  hair: string;
  shirt: string;
  flip: boolean;
}) {
  return (
    <svg
      viewBox="0 0 14 18"
      width="28"
      height="36"
      shapeRendering="crispEdges"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden
    >
      {/* shadow */}
      <rect x="3" y="16.5" width="8" height="1.5" fill="rgba(0,0,0,0.28)" />
      {/* legs */}
      <rect x="4" y="13" width="2.5" height="3.5" fill="#2a2320" />
      <rect x="7.5" y="13" width="2.5" height="3.5" fill="#2a2320" />
      {/* body */}
      <rect x="3" y="8" width="8" height="5" fill={shirt} />
      {/* arms */}
      <rect x="2" y="8.5" width="1.5" height="3.5" fill={shirt} />
      <rect x="10.5" y="8.5" width="1.5" height="3.5" fill={shirt} />
      <rect x="2" y="11.5" width="1.5" height="1" fill={skin} />
      <rect x="10.5" y="11.5" width="1.5" height="1" fill={skin} />
      {/* head */}
      <rect x="3.5" y="2.5" width="7" height="6" fill={skin} />
      {/* eyes */}
      <rect x="5" y="5.5" width="1" height="1.2" fill="#1c1512" />
      <rect x="8" y="5.5" width="1" height="1.2" fill="#1c1512" />
      {/* hair */}
      <rect x="3" y="1" width="8" height="2.5" fill={hair} />
      <rect x="3" y="3" width="1.5" height="2.5" fill={hair} />
      <rect x="9.5" y="3" width="1.5" height="2.5" fill={hair} />
    </svg>
  );
}

/** Wall dressing: a little framed landscape. */
function PixelPicture() {
  return (
    <svg viewBox="0 0 12 9" width="24" height="18" shapeRendering="crispEdges" aria-hidden>
      <rect x="0" y="0" width="12" height="9" fill="#6e4a26" />
      <rect x="1" y="1" width="10" height="7" fill="#8fc4dd" />
      <rect x="1" y="5" width="10" height="3" fill="#5d9c53" />
      <rect x="7" y="2" width="2" height="2" fill="#f2e2ac" />
    </svg>
  );
}

/** Wall dressing: a pixel clock (static face — the header has the real one). */
function PixelClock() {
  return (
    <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden>
      <rect x="0" y="0" width="8" height="8" fill="#e8e4da" />
      <rect x="0" y="0" width="8" height="1" fill="#4a4137" />
      <rect x="0" y="7" width="8" height="1" fill="#4a4137" />
      <rect x="0" y="0" width="1" height="8" fill="#4a4137" />
      <rect x="7" y="0" width="1" height="8" fill="#4a4137" />
      <rect x="3.5" y="2" width="1" height="2.5" fill="#1c1512" />
      <rect x="3.5" y="4" width="2" height="1" fill="#ea2526" />
    </svg>
  );
}

/** A potted plant for the corner. */
function PixelPlant() {
  return (
    <svg viewBox="0 0 10 12" width="20" height="24" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="8" width="4" height="4" fill="#a3512e" />
      <rect x="2.5" y="8" width="5" height="1" fill="#7c3a1e" />
      <rect x="4" y="4" width="2" height="4" fill="#3e8f5a" />
      <rect x="2" y="3" width="2" height="3" fill="#4da96c" />
      <rect x="6" y="2" width="2" height="4" fill="#2f7a49" />
      <rect x="4" y="1" width="2" height="2" fill="#4da96c" />
    </svg>
  );
}

/** The serving counter with a till and a steaming wok. */
function PixelCounter() {
  return (
    <div className="pointer-events-none absolute left-[8%] top-[26px] flex items-end">
      <svg viewBox="0 0 46 14" width="138" height="42" shapeRendering="crispEdges" aria-hidden>
        {/* counter top + face */}
        <rect x="0" y="4" width="46" height="3" fill="#8a5f33" />
        <rect x="0" y="7" width="46" height="7" fill="#6e4a26" />
        <rect x="0" y="7" width="46" height="1" fill="#5a3b1e" />
        {/* red trim — the brand stripe */}
        <rect x="0" y="12" width="46" height="1" fill="#b3453c" />
        {/* till */}
        <rect x="4" y="0" width="7" height="4" fill="#3a3f4b" />
        <rect x="5" y="1" width="5" height="1.5" fill="#9fd0c9" />
        {/* wok */}
        <rect x="26" y="2" width="9" height="2" fill="#23201d" />
        <rect x="27" y="1" width="7" height="1" fill="#3a352f" />
        {/* steam */}
        <rect x="29" y="-0.5" width="1" height="1" fill="rgba(240,240,235,0.7)" />
        <rect x="31" y="-1.5" width="1" height="1" fill="rgba(240,240,235,0.5)" />
      </svg>
    </div>
  );
}

// ── the scene ───────────────────────────────────────────────────────────

export function PixelCrew({
  members,
  now,
  dim = false,
  className,
}: {
  members: PixelCrewMember[];
  /** Ticking Date.now() from the page — keeps the "time in" labels live. */
  now: number;
  /** Grey the scene out (shop closed / not opened). */
  dim?: boolean;
  className?: string;
}) {
  const count = members.length;

  return (
    <div
      className={cn(
        "relative w-full select-none overflow-hidden border-2 border-foreground/15 transition-all",
        dim && "opacity-60 grayscale",
        className,
      )}
      style={{ height: 132 }}
    >
      {/* wall */}
      <div className="absolute inset-x-0 top-0 h-[34px]" style={{ background: "#2c3547" }}>
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: "#1f2634" }} />
        <div className="absolute left-[10%] top-[6px]">
          <PixelPicture />
        </div>
        <div className="absolute right-[12%] top-[7px]">
          <PixelClock />
        </div>
      </div>

      {/* wood-plank floor */}
      <div
        className="absolute inset-x-0 bottom-0 top-[34px]"
        style={{
          background:
            "repeating-linear-gradient(0deg, #b98d55 0px, #b98d55 10px, #a87c47 10px, #a87c47 11px)",
        }}
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "repeating-linear-gradient(90deg, transparent 0px, transparent 34px, #9a7040 34px, #9a7040 35px)",
          }}
        />
      </div>

      <PixelCounter />

      {/* corner plants */}
      <div className="pointer-events-none absolute bottom-1 left-1.5">
        <PixelPlant />
      </div>
      <div className="pointer-events-none absolute bottom-1 right-1.5">
        <PixelPlant />
      </div>

      {/* the crew */}
      {count === 0 ? (
        <p className="absolute inset-x-0 bottom-[26px] text-center font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black/45">
          Nobody on the clock
        </p>
      ) : (
        members.map((member, i) => {
          const looks = look(member);
          // Spread across the floor; alternate two rows for depth.
          const left = count === 1 ? 50 : 16 + (i * 68) / Math.max(count - 1, 1);
          const backRow = i % 2 === 1;
          const nearLeft = left < 22;
          const nearRight = left > 78;
          return (
            <button
              key={member.memberId}
              className="group absolute z-10 -translate-x-1/2 cursor-help outline-none"
              style={{
                left: `${left}%`,
                bottom: backRow ? 44 : 14,
                zIndex: backRow ? 5 : 10,
              }}
              aria-label={`${member.name} — on the clock since ${timeLabel(member.clockInAt)}`}
            >
              <span
                className="pixel-bob block"
                style={{ animationDelay: `${(hash(member.memberId) % 7) * 0.21}s` }}
              >
                <PixelPerson {...looks} />
              </span>
              {/* tooltip */}
              <span
                className={cn(
                  "pointer-events-none absolute bottom-full z-30 mb-1.5 hidden w-max max-w-[180px] flex-col border-2 border-foreground bg-popover px-2.5 py-1.5 text-left shadow-neo-sm group-hover:flex group-focus-visible:flex group-focus:flex",
                  nearLeft ? "left-0" : nearRight ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                <span className="text-xs font-bold text-foreground">{member.name}</span>
                <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {member.role === "manager" ? "Manager" : "Crew"} · in{" "}
                  {timeLabel(member.clockInAt)}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-pop">
                  {elapsedLabel(member.clockInAt, now)} on the clock
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
