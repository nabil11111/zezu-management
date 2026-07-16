import { z } from "zod";

/**
 * Shared, plain-TypeScript types + zod schemas for the server-function layer.
 *
 * This module is intentionally free of any server-only imports (no db, no
 * auth.server, no node builtins) so it can be imported by both server
 * functions AND client components. Keep it that way.
 */

// ── role / status unions (mirror the comments in src/db/schema.ts) ──────────

export const MEMBER_ROLES = ["ceo", "manager", "staff", "warehouse"] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const ORDER_STATUSES = ["placed", "sent", "received", "cancelled"] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// ── per-member capabilities (configured when adding an employee) ────────────
// The shop-floor actions a member's code can unlock. Role sets the lane; the
// CEO ticks the exact capabilities on each person. CEO implicitly has all.
export const MEMBER_CAPABILITIES = [
  "open_shop",
  "log_usage",
  "manage_stock",
  "place_orders",
  "verify_shifts",
  "set_rota",
] as const;
export const capabilitySchema = z.enum(MEMBER_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/** Human labels for the add-member permission toggles. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  open_shop: "Open & close the shop",
  log_usage: "Log stock usage & deliveries",
  manage_stock: "Add & edit stock items",
  place_orders: "Place & receive warehouse orders",
  verify_shifts: "Verify clock-ins",
  set_rota: "Set the rota",
};

/** One-line hint under each toggle. */
export const CAPABILITY_HINT: Record<Capability, string> = {
  open_shop: "Their code can start and close the shop day at the door.",
  log_usage: "They can log tonight's usage and deliveries against stock.",
  manage_stock: "They can add stock items and edit thresholds and suppliers.",
  place_orders: "They can order from the warehouse and verify what arrives.",
  verify_shifts: "They can approve other people's clock-ins.",
  set_rota: "They can build and edit the weekly rota.",
};

/** What a manager gets ticked by default (staff start with none). */
export const MANAGER_DEFAULT_CAPABILITIES: Capability[] = [...MEMBER_CAPABILITIES];

/** True if this member (by role + saved permissions) has a capability. */
export function memberHasCapability(role: string, permissions: unknown, cap: Capability): boolean {
  if (role === "ceo") return true;
  return Array.isArray(permissions) && permissions.includes(cap);
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  sent: "On the van",
  received: "Received",
  cancelled: "Cancelled",
};

export const SHIFT_STATUSES = ["pending", "verified", "rejected"] as const;
export const shiftStatusSchema = z.enum(SHIFT_STATUSES);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

export const STOCK_MOVE_KINDS = ["usage", "delivery", "adjustment"] as const;
export const stockMoveKindSchema = z.enum(STOCK_MOVE_KINDS);
export type StockMoveKind = z.infer<typeof stockMoveKindSchema>;

export const SALES_CHANNELS = ["uber", "takeaway", "dineIn"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const SALES_CHANNEL_LABEL: Record<SalesChannel, string> = {
  uber: "Uber",
  takeaway: "Takeaway",
  dineIn: "Dine-in",
};

/** The one code everyone carries: exactly four digits. */
export const accessCodeSchema = z.string().regex(/^\d{4}$/, "Codes are exactly 4 digits");

/** Any JSON-serializable value (used for loosely-typed jsonb payloads). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ── small pure helpers (safe to share with the client) ──────────────────────

/** Normalises an ISO string (date or datetime) to a `YYYY-MM-DD` date string. */
export function toDateString(value?: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

/**
 * "Today" for the business, as a `YYYY-MM-DD` string. All three shops are in
 * Merseyside, so the shop day rolls over on UK time no matter where the
 * server (or the CEO's phone) happens to be.
 */
export function todayDateString(offsetDays = 0): string {
  const now = new Date();
  if (offsetDays !== 0) now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** Hours between two timestamps, rounded to 2dp. Null while still clocked in. */
export function shiftHours(
  clockInAt: string | Date,
  clockOutAt: string | Date | null,
): number | null {
  if (!clockOutAt) return null;
  const ms = new Date(clockOutAt).getTime() - new Date(clockInAt).getTime();
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Formats a number as GBP, no pence for whole amounts. */
export function formatGBP(value: number | string): string {
  const n = Number(value);
  return n.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
