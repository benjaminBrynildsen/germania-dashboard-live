/**
 * Crew Shop sync — mirrors the merch lineup from the vendor's
 * OrderMyGear storefront (germaniavirtualstore.itemorder.com) into
 * SQLite so the public Squarespace "Crew Shop" page can render it
 * without anyone hand-editing a product list.
 *
 * The vendor has no feed for us (the OMG account is theirs), so we
 * parse their public storefront HTML. Parsing is layered — JSON-LD,
 * embedded JSON state, then anchor-scanning — and a round that yields
 * zero products NEVER wipes existing data: we keep serving the last
 * good lineup and record the failure for the status endpoint.
 *
 * Items that disappear from the storefront are marked inactive (they
 * drop off the public page automatically); new items appear on the
 * next sync and carry a "New" badge for their first 14 days.
 */
import db from './db.js';

export const STORE_URL =
  process.env.CREW_SHOP_STORE_URL || 'https://germaniavirtualstore.itemorder.com/shop/sale/';

// OMG storefronts 403 non-browser agents, so identify as a browser.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

db.exec(`
  CREATE TABLE IF NOT EXISTS crew_shop_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,          -- product page on the vendor store (identity key)
    name TEXT NOT NULL,
    price TEXT,                        -- display string, e.g. "$42" or "$38.50"
    img TEXT,                          -- image URL scraped from the store
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1, -- still present on the storefront
    hidden INTEGER NOT NULL DEFAULT 0, -- manual "don't show this one" switch
    badge_override TEXT,               -- manual pill text; NULL = automatic ("New" for 14 days)
    img_override TEXT,                 -- manual photo (e.g. our own product shot)
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT
  );
  CREATE TABLE IF NOT EXISTS crew_shop_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const getMeta = (key: string): string | null =>
  (db.prepare('SELECT value FROM crew_shop_meta WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value ?? null;
const setMeta = (key: string, value: string) =>
  db.prepare('INSERT INTO crew_shop_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);

export interface ScrapedProduct {
  url: string;
  name: string;
  price: string | null;
  img: string | null;
  description: string | null;
}

const absolutize = (href: string, base: string): string => {
  try { return new URL(href, base).toString(); } catch { return href; }
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

const formatPrice = (value: unknown): string | null => {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
};

/** Strategy 1: schema.org Product entries in JSON-LD script tags. */
function parseJsonLd(html: string, base: string): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes: any[] = [];
    const collect = (d: any) => {
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d)) { d.forEach(collect); return; }
      if (d['@type'] === 'Product') nodes.push(d);
      if (d['@graph']) collect(d['@graph']);
      if (d.itemListElement) collect(d.itemListElement);
      if (d.item) collect(d.item);
    };
    collect(data);
    for (const p of nodes) {
      const url = p.url || p.offers?.url;
      const name = p.name;
      if (!url || !name) continue;
      out.push({
        url: absolutize(String(url), base),
        name: decodeEntities(String(name)),
        price: formatPrice(p.offers?.price ?? p.offers?.lowPrice ?? (Array.isArray(p.offers) ? p.offers[0]?.price : null)),
        img: p.image ? absolutize(String(Array.isArray(p.image) ? p.image[0] : p.image), base) : null,
        description: p.description ? decodeEntities(String(p.description)).slice(0, 200) : null,
      });
    }
  }
  return out;
}

/** Strategy 2: product arrays embedded in script JSON state. */
function parseEmbeddedJson(html: string, base: string): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  // Objects that look like {..."name":"X"...} and carry a price-ish and
  // a url/slug/image-ish field. Scans script bodies only.
  const scriptRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html))) {
    const body = sm[1];
    if (!/price/i.test(body) || !/name/i.test(body)) continue;
    const objRe = /\{[^{}]*"name"\s*:\s*"([^"]{2,120})"[^{}]*\}/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(body))) {
      const chunk = om[0];
      const name = decodeEntities(om[1]);
      const price = formatPrice(/"(?:price|unit_price|min_price|base_price)"\s*:\s*"?([0-9.]+)"?/i.exec(chunk)?.[1]);
      const url = /"(?:url|link|permalink|product_url|slug)"\s*:\s*"([^"]+)"/i.exec(chunk)?.[1];
      const img = /"(?:image|image_url|img|thumbnail|photo)"\s*:\s*"([^"]+)"/i.exec(chunk)?.[1];
      if (!price && !img) continue; // too little signal to be a product
      out.push({
        url: url ? absolutize(url.replace(/\\\//g, '/'), base) : `${base}#${encodeURIComponent(name)}`,
        name,
        price,
        img: img ? absolutize(img.replace(/\\\//g, '/'), base) : null,
        description: null,
      });
    }
  }
  return out;
}

/** Strategy 3: scan anchors to product pages and read the surrounding tile markup. */
function parseAnchors(html: string, base: string): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  const re = /<a\b[^>]*href="([^"]*(?:\/shop\/(?:product|item)|[?&]product(?:_id)?=)[^"]*)"[^>]*>/gi;
  const seenAt: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    seenAt.push(m.index);
    const href = absolutize(decodeEntities(m[1]), base);
    // The tile's markup: from this anchor to ~2500 chars ahead (name,
    // image and price live inside or right after the anchor).
    const window = html.slice(m.index, m.index + 2500);
    const img = /<img[^>]*src="([^"]+)"/i.exec(window)?.[1] ?? null;
    const name =
      /<img[^>]*alt="([^"]{2,120})"/i.exec(window)?.[1] ??
      /title="([^"]{2,120})"/i.exec(window)?.[1] ??
      /<(?:h\d|span|div|p)[^>]*>([^<>{}]{2,120}?)<\//i.exec(window.replace(/\s+/g, ' '))?.[1] ??
      null;
    const price = /\$\s*([0-9]+(?:\.[0-9]{2})?)/.exec(window)?.[1] ?? null;
    if (!name) continue;
    out.push({
      url: href,
      name: decodeEntities(name),
      price: formatPrice(price),
      img: img ? absolutize(decodeEntities(img), base) : null,
      description: null,
    });
  }
  return out;
}

const dedupe = (products: ScrapedProduct[]): ScrapedProduct[] => {
  const byUrl = new Map<string, ScrapedProduct>();
  for (const p of products) {
    const existing = byUrl.get(p.url);
    // Prefer the entry with more fields filled in.
    if (!existing || (p.price && !existing.price) || (p.img && !existing.img)) byUrl.set(p.url, p);
  }
  return [...byUrl.values()];
};

export function parseStorefront(html: string, base: string): { products: ScrapedProduct[]; method: string } {
  for (const [method, fn] of [
    ['json-ld', parseJsonLd],
    ['embedded-json', parseEmbeddedJson],
    ['anchors', parseAnchors],
  ] as const) {
    const products = dedupe(fn(html, base));
    if (products.length > 0) return { products, method };
  }
  return { products: [], method: 'none' };
}

export interface SyncResult {
  ok: boolean;
  status: string;
  method?: string;
  found: number;
  added: number;
  removed: number;
}

export async function syncCrewShop(): Promise<SyncResult> {
  setMeta('last_attempt', new Date().toISOString());
  let html: string;
  try {
    const res = await fetch(STORE_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`storefront answered ${res.status}`);
    html = await res.text();
  } catch (err) {
    const status = `fetch_failed: ${err instanceof Error ? err.message : String(err)}`;
    setMeta('last_status', status);
    return { ok: false, status, found: 0, added: 0, removed: 0 };
  }

  const { products, method } = parseStorefront(html, STORE_URL);
  if (products.length === 0) {
    // Never clear the lineup on a bad parse — the storefront may have
    // changed markup or served an interstitial. Keep last good data.
    setMeta('last_status', 'parse_failed: 0 products found (kept existing lineup)');
    return { ok: false, status: 'parse_failed', found: 0, added: 0, removed: 0 };
  }

  const now = new Date().toISOString();
  if (!getMeta('first_sync_at')) setMeta('first_sync_at', now);

  const upsert = db.prepare(`
    INSERT INTO crew_shop_products (url, name, price, img, description, active, last_seen)
    VALUES (@url, @name, @price, @img, @description, 1, @now)
    ON CONFLICT(url) DO UPDATE SET
      name = excluded.name,
      price = COALESCE(excluded.price, crew_shop_products.price),
      img = COALESCE(excluded.img, crew_shop_products.img),
      description = COALESCE(excluded.description, crew_shop_products.description),
      active = 1,
      last_seen = excluded.last_seen
  `);
  let added = 0;
  const tx = db.transaction(() => {
    for (const p of products) {
      const existed = db.prepare('SELECT 1 FROM crew_shop_products WHERE url = ?').get(p.url);
      if (!existed) added++;
      upsert.run({ ...p, now });
    }
    // Anything the storefront no longer lists drops off the public page.
    return db.prepare(
      `UPDATE crew_shop_products SET active = 0 WHERE active = 1 AND (last_seen IS NULL OR last_seen < ?)`
    ).run(now).changes;
  });
  const removed = tx();

  const status = `ok: ${products.length} products via ${method}`;
  setMeta('last_status', status);
  setMeta('last_success', now);
  console.log(`[CrewShopSync] ${status} (+${added} new, -${removed} retired)`);
  return { ok: true, status, method, found: products.length, added, removed };
}

export interface PublicProduct {
  name: string;
  desc: string | null;
  price: string | null;
  url: string;
  img: string | null;
  badge: string | null;
}

/** The lineup as the public Squarespace page should render it. */
export function getPublicProducts(): { updatedAt: string | null; products: PublicProduct[] } {
  const firstSync = getMeta('first_sync_at');
  const rows = db.prepare(`
    SELECT name, description, price, url, img, img_override, badge_override, first_seen
    FROM crew_shop_products
    WHERE active = 1 AND hidden = 0
    ORDER BY first_seen DESC, name ASC
  `).all() as Array<{
    name: string; description: string | null; price: string | null; url: string;
    img: string | null; img_override: string | null; badge_override: string | null; first_seen: string;
  }>;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  return {
    updatedAt: getMeta('last_success'),
    products: rows.map((r) => ({
      name: r.name,
      desc: r.description,
      price: r.price,
      url: r.url,
      img: r.img_override || r.img,
      // Auto-badge items that showed up recently — but not the initial
      // import, or the whole store says "New" on day one.
      badge:
        r.badge_override ||
        (r.first_seen > fourteenDaysAgo && firstSync !== null && r.first_seen > firstSync ? 'New' : null),
    })),
  };
}

export function getSyncStatus() {
  return {
    storeUrl: STORE_URL,
    lastAttempt: getMeta('last_attempt'),
    lastSuccess: getMeta('last_success'),
    lastStatus: getMeta('last_status'),
    products: db.prepare(
      'SELECT id, url, name, price, img, img_override, badge_override, active, hidden, first_seen, last_seen FROM crew_shop_products ORDER BY active DESC, first_seen DESC'
    ).all(),
  };
}
