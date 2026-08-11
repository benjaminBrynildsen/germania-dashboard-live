/**
 * Crew Shop scraper tests — exercises all three parse strategies on
 * synthetic storefront HTML, and the DB round-trip (upsert, retire,
 * auto-"New" badge, hidden/override handling).
 *
 * Run: DB_PATH=/tmp/crew-shop-test.db node --import tsx scripts/test-crew-shop.ts
 */
import assert from 'node:assert';
import { parseStorefront, getPublicProducts } from '../server/crew-shop.js';
import db from '../server/db.js';

const BASE = 'https://germaniavirtualstore.itemorder.com/shop/sale/';

// ── strategy 0: Next.js __NEXT_DATA__ (real OMG storefront shape) ───
// Trimmed from the actual germaniavirtualstore page source: products
// live in props.pageProps.categories keyed by category name, with
// integer-cent prices and assetly thumbnail URLs.
{
  const nextData = {
    props: {
      pageProps: {
        store: { name: 'Germania Brew Haus Virtual Store' },
        categories: {
          Apparel: [
            {
              id: '59529280', name: 'Unisex Germania Tee - 1717 - Arched Design',
              is_available: true, category: 'Apparel', color_count: 11,
              image: 'https://assetly.ordermygear.com/images/h_276,w_276,c_limit,s_1/43917854acbb',
              price: 2500, min_price: 2500, max_price: 2900, hide_price: false,
            },
            {
              id: '00000001', name: 'Retired Hoodie - 9999',
              is_available: false, category: 'Apparel', color_count: 2,
              image: 'https://assetly.ordermygear.com/images/h_276,w_276,c_limit,s_1/dead',
              price: 4200, min_price: 4200, max_price: 4200,
            },
          ],
          Hats: [
            {
              id: '59534251', name: 'Germania Logo, Dad Hat - LP101',
              is_available: true, category: 'Hats', color_count: 0,
              image: 'https://assetly.ordermygear.com/images/h_276,w_276,c_limit,s_1/ff499d',
              price: 2500, min_price: 2500, max_price: 2500,
            },
          ],
          'Accessories & Bags': [
            {
              id: '59534257', name: 'Craft Coffee Tote Bag - Logo It Stock',
              is_available: true, category: 'Accessories & Bags', color_count: 0,
              image: 'https://assetly.ordermygear.com/images/h_276,w_276,c_limit,s_1/d616f8',
              price: 1500, min_price: 1500, max_price: 1500,
            },
          ],
        },
      },
    },
  };
  const html = `<html><body><div id="__next">...</div>
  <script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">${JSON.stringify(nextData)}</script>
  </body></html>`;
  const { products, method } = parseStorefront(html, BASE);
  assert.equal(method, 'next-data');
  assert.equal(products.length, 3); // unavailable item skipped
  const tee = products[0];
  assert.equal(tee.name, 'Unisex Germania Tee - Arched Design'); // SKU "1717" stripped
  assert.equal(tee.price, '$25–$29'); // cents → dollars, size-upcharge range
  assert.equal(tee.url, 'https://germaniavirtualstore.itemorder.com/shop/product/59529280/');
  assert.ok(tee.img!.includes('h_600,w_600')); // upscaled from the 276px thumb
  assert.equal(tee.description, 'Apparel · 11 colors');
  const hat = products.find((p) => p.name.includes('Dad Hat'))!;
  assert.equal(hat.name, 'Germania Logo, Dad Hat'); // "LP101" stripped
  assert.equal(hat.price, '$25');
  const tote = products.find((p) => p.name.includes('Tote'))!;
  assert.equal(tote.name, 'Craft Coffee Tote Bag'); // "Logo It Stock" stripped
  assert.equal(tote.description, 'Accessories & Bags');
  console.log('✓ next-data strategy (real OMG shape)');
}

// ── strategy 1: JSON-LD ─────────────────────────────────────────────
{
  const html = `<html><head><script type="application/ld+json">
  {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
    {"@type":"ListItem","item":{"@type":"Product","name":"G Crew Hoodie","url":"/shop/product/123",
      "image":"https://cdn.example.com/hoodie.jpg","offers":{"@type":"Offer","price":"42.00"}}},
    {"@type":"ListItem","item":{"@type":"Product","name":"Camp Mug &amp; Lid","url":"/shop/product/456",
      "image":["https://cdn.example.com/mug.jpg"],"offers":{"@type":"Offer","price":"18.50"}}}
  ]}</script></head><body></body></html>`;
  const { products, method } = parseStorefront(html, BASE);
  assert.equal(method, 'json-ld');
  assert.equal(products.length, 2);
  assert.equal(products[0].name, 'G Crew Hoodie');
  assert.equal(products[0].price, '$42');
  assert.equal(products[0].url, 'https://germaniavirtualstore.itemorder.com/shop/product/123');
  assert.equal(products[1].name, 'Camp Mug & Lid');
  assert.equal(products[1].price, '$18.50');
  assert.equal(products[1].img, 'https://cdn.example.com/mug.jpg');
  console.log('✓ json-ld strategy');
}

// ── strategy 2: embedded JSON state ─────────────────────────────────
{
  const html = `<html><body><script>
  window.__STORE__ = {"products":[
    {"id":1,"name":"Blackletter Tee","price":"22","slug":"\\/shop\\/product\\/tee","image":"\\/img\\/tee.jpg"},
    {"id":2,"name":"G Dad Hat","min_price":"26.00","product_url":"https:\\/\\/cdn.shop\\/hat","thumbnail":"https:\\/\\/cdn.shop\\/hat.jpg"}
  ]};</script></body></html>`;
  const { products, method } = parseStorefront(html, BASE);
  assert.equal(method, 'embedded-json');
  assert.equal(products.length, 2);
  assert.equal(products[0].price, '$22');
  assert.equal(products[0].url, 'https://germaniavirtualstore.itemorder.com/shop/product/tee');
  assert.equal(products[1].img, 'https://cdn.shop/hat.jpg');
  console.log('✓ embedded-json strategy');
}

// ── strategy 3: anchor scanning ─────────────────────────────────────
{
  const html = `<html><body><div class="grid">
  <div class="tile"><a href="/shop/product/789?color=black" class="plink">
    <img src="/images/beanie.png" alt="Winter Beanie"><h3>Winter Beanie</h3>
    <span class="price">$24.00</span></a></div>
  <div class="tile"><a href="/shop/product/790" class="plink">
    <img src="/images/crew.png" alt="Brew Haus Crewneck"><h3>Brew Haus Crewneck</h3>
    <span class="price">$38</span></a></div>
  </div></body></html>`;
  const { products, method } = parseStorefront(html, BASE);
  assert.equal(method, 'anchors');
  assert.equal(products.length, 2);
  assert.equal(products[0].name, 'Winter Beanie');
  assert.equal(products[0].price, '$24');
  assert.equal(products[0].img, 'https://germaniavirtualstore.itemorder.com/images/beanie.png');
  console.log('✓ anchors strategy');
}

// ── junk in, nothing out ────────────────────────────────────────────
{
  const { products, method } = parseStorefront('<html><body><h1>Store closed</h1></body></html>', BASE);
  assert.equal(method, 'none');
  assert.equal(products.length, 0);
  console.log('✓ empty page yields no products (lineup preserved)');
}

// ── DB round-trip: upsert, retire, badge, hidden ────────────────────
{
  db.exec('DELETE FROM crew_shop_products; DELETE FROM crew_shop_meta;');
  const now = new Date().toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  db.prepare("INSERT INTO crew_shop_meta (key, value) VALUES ('first_sync_at', ?), ('last_success', ?)").run(monthAgo, now);
  const ins = db.prepare(`INSERT INTO crew_shop_products
    (url, name, price, img, active, hidden, badge_override, img_override, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('u1', 'Old Hoodie', '$42', 'a.jpg', 1, 0, null, null, monthAgo, now);       // plain
  ins.run('u2', 'Fresh Tee', '$22', 'b.jpg', 1, 0, null, null, now, now);             // auto-New
  ins.run('u3', 'Retired Cap', '$26', 'c.jpg', 0, 0, null, null, monthAgo, monthAgo); // inactive
  ins.run('u4', 'Hidden Mug', '$18', 'd.jpg', 1, 1, null, null, monthAgo, now);       // hidden
  ins.run('u5', 'Pinned Item', '$30', 'e.jpg', 1, 0, 'Best Seller', 'mine.jpg', monthAgo, now); // overrides

  const { products } = getPublicProducts();
  const names = products.map((p) => p.name);
  assert.deepEqual(new Set(names), new Set(['Old Hoodie', 'Fresh Tee', 'Pinned Item']));
  const byName = Object.fromEntries(products.map((p) => [p.name, p]));
  assert.equal(byName['Fresh Tee'].badge, 'New');
  assert.equal(byName['Old Hoodie'].badge, null);
  assert.equal(byName['Pinned Item'].badge, 'Best Seller');
  assert.equal(byName['Pinned Item'].img, 'mine.jpg');
  console.log('✓ public lineup: retire/hide/badge/override behavior');
}

console.log('\nAll crew-shop tests passed.');
