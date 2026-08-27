// Applies live Dripos menu prices to the COGS drink catalog during a sync.
// Drinks with no variants get one created per Dripos size option (or a single
// Regular at the base price); drinks that already have variants keep their
// structure and just get menu_price refreshed by temp+size match, falling back
// to the base price. Storing menu_price means prices keep showing even when
// the Dripos token later expires.
import db from './db.js';
import type { DriposPriceInfo } from './dripos.js';

const SIZE_LABELS: Record<string, string> = { K: "Kid's", S: 'Small', R: 'Regular', L: 'Large' };
const TEMP_ORDER: Record<string, number> = { hot: 0, iced: 1, frozen: 2 };
const SIZE_ORDER: Record<string, number> = { K: 0, S: 1, R: 2, L: 3 };

export interface PricePassCounters {
  priced: number;
  variantsCreated: number;
}

// Price one drink. Mutates counters so the caller can report totals.
export function applyDriposPricesToDrink(
  drinkId: number,
  info: Pick<DriposPriceInfo, 'base' | 'sizes'>,
  counters: PricePassCounters,
): void {
  const variantsFor = db.prepare('SELECT id, temp, size FROM cog_drink_variants WHERE drink_id = ?');
  const setVariantPrice = db.prepare('UPDATE cog_drink_variants SET menu_price = ? WHERE id = ?');
  const insVariant = db.prepare(
    'INSERT INTO cog_drink_variants (drink_id, label, temp, size, menu_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const existing = variantsFor.all(drinkId) as Array<{ id: number; temp: string | null; size: string | null }>;
  if (existing.length === 0) {
    const keys = Object.keys(info.sizes).sort((a, b) => {
      const [at, as] = a.split('|');
      const [bt, bs] = b.split('|');
      return (TEMP_ORDER[at] ?? 9) - (TEMP_ORDER[bt] ?? 9) || (SIZE_ORDER[as] ?? 9) - (SIZE_ORDER[bs] ?? 9);
    });
    if (keys.length > 0) {
      keys.forEach((key, i) => {
        const [temp, size] = key.split('|');
        const label = `${temp[0].toUpperCase()}${temp.slice(1)} ${SIZE_LABELS[size] ?? size}`;
        insVariant.run(drinkId, label, temp, size, info.sizes[key], i);
        counters.variantsCreated++;
        counters.priced++;
      });
    } else if (info.base > 0) {
      insVariant.run(drinkId, 'Regular', null, null, info.base, 0);
      counters.variantsCreated++;
      counters.priced++;
    }
  } else {
    for (const v of existing) {
      const key = v.temp && v.size ? `${v.temp}|${v.size}` : null;
      const price = key && info.sizes[key] != null ? info.sizes[key] : (info.base > 0 ? info.base : null);
      if (price != null) {
        setVariantPrice.run(price, v.id);
        counters.priced++;
      }
    }
  }
}
