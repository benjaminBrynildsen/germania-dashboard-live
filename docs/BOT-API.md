# Germania Brew Haus Dashboard — Bot API

Instructions for an AI assistant (Grok, Claude, GPT, or any HTTP client)
working with the Germania Brew Haus dashboard on Ben's behalf.

## Connection

- **Base URL:** `https://dashboard.germaniabrewhaus.com`
- **Auth:** every request sends the API key as a Bearer token:

```
Authorization: Bearer gbh_XXXXXXXXXXXXXXXX
```

Keys are created on the dashboard under **COGS → Settings → Bot / API
access**. A `read` key can only GET; a `write` key can also create and
update. All responses are JSON unless noted.

Example:

```bash
curl -s https://dashboard.germaniabrewhaus.com/api/cog/ingredients/master \
  -H "Authorization: Bearer $GBH_API_KEY"
```

## Ground rules for bots

1. **Writes are visible and attributed.** Your key's name is stamped on
   everything you change (e.g. confirmations show `api-key:grokbot`).
   Don't confirm data you haven't verified.
2. **Auto-filled data carries `needs_confirm` flags.** Leave human
   sign-off (confirm endpoints) to humans unless Ben explicitly tells
   you to confirm something.
3. **Off-limits:** login/session endpoints, API-key management, and
   applicant/HR data reject API keys entirely. Week-locked Bake Haus
   quantities also reject bot edits (the unlock allowlist is email-based
   and keys are not on it).
4. **Be gentle:** this is a small café server. Avoid polling loops
   tighter than a minute, and prefer one bulk read over many small ones.
5. Prices are USD. Weeks are identified by their Monday in `YYYY-MM-DD`.
   Stores are `G1` (Godfrey), `G2`, `G3`, `G4`.

## COGS — ingredients, batch recipes, drinks

| Method & path | What it does |
|---|---|
| `GET /api/cog/ingredients/master` | Master ingredient catalog (pack cost/size/unit, supplier, confirmed-by stamps). |
| `PUT /api/cog/ingredients/master/:id` | Update an ingredient `{ap_pack_cost, pack_size, pack_unit, supplier}`. **Auto-propagates** the new price into every linked batch-recipe line and clears the human confirmation. |
| `POST /api/cog/ingredients/master` | Add an ingredient `{name, ap_pack_cost, pack_size, pack_unit, supplier}`. Auto-links matching recipe lines. |
| `GET /api/cog/recipes` | Batch recipes (syrups, sauces, food) with per-unit COG. |
| `GET /api/cog/recipes/:id` | One recipe incl. ingredient lines + `cog_per_unit`. |
| `POST /api/cog/recipes` | Create a recipe `{name, category, season, total_yield, yield_unit, labor_*}`. |
| `POST /api/cog/recipes/:id/ingredients` | Add a line (see existing lines for the field shape). |
| `PUT /api/cog/ingredients/:id` | Update a recipe line. Hand-editing pricing unlinks it from the catalog on purpose. |
| `POST /api/cog/recipes/:id/sync-master-prices` | Re-apply catalog prices to a recipe; returns what linked/updated/skipped. |
| `GET /api/cog/drinks` | Drink catalog with COG ranges, Dripos links, `needs_confirm` flags. |
| `GET /api/cog/drinks/:id` | One drink: variants (temp/size), components, per-variant COG, recommended price. |
| `POST /api/cog/drinks/:id/fill-flavor-sizes` | Copy a syrup/sauce found on one size to all sizes at house pump amounts. |
| `GET /api/cog/drinks/active-sales` | 30-day Dripos sales per drink ("selling now"). |
| `GET /api/cog/price-watch` | Price Watch: watched staples with the latest Schnucks/Walmart/Costco quotes and the cheapest store flag. |
| `POST /api/cog/price-watch/items/:id/check` | Re-run the AI price check for one item (slow; needs the server's Anthropic key). |
| `POST /api/cog/price-watch/items/:id/manual` | Record a seen shelf price `{store, price}`. |

## Bake Haus (bakery ordering & reporting)

| Method & path | What it does |
|---|---|
| `GET /api/bake-haus/week?week=YYYY-MM-DD` | The week: per-store order rows (qty, net, Mon/Wed/Fri split, locks, entered on-hand counts), inventory, prev-week numbers. |
| `GET /api/bake-haus/suggestions?week=YYYY-MM-DD` | Suggested quantities (sales-based food, order-history syrups) with the math explained. |
| `PUT /api/bake-haus/item` | Set an order quantity `{week, store, item, weeklyQty, onHand?}`. Rejected for locked days. For syrups with a build-to par, pass `onHand` (bottle count) and set `weeklyQty = buildTo - onHand`. |
| `GET /api/bake-haus/monthly?month=YYYY-MM` | Carolyn's bookkeeping report: per-item/store quantities + Dripos value + COGS cost, subtotals. |
| `GET /api/bake-haus/labor?weeks=N` | Weekly labor + delivery cost per unit shipped. |
| `GET /api/bake-haus/syrups` | The editable catalog (syrups/sauces/food) incl. `buildTo` pars. |
| `PUT /api/bake-haus/syrups/:id` | Update a catalog item (`buildTo`, `includeMonday`, `active`, ...). |

## Menus & SOPs

| Method & path | What it does |
|---|---|
| `GET /api/menu-seasons` | Menu seasons list. |
| `GET /api/menu-seasons/:id` | Full season: categories, drinks, prices, temps. |
| `GET /api/menu-seasons/:id/pdf?location=G1` | The printable board PDF (`format=png&page=1` for a proof image). |
| `GET /api/menu-seasons/:id/patch?item=ID&location=G1` | Midseason one-drink overlay slip PDF. |
| `GET /api/sops` | Standard operating procedures (drink build recipes per size). |

## Store & sales data

| Method & path | What it does |
|---|---|
| `GET /api/locations` | Stores with weekly sales metrics. |
| `GET /api/auth/me` | Who the server thinks you are (sanity check for your key). *Note: this specific path is allowed read-only for key sanity checks via the cookie path only — if it 403s for your key, use any other GET as your connectivity check.* |

## Workflow examples

**"What does a Haus Vanilla Latte cost us right now?"**
1. `GET /api/cog/drinks` → find the drink id by name.
2. `GET /api/cog/drinks/:id` → per-size COG, recommended price, margin vs Dripos price.

**"Sysco raised butter to $142.50 for the 36 lb case."**
1. `GET /api/cog/ingredients/master` → find Butter's id and current values.
2. `PUT /api/cog/ingredients/master/:id` with the full body (existing values + new `ap_pack_cost: 142.5`).
3. The response's `synced_recipe_lines` tells you how many recipes repriced automatically. Report that number to Ben.

**"Place G2's syrup order: they have 7 Haus Vanilla on hand."**
1. `GET /api/bake-haus/syrups` → Haus Vanilla's `buildTo` (e.g. 20).
2. `PUT /api/bake-haus/item` `{week: <this Monday>, store: "G2", item: "Haus Vanilla", weeklyQty: 13, onHand: 7}`.

**"Which store should we buy milk from this week?"**
1. `GET /api/cog/price-watch` → each item's latest quotes; `cheapest_store` is precomputed. Mention the quote age — stale quotes (>7 days) deserve a re-check.

## Error handling

- `401` — missing/invalid/revoked key. Stop and tell Ben.
- `403` — the key lacks scope (read-only key making a write), the area is
  bot-restricted, or a Bake Haus day is locked. Don't retry; report it.
- `400` — your payload failed validation; the `message` field says why.
- `5xx` — transient; retry once after ~30s, then report.
