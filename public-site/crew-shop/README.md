# Crew Shop page for germaniabrewhaus.com

A branded merch page for the public Squarespace site, in the Brew Haus
look (menu-board typography: Oswald caps, Open Sans labels, black/white,
red pills). Each **Buy** button deep-links to the item on the vendor
store (`germaniavirtualstore.itemorder.com`, OrderMyGear); the vendor
still handles cart, payment, and fulfillment.

## How it's wired

```
Squarespace Code Block (6-line stub, pasted once)
  └─ loads /api/public/crew-shop/embed.js   ← embed.js, served by the dashboard
       └─ fetches /api/public/crew-shop/products   ← mirrored from the vendor store
            └─ synced from the OMG storefront every 6h (server/crew-shop.ts)
```

Squarespace only ever holds the stub (`crew-shop-code-block.html`).
Everything else lives in this repo and ships by deploying the dashboard:
**design changes, new products, price changes — all automatic, no
Squarespace edits ever again.**

## One-time Squarespace setup

1. **Pages → + → Blank Page**, name it **Crew Shop**, place it in the nav.
2. Edit the page, add a **Code** block (type: HTML).
3. Paste the contents of `crew-shop-code-block.html`. Save.

Notes:
- Script-bearing Code Blocks need a Squarespace **Business** plan or higher.
- In the Squarespace **editor preview**, script blocks render inside a
  fixed-height scrollable sandbox — that's an editor artifact. The
  published page runs the script inline at natural height.
- To hide the block's big "Crew Shop" heading (when the page already has
  its own title/banner), change the stub's script tag to
  `data-header="false"`.

## Product sync

`server/crew-shop.ts` mirrors the vendor storefront on boot and every
6 hours. The storefront is a Next.js app, so the primary parse strategy
reads the `__NEXT_DATA__` JSON state (products, cent-prices, categories,
availability, images); generic fallbacks (JSON-LD, embedded JSON, anchor
scan) cover a future storefront redesign. A failed fetch or parse keeps
the last good lineup — the page never goes blank because the vendor had
a bad day. New items carry a red **New** pill for their first 14 days;
items removed from the storefront drop off automatically.

Admin endpoints (dashboard login required):

- `POST /api/crew-shop/sync` — run a sync right now.
- `GET /api/crew-shop/status` — last sync result + every product row.
- `PUT /api/crew-shop/products/:id` — per-item tweaks:
  `{"hidden": true}` keeps an item off the page,
  `{"badge_override": "Best Seller"}` pins a pill,
  `{"img_override": "https://..."}` swaps in our own photo.

Public endpoints (no auth, CORS-open):

- `GET /api/public/crew-shop/products` — the current lineup as JSON.
- `GET /api/public/crew-shop/embed.js` — the page renderer
  (`public-site/crew-shop/embed.js`), cached 10 minutes.

Tests: `scripts/test-crew-shop.ts` (all parse strategies + lineup
behavior). Run with
`DB_PATH=/tmp/crew-shop-test.db node --import tsx scripts/test-crew-shop.ts`.
