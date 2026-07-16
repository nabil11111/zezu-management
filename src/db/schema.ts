import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * ZEZU operations schema. Franchise-first: locations are first-class, the
 * menu is brand-level (every location inherits it), and everything that
 * happens in a shop (shifts, stock, sales) hangs off a location.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── locations (franchise sites) ──────────────────────────────────────────
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  // Printed on the door poster; scanning /clock/$qrToken clocks into THIS shop.
  qrToken: text("qr_token").notNull().unique(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const locationsRelations = relations(locations, ({ many }) => ({
  memberLocations: many(memberLocations),
  shopDays: many(shopDays),
  shifts: many(shifts),
  stockItems: many(stockItems),
  salesEntries: many(salesEntries),
}));

// ── members (everyone: CEO, managers, staff, warehouse) ──────────────────
// No usernames/passwords — one unique 4-digit code each, stored hashed
// (HMAC-SHA256 keyed with SESSION_SECRET). Role sets the broad lane; the
// per-member `permissions` list then decides which shop-floor actions the
// code actually unlocks (open the shop, log usage, place orders, …):
//   ceo       → everything, every location (permissions ignored — always all)
//   manager   → their assigned locations; permissions default to the full set
//   staff     → clock in/out; only the permissions the CEO ticks on
//   warehouse → the warehouse catalog + dispatch; no branch shop-floor actions
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // 'ceo' | 'manager' | 'staff' | 'warehouse'
  role: text("role").notNull().default("staff"),
  codeHash: text("code_hash").notNull().unique(),
  hourlyRate: numeric("hourly_rate"),
  phone: text("phone"),
  startedAt: date("started_at"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  // Configurable shop-floor capabilities — a JSON array of capability keys
  // (see MEMBER_CAPABILITIES in server/types). CEO always has all of them.
  permissions: jsonb("permissions"),
  // First-login welcome video: set when the member has watched it through.
  welcomeSeenAt: timestamp("welcome_seen_at", { withTimezone: true }),
  ...timestamps,
});

export const membersRelations = relations(members, ({ many }) => ({
  memberLocations: many(memberLocations),
  onboardingSteps: many(onboardingSteps),
  shifts: many(shifts),
}));

// ── member_locations (which shops a manager/staff belongs to) ────────────
export const memberLocations = pgTable(
  "member_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("member_location_unique").on(t.memberId, t.locationId)],
);

export const memberLocationsRelations = relations(memberLocations, ({ one }) => ({
  member: one(members, { fields: [memberLocations.memberId], references: [members.id] }),
  location: one(locations, { fields: [memberLocations.locationId], references: [locations.id] }),
}));

// ── onboarding_steps (per new hire checklist) ────────────────────────────
export const onboardingSteps = pgTable("onboarding_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const onboardingStepsRelations = relations(onboardingSteps, ({ one }) => ({
  member: one(members, { fields: [onboardingSteps.memberId], references: [members.id] }),
}));

// ── shop_days (the manager opens the shop — that starts the day) ─────────
export const shopDays = pgTable(
  "shop_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    date: date("date").notNull(),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => members.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("shop_day_unique").on(t.locationId, t.date)],
);

export const shopDaysRelations = relations(shopDays, ({ one }) => ({
  location: one(locations, { fields: [shopDays.locationId], references: [locations.id] }),
  opener: one(members, { fields: [shopDays.openedBy], references: [members.id] }),
}));

// ── shifts (QR clock-in → manager verification → payroll source) ─────────
export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull().defaultNow(),
  clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  // 'pending' | 'verified' | 'rejected' — only verified hours count for pay
  status: text("status").notNull().default("pending"),
  verifiedBy: uuid("verified_by").references(() => members.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  note: text("note"),
  ...timestamps,
});

export const shiftsRelations = relations(shifts, ({ one }) => ({
  member: one(members, { fields: [shifts.memberId], references: [members.id] }),
  location: one(locations, { fields: [shifts.locationId], references: [locations.id] }),
  verifier: one(members, { fields: [shifts.verifiedBy], references: [members.id] }),
}));

// ── stock_items (per location) + stock_moves (the ledger) ────────────────
export const stockItems = pgTable("stock_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kg"),
  // Running level — always derived from moves on write, stored for fast reads.
  level: numeric("level").notNull().default("0"),
  lowThreshold: numeric("low_threshold"),
  supplier: text("supplier"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const stockItemsRelations = relations(stockItems, ({ one, many }) => ({
  location: one(locations, { fields: [stockItems.locationId], references: [locations.id] }),
  moves: many(stockMoves),
}));

export const stockMoves = pgTable("stock_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockItemId: uuid("stock_item_id")
    .notNull()
    .references(() => stockItems.id),
  date: date("date").notNull(),
  // 'usage' (out) | 'delivery' (in) | 'adjustment' (signed correction)
  kind: text("kind").notNull(),
  quantity: numeric("quantity").notNull(),
  note: text("note"),
  byMemberId: uuid("by_member_id").references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovesRelations = relations(stockMoves, ({ one }) => ({
  item: one(stockItems, { fields: [stockMoves.stockItemId], references: [stockItems.id] }),
  by: one(members, { fields: [stockMoves.byMemberId], references: [members.id] }),
}));

// ── warehouse_products (the central warehouse's own catalog) ─────────────
// The warehouse stocks itself: it adds the products it carries and marks
// each available or not. Branches can only order products that are
// currently available here.
export const warehouseProducts = pgTable("warehouse_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kg"),
  // Optional running quantity the warehouse holds (informational).
  quantity: numeric("quantity"),
  supplier: text("supplier"),
  // Off = out of stock: branches can't order it until it's back.
  available: boolean("available").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const warehouseProductsRelations = relations(warehouseProducts, ({ many }) => ({
  orderItems: many(stockOrderItems),
}));

// ── stock_orders (branch → warehouse → branch verification) ──────────────
// A branch employee places the day's order; the warehouse sees it, sends
// the items (adjusting quantities if short); the branch verifies what
// actually arrived. Verification writes 'delivery' stock_moves, so levels
// update from what was RECEIVED, not what was promised.
export const stockOrders = pgTable("stock_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  // 'placed' | 'sent' | 'received' | 'cancelled'
  status: text("status").notNull().default("placed"),
  note: text("note"),
  placedBy: uuid("placed_by")
    .notNull()
    .references(() => members.id),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  sentBy: uuid("sent_by").references(() => members.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentNote: text("sent_note"),
  receivedBy: uuid("received_by").references(() => members.id),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  // Delivery issue trail: when something arrives short or missing, the shop
  // records why here, then it's resolved (settled with the warehouse). An
  // order with a shortfall and no resolvedAt is an OPEN issue.
  issueReason: text("issue_reason"),
  issueResolvedAt: timestamp("issue_resolved_at", { withTimezone: true }),
  issueResolvedBy: uuid("issue_resolved_by").references(() => members.id),
  ...timestamps,
});

export const stockOrdersRelations = relations(stockOrders, ({ one, many }) => ({
  location: one(locations, { fields: [stockOrders.locationId], references: [locations.id] }),
  placer: one(members, { fields: [stockOrders.placedBy], references: [members.id] }),
  sender: one(members, { fields: [stockOrders.sentBy], references: [members.id] }),
  receiver: one(members, { fields: [stockOrders.receivedBy], references: [members.id] }),
  items: many(stockOrderItems),
}));

export const stockOrderItems = pgTable("stock_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => stockOrders.id),
  // The branch stock line this order tops up (levels update on receipt).
  stockItemId: uuid("stock_item_id")
    .notNull()
    .references(() => stockItems.id),
  // The warehouse catalog product it was ordered from (new-style orders).
  warehouseProductId: uuid("warehouse_product_id").references(() => warehouseProducts.id),
  quantityOrdered: numeric("quantity_ordered").notNull(),
  // What the warehouse actually dispatched (null until sent).
  quantitySent: numeric("quantity_sent"),
  // What the branch counted off the van (null until verified).
  quantityReceived: numeric("quantity_received"),
  // Checklist ticks: the warehouse ticks `loaded` while packing the van
  // (untucked = unavailable, sent as 0); the branch ticks `unloaded` while
  // counting the delivery off the van.
  loaded: boolean("loaded").notNull().default(false),
  unloaded: boolean("unloaded").notNull().default(false),
  note: text("note"),
});

export const stockOrderItemsRelations = relations(stockOrderItems, ({ one }) => ({
  order: one(stockOrders, { fields: [stockOrderItems.orderId], references: [stockOrders.id] }),
  item: one(stockItems, { fields: [stockOrderItems.stockItemId], references: [stockItems.id] }),
  product: one(warehouseProducts, {
    fields: [stockOrderItems.warehouseProductId],
    references: [warehouseProducts.id],
  }),
}));

// ── menu_items (BRAND-LEVEL: every location inherits the menu) ───────────
export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  price: numeric("price"),
  description: text("description"),
  // Pasted link for v1 (no file storage yet) — the dish video for training.
  videoUrl: text("video_url"),
  coverUrl: text("cover_url"),
  // Step-by-step prep instructions: a JSON array of strings, one per step.
  prepSteps: jsonb("prep_steps"),
  isBestseller: boolean("is_bestseller").notNull().default(false),
  published: boolean("published").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

// ── sales_entries (one row per location per day) ─────────────────────────
export const salesEntries = pgTable(
  "sales_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    date: date("date").notNull(),
    uber: numeric("uber").notNull().default("0"),
    takeaway: numeric("takeaway").notNull().default("0"),
    dineIn: numeric("dine_in").notNull().default("0"),
    note: text("note"),
    byMemberId: uuid("by_member_id").references(() => members.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("sales_entry_unique").on(t.locationId, t.date)],
);

export const salesEntriesRelations = relations(salesEntries, ({ one }) => ({
  location: one(locations, { fields: [salesEntries.locationId], references: [locations.id] }),
  by: one(members, { fields: [salesEntries.byMemberId], references: [members.id] }),
}));

// ── member_payments (weekly pay: recorded against verified hours) ────────
// Everyone is paid weekly. When the manager pays someone, they record the
// amount and how many verified hours it covers; the profile's "payable"
// balance is verified hours minus hours already paid, times the rate.
export const memberPayments = pgTable("member_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id),
  amount: numeric("amount").notNull(),
  // Verified hours this payment settles (deducted from the balance).
  hours: numeric("hours").notNull(),
  note: text("note"),
  paidBy: uuid("paid_by")
    .notNull()
    .references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberPaymentsRelations = relations(memberPayments, ({ one }) => ({
  member: one(members, { fields: [memberPayments.memberId], references: [members.id] }),
  payer: one(members, { fields: [memberPayments.paidBy], references: [members.id] }),
}));

// ── rota_shifts (the manager's timetable for the week ahead) ─────────────
export const rotaShifts = pgTable(
  "rota_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    date: date("date").notNull(),
    // "HH:MM" 24h strings — planned times, not the clock-in record.
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("rota_member_day_start").on(t.memberId, t.date, t.startTime)],
);

export const rotaShiftsRelations = relations(rotaShifts, ({ one }) => ({
  location: one(locations, { fields: [rotaShifts.locationId], references: [locations.id] }),
  member: one(members, { fields: [rotaShifts.memberId], references: [members.id] }),
  creator: one(members, { fields: [rotaShifts.createdBy], references: [members.id] }),
}));

// ── activity_log (who did what, when — shown in Settings) ────────────────
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  actorId: uuid("actor_id"),
  actorName: text("actor_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── settings ─────────────────────────────────────────────────────────────
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});
