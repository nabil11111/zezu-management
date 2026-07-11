/**
 * ZEZU demo seed. Run with:  bun scripts/seed.ts   (or `npm run db:seed`)
 * Re-run with --force to wipe and reseed everything.
 *
 * Seeds the three real sites, a crew with fixed 4-digit codes (printed at
 * the end — hand them out), the brand menu, per-site stock with a few low
 * flags, 14 days of sales + shop-day + verified-shift history, and a live
 * "shop is open right now" state so the dashboard demos well.
 */
import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const {
  locations,
  members,
  memberLocations,
  onboardingSteps,
  shopDays,
  shifts,
  stockItems,
  stockMoves,
  menuItems,
  salesEntries,
  activityLog,
} = schema;

const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("DATABASE_URL and SESSION_SECRET must be set (see .env)");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

/** Same algorithm as src/lib/auth.server.ts — HMAC-SHA256 keyed w/ SESSION_SECRET. */
const hashCode = (code: string) =>
  createHmac("sha256", SESSION_SECRET).update(code).digest("base64url");
const token = () => randomBytes(18).toString("base64url");

/** YYYY-MM-DD in UK time, offset by n days. */
function day(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}
/** A Date on `dateStr` at hh:mm (server-local approximation is fine for demo data). */
function at(dateStr: string, hh: number, mm = 0): Date {
  return new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
}
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

async function main() {
  const force = process.argv.includes("--force");
  const existing = await db.select({ id: locations.id }).from(locations).limit(1);
  if (existing.length > 0) {
    if (!force) {
      console.log("Database already seeded — run with --force to wipe and reseed.");
      await client.end();
      return;
    }
    console.log("— wiping existing data…");
    await db.delete(activityLog);
    await db.delete(salesEntries);
    await db.delete(stockMoves);
    await db.delete(stockItems);
    await db.delete(shifts);
    await db.delete(shopDays);
    await db.delete(onboardingSteps);
    await db.delete(memberLocations);
    await db.delete(members);
    await db.delete(menuItems);
    await db.delete(locations);
  }

  // ── locations ──────────────────────────────────────────────────────────
  console.log("— locations");
  const [lodgeLane, anfield, wallasey] = await db
    .insert(locations)
    .values([
      {
        name: "Lodge Lane",
        slug: "lodge-lane",
        address: "46E Lodge Ln, Liverpool L8 0QT",
        qrToken: token(),
        sortOrder: 0,
      },
      {
        name: "Anfield",
        slug: "anfield",
        address: "129 Oakfield Rd, Liverpool L4 0UE",
        qrToken: token(),
        sortOrder: 1,
      },
      {
        name: "Wallasey",
        slug: "wallasey",
        address: "243 Rake Ln, Wallasey CH45 5DJ",
        qrToken: token(),
        sortOrder: 2,
      },
    ])
    .returning();

  // ── crew (fixed demo codes, printed at the end) ────────────────────────
  console.log("— crew");
  const CREW = [
    { name: "Head Office", role: "ceo", code: "8888", rate: null, sites: [] as string[] },
    {
      name: "Central Warehouse",
      role: "warehouse",
      code: "7777",
      rate: null,
      sites: [] as string[],
    },
    { name: "Wei Chen", role: "manager", code: "1111", rate: "14.50", sites: [lodgeLane.id] },
    { name: "Sara Hughes", role: "manager", code: "2222", rate: "14.50", sites: [anfield.id] },
    { name: "Jamal Carter", role: "manager", code: "3333", rate: "14.50", sites: [wallasey.id] },
    { name: "Aisha Khan", role: "staff", code: "4444", rate: "12.00", sites: [lodgeLane.id] },
    { name: "Li Na", role: "staff", code: "4545", rate: "11.50", sites: [lodgeLane.id] },
    { name: "Tom Price", role: "staff", code: "5555", rate: "11.50", sites: [anfield.id] },
    { name: "Maya Osei", role: "staff", code: "5656", rate: "12.00", sites: [anfield.id] },
    { name: "Ken Wong", role: "staff", code: "6666", rate: "12.50", sites: [wallasey.id] },
    { name: "Ella Byrne", role: "staff", code: "6767", rate: "11.50", sites: [wallasey.id] },
  ] as const;

  const memberRows = await db
    .insert(members)
    .values(
      CREW.map((c, i) => ({
        name: c.name,
        role: c.role,
        codeHash: hashCode(c.code),
        hourlyRate: c.rate,
        startedAt: day(-120 + i * 7),
      })),
    )
    .returning();
  const byName = Object.fromEntries(memberRows.map((m) => [m.name, m]));

  await db
    .insert(memberLocations)
    .values(
      CREW.flatMap((c) =>
        c.sites.map((locationId) => ({ memberId: byName[c.name].id, locationId })),
      ),
    );

  const ONBOARDING = [
    "Documents in",
    "Menu & training videos watched",
    "Trial shift done",
    "Code handed over",
  ];
  await db.insert(onboardingSteps).values(
    memberRows
      .filter((m) => m.role !== "ceo")
      .flatMap((m) =>
        ONBOARDING.map((title, i) => ({
          memberId: m.id,
          title,
          sortOrder: i,
          // Ella is the fresh hire — halfway through her checklist.
          done: m.name === "Ella Byrne" ? i < 2 : true,
        })),
      ),
  );

  // ── menu (brand-level) ─────────────────────────────────────────────────
  console.log("— menu");
  await db.insert(menuItems).values([
    {
      name: "Dragon Chicken",
      category: "Signatures",
      price: "9.50",
      isBestseller: true,
      sortOrder: 0,
      description:
        "The one they queue for — crispy chicken tossed in the house dragon glaze, finished with spring onion and sesame.",
    },
    {
      name: "Mongolian Beef",
      category: "Signatures",
      price: "10.50",
      isBestseller: true,
      sortOrder: 1,
      description:
        "Slow-seared beef strips, sticky Mongolian sauce, charred onions. Plate it glossy.",
    },
    {
      name: "Chilli King Prawn",
      category: "Signatures",
      price: "11.00",
      isBestseller: true,
      sortOrder: 2,
      description:
        "King prawns flash-fried with dried chilli and garlic. Heat forward, finish clean.",
    },
    {
      name: "Salt & Pepper Chicken",
      category: "Salt & Pepper",
      price: "8.50",
      isBestseller: true,
      sortOrder: 0,
      description: "House S&P mix, wok-tossed with green chilli and crispy shallots.",
    },
    {
      name: "Salt & Pepper Chips",
      category: "Salt & Pepper",
      price: "5.00",
      isBestseller: true,
      sortOrder: 1,
      description:
        "The fan favourite. Twice-fried chips, S&P seasoning, peppers and onion — never under-season.",
    },
    {
      name: "Spice Bag",
      category: "Salt & Pepper",
      price: "9.00",
      isBestseller: true,
      sortOrder: 2,
      description:
        "Chips, crispy chicken, peppers and the full spice hit — bagged, shaken, served hot.",
    },
    {
      name: "Chilli Jam Wings",
      category: "Wings & Small Plates",
      price: "7.00",
      isBestseller: true,
      sortOrder: 0,
      description: "Crispy wings lacquered in the house chilli jam. Sticky fingers guaranteed.",
    },
    {
      name: "Crispy Wontons",
      category: "Wings & Small Plates",
      price: "5.50",
      sortOrder: 1,
      description: "Hand-folded, fried to glass-crisp, sweet chilli on the side.",
    },
    {
      name: "Char Siu Bao",
      category: "Wings & Small Plates",
      price: "6.00",
      sortOrder: 2,
      description: "Pillow-soft bao, house char siu pork, pickled cucumber.",
    },
    {
      name: "Egg Fried Rice",
      category: "Sides",
      price: "4.00",
      sortOrder: 0,
      description: "Day-old rice only. High heat, fast hands.",
    },
    {
      name: "Chow Mein",
      category: "Sides",
      price: "5.50",
      sortOrder: 1,
      description: "Wok-tossed noodles, beansprouts, dark soy finish.",
    },
    {
      name: "Prawn Crackers",
      category: "Sides",
      price: "2.50",
      sortOrder: 2,
      description: "Fresh-fried, never bagged early.",
    },
  ]);

  // ── stock (per site, some flags) ───────────────────────────────────────
  console.log("— stock");
  const STOCK: Array<{ name: string; unit: string; level: number; low: number; supplier: string }> =
    [
      { name: "Chicken breast", unit: "kg", level: 24, low: 10, supplier: "Merseyside Meats" },
      { name: "Beef strips", unit: "kg", level: 11, low: 6, supplier: "Merseyside Meats" },
      { name: "King prawns", unit: "kg", level: 4, low: 5, supplier: "Neptune Seafood" }, // low
      { name: "Chips (frozen)", unit: "kg", level: 30, low: 15, supplier: "North West Catering" },
      { name: "Chilli jam", unit: "jars", level: 3, low: 4, supplier: "ZEZU Central Kitchen" }, // low
      { name: "S&P seasoning", unit: "kg", level: 6, low: 2, supplier: "ZEZU Central Kitchen" },
      { name: "Cooking oil", unit: "L", level: 40, low: 20, supplier: "North West Catering" },
      { name: "Rice", unit: "kg", level: 45, low: 20, supplier: "Golden Lotus Wholesale" },
      { name: "Noodles", unit: "kg", level: 12, low: 6, supplier: "Golden Lotus Wholesale" },
      { name: "Takeaway boxes", unit: "pcs", level: 400, low: 150, supplier: "PackRight" },
    ];
  for (const loc of [lodgeLane, anfield, wallasey]) {
    // Small per-site variation so the three shops don't look cloned.
    const items = await db
      .insert(stockItems)
      .values(
        STOCK.map((s, i) => ({
          locationId: loc.id,
          name: s.name,
          unit: s.unit,
          level: String(Math.max(0, s.level + rand(-2, 3))),
          lowThreshold: String(s.low),
          supplier: s.supplier,
          sortOrder: i,
        })),
      )
      .returning();
    const manager = CREW.find((c) => c.role === "manager" && c.sites.includes(loc.id))!;
    await db.insert(stockMoves).values(
      items.flatMap((item) => [
        {
          stockItemId: item.id,
          date: day(-7),
          kind: "adjustment",
          quantity: String(Number(item.level) + 6),
          note: "Opening count",
          byMemberId: byName[manager.name].id,
        },
        {
          stockItemId: item.id,
          date: day(-1),
          kind: "usage",
          quantity: "6",
          note: "Close-down log",
          byMemberId: byName[manager.name].id,
        },
      ]),
    );
  }

  // ── 14 days of history: shop days, verified shifts, sales ──────────────
  console.log("— history (14 days)");
  const SITES = [
    { loc: lodgeLane, manager: "Wei Chen", staff: ["Aisha Khan", "Li Na"], base: 1.15 },
    { loc: anfield, manager: "Sara Hughes", staff: ["Tom Price", "Maya Osei"], base: 1.0 },
    { loc: wallasey, manager: "Jamal Carter", staff: ["Ken Wong", "Ella Byrne"], base: 0.85 },
  ];

  for (const site of SITES) {
    for (let offset = -14; offset <= -1; offset++) {
      const date = day(offset);
      const weekend = [5, 6, 0].includes(new Date(`${date}T12:00:00`).getDay());
      const mult = site.base * (weekend ? 1.5 : 1);

      const [sd] = await db
        .insert(shopDays)
        .values({
          locationId: site.loc.id,
          date,
          openedBy: byName[site.manager].id,
          openedAt: at(date, 10, 45),
          closedAt: at(date, 22, 45),
        })
        .returning();
      void sd;

      // Manager + staff worked the day; all verified at close.
      const workers = [site.manager, ...site.staff.slice(0, weekend ? 2 : 1)];
      await db.insert(shifts).values(
        workers.map((name, i) => ({
          memberId: byName[name].id,
          locationId: site.loc.id,
          clockInAt: at(date, i === 0 ? 10 : 16, i === 0 ? 45 : 55 + i),
          clockOutAt: at(date, 22, i === 0 ? 50 : 30),
          status: "verified",
          verifiedBy: byName[site.manager].id,
          verifiedAt: at(date, 22, 55),
        })),
      );

      // Wallasey "forgot" to log yesterday — demos the warning flag.
      if (site.loc.id === wallasey.id && offset === -1) continue;
      await db.insert(salesEntries).values({
        locationId: site.loc.id,
        date,
        uber: String((rand(320, 620) * mult) | 0),
        takeaway: String((rand(220, 420) * mult) | 0),
        dineIn: String((rand(60, 180) * mult) | 0),
        byMemberId: byName[site.manager].id,
      });
    }
  }

  // ── right now: Lodge Lane & Anfield are open, crew on the clock ────────
  console.log("— live state (today)");
  const today = day(0);
  await db.insert(shopDays).values([
    {
      locationId: lodgeLane.id,
      date: today,
      openedBy: byName["Wei Chen"].id,
      openedAt: at(today, 10, 45),
    },
    {
      locationId: anfield.id,
      date: today,
      openedBy: byName["Sara Hughes"].id,
      openedAt: at(today, 11, 5),
    },
  ]);
  await db.insert(shifts).values([
    // On the clock right now.
    {
      memberId: byName["Wei Chen"].id,
      locationId: lodgeLane.id,
      clockInAt: at(today, 10, 45),
      status: "pending",
    },
    {
      memberId: byName["Aisha Khan"].id,
      locationId: lodgeLane.id,
      clockInAt: at(today, 12, 58),
      status: "pending",
    },
    {
      memberId: byName["Sara Hughes"].id,
      locationId: anfield.id,
      clockInAt: at(today, 11, 5),
      status: "pending",
    },
    // Finished but unverified — feeds the verification queue demo.
    {
      memberId: byName["Li Na"].id,
      locationId: lodgeLane.id,
      clockInAt: at(day(-1), 16, 57),
      clockOutAt: at(day(-1), 22, 32),
      status: "pending",
    },
    {
      memberId: byName["Maya Osei"].id,
      locationId: anfield.id,
      clockInAt: at(day(-1), 17, 2),
      clockOutAt: at(day(-1), 22, 28),
      status: "pending",
    },
  ]);

  console.log("\nSeeded. Access codes (hand these out):\n");
  console.log("  ROLE      NAME            CODE   SITE");
  for (const c of CREW) {
    const site =
      c.sites.length === 0
        ? "all sites"
        : [lodgeLane, anfield, wallasey]
            .filter((l) => c.sites.includes(l.id))
            .map((l) => l.name)
            .join(", ");
    console.log(`  ${c.role.padEnd(9)} ${c.name.padEnd(15)} ${c.code}   ${site}`);
  }
  console.log("\nQR clock-in URLs:");
  for (const l of [lodgeLane, anfield, wallasey]) {
    console.log(`  ${l.name.padEnd(11)} /clock/${l.qrToken}`);
  }

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
