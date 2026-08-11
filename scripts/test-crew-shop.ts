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
