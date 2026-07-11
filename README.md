# ZEZU Management

Operations dashboard for **ZEZU — The Modern Chinese** (Liverpool: Lodge Lane, Anfield, Wallasey).

Client proposal (non-technical PRD): [`docs/PRD.pdf`](docs/PRD.pdf) — source at `docs/PRD.html`.
Brand/design tokens extracted from zezu.co.uk: [`docs/brand.md`](docs/brand.md).

## Modules (per client requirements)

1. **People** — staff profiles, onboarding checklists, documents, pay rates; salaries computed from verified clock-in hours.
2. **Stock** — daily usage logging, running levels, low-stock flags, per-supplier order lists.
3. **Menu** — every menu item with its own video (training consistency + brand content library).
4. **Daily Sales** — per-site daily entry split by Uber / takeaway / dine-in, with cross-site comparison.
5. **Live view** — miniature of each shop: who's clocked in right now, today's takings, stock flags.
6. **Clock-in** — QR poster per site, staff scan on own phone, shift-manager one-tap verification; verified hours feed salary calculation.

## Access model (client-confirmed)

- **No username/password logins.** Everyone gets one unique **4-digit code**.
- **CEO** — complete access, every location.
- **Manager** — access to their specific location(s) only; the manager **opens the shop** (their code starts the day) and verifies staff clock-ins.
- **Staff** — QR scan + code only: clock in/out, own shifts/hours, training + menu videos.
- Full change log with names; access revoked in one tap.

## Franchise-first

ZEZU operates on a franchise basis — the system must be replicable per location: a new site gets its own live-view card, its own QR posters, location-scoped manager codes, and inherits menu/videos/training/stock lists from a shared brand library. Franchisees see only their own numbers; the CEO sees all sites side by side.

## Status

PRD delivered for client review. App scaffold not yet generated — build starts after the proposal is agreed (see PRD phases P1–P5).
