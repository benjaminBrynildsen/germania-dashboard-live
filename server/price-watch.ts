/**
 * Price Watch agent — compares retail prices for watched staples (milks,
 * cream, eggs…) across the local stores the team actually shops
 * (Schnucks / Walmart / Costco by default) so whoever places the order
 * can buy from whoever is cheapest right now.
 *
 * Each check is one Claude call with the server-side web-search tool:
 * the model looks up current prices near the shop, and replies with
 * strict JSON (one entry per store) that lands in price_watch_quotes.
 * History is append-only; the UI reads the latest quote per store.
 * Quotes carry the agent's own confidence rating and the URL it relied
 * on — retail sites and delivery markups (Instacart) make this a
 * directional signal, not gospel, which is why manual entries are
 * first-class too.
 *
 * Needs ANTHROPIC_API_KEY on the server; without it the tab still works
 * on manual entries and says what's missing.
 */
import Anthropic from '@anthropic-ai/sdk';
import db from './db.js';

const MODEL = process.env.PRICE_WATCH_MODEL || 'claude-opus-5-5';
const CITY = process.env.PRICE_WATCH_CITY || 'Alton';
const REGION = process.env.PRICE_WATCH_REGION || 'Illinois';

export function watchedStores(): string[] {
  return (process.env.PRICE_WATCH_STORES || 'Schnucks,Walmart,Costco')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export function agentAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ParsedQuote {
  store: string;
  product: string | null;
  package_size: string | null;
  price: number | null;
  unit_price: number | null;
  unit: string | null;
  url: string | null;
  confidence: string | null;
  note: string | null;
}

/** Pull the JSON array out of the model's reply (tolerates prose or a
 *  code fence around it) and normalize field types. */
export function parsePriceJson(text: string): ParsedQuote[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('no JSON array in agent reply');
  const raw = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error('agent reply is not an array');
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[$,]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return raw
    .filter((q: any) => q && typeof q === 'object' && str(q.store))
    .map((q: any) => ({
      store: str(q.store)!,
      product: str(q.product),
      package_size: str(q.package_size),
      price: num(q.price),
      unit_price: num(q.unit_price),
      unit: str(q.unit),
      url: str(q.url),
      confidence: str(q.confidence),
      note: str(q.note),
    }));
}

/** Run one price check: ask Claude (with web search) for this item's
 *  current price at each watched store, store the quotes, return them. */
export async function checkItemPrices(itemId: number): Promise<ParsedQuote[]> {
  if (!agentAvailable()) {
    throw new Error('Automatic checks need ANTHROPIC_API_KEY set on the server. Prices can still be entered manually.');
  }
  const item = db.prepare('SELECT id, name, query FROM price_watch_items WHERE id = ?').get(itemId) as
    | { id: number; name: string; query: string }
    | undefined;
  if (!item) throw new Error('watched item not found');

  const stores = watchedStores();
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    tools: [{
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 8,
      user_location: { type: 'approximate', city: CITY, region: REGION, country: 'US', timezone: 'America/Chicago' },
    } as any],
    messages: [{
      role: 'user',
      content:
        `Find the current in-store retail price of "${item.query}" at each of these stores near ${CITY}, ${REGION}: ${stores.join(', ')}.\n\n` +
        `Rules:\n` +
        `- Prefer the store's own website/app pricing. Instacart and other delivery services mark prices up — only use them as a last resort and say so in the note.\n` +
        `- For Costco prefer the warehouse price (note if it's the online price, which often differs).\n` +
        `- Pick the closest match to the requested product/size at each store; say what you actually priced.\n` +
        `- unit_price: the price per ounce (fluid oz for liquids, count for eggs) as a plain number, when computable.\n\n` +
        `Reply with ONLY a JSON array, no other text, one entry per store:\n` +
        `[{"store": "Schnucks", "product": "...", "package_size": "1 gal", "price": 3.49, "unit_price": 0.027, "unit": "oz", "url": "...", "confidence": "high|medium|low", "note": "..."}]\n` +
        `If a store doesn't carry it or no reliable price is found, still include its entry with "price": null and a note explaining.`,
    }],
  });

  // Last text block carries the final answer (earlier blocks are tool use/results).
  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text = block.text;
  }
  if (response.stop_reason === 'refusal' || !text) {
    throw new Error('price agent returned no usable answer — try again or enter manually');
  }
  const quotes = parsePriceJson(text);

  const insert = db.prepare(`
    INSERT INTO price_watch_quotes (item_id, store, product, package_size, price, unit_price, unit, url, confidence, note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent')
  `);
  const txn = db.transaction(() => {
    for (const q of quotes) {
      // Keep store labels canonical so per-store history lines up.
      const store = stores.find((s) => s.toLowerCase() === q.store.toLowerCase()) ?? q.store;
      insert.run(itemId, store, q.product, q.package_size, q.price, q.unit_price, q.unit, q.url, q.confidence, q.note);
    }
  });
  txn();
  return quotes;
}

export interface ItemView {
  id: number;
  name: string;
  query: string;
  quotes: Record<string, any | null>;  // store -> latest quote
  cheapest_store: string | null;
}

/** Latest quote per store for every watched item + who's cheapest.
 *  Cheapest compares unit_price when at least two stores have one
 *  (fairer across package sizes), else the package price. */
export function getPriceWatch(): { agent_available: boolean; stores: string[]; items: ItemView[] } {
  const stores = watchedStores();
  const items = db.prepare('SELECT id, name, query FROM price_watch_items WHERE enabled = 1 ORDER BY name').all() as any[];
  const latest = db.prepare(`
    SELECT q.* FROM price_watch_quotes q
    WHERE q.item_id = ? AND LOWER(q.store) = LOWER(?)
    ORDER BY q.fetched_at DESC, q.id DESC LIMIT 1
  `);
  const views: ItemView[] = items.map((it) => {
    const quotes: Record<string, any | null> = {};
    for (const s of stores) quotes[s] = latest.get(it.id, s) ?? null;
    const priced = stores.filter((s) => quotes[s]?.price != null);
    const withUnit = priced.filter((s) => quotes[s]?.unit_price != null);
    let cheapest: string | null = null;
    const pool = withUnit.length >= 2 ? withUnit : priced;
    const key = withUnit.length >= 2 ? 'unit_price' : 'price';
    for (const s of pool) {
      if (cheapest == null || quotes[s][key] < quotes[cheapest][key]) cheapest = s;
    }
    return { id: it.id, name: it.name, query: it.query, quotes, cheapest_store: priced.length > 1 ? cheapest : null };
  });
  return { agent_available: agentAvailable(), stores, items: views };
}

/** Nightly sweep (called from the scheduler): refresh every enabled item.
 *  Sequential on purpose — keeps burst load and spend gentle. */
export async function runPriceWatchSweep(): Promise<{ checked: number; failed: number }> {
  if (!agentAvailable()) return { checked: 0, failed: 0 };
  const items = db.prepare('SELECT id, name FROM price_watch_items WHERE enabled = 1').all() as any[];
  let checked = 0;
  let failed = 0;
  for (const it of items) {
    try {
      await checkItemPrices(it.id);
      checked++;
    } catch (err) {
      failed++;
      console.warn(`[price-watch] check failed for "${it.name}":`, err instanceof Error ? err.message : err);
    }
  }
  return { checked, failed };
}
