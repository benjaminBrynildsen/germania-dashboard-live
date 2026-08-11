/**
 * Crew Shop embed — the entire merch page as a self-contained script.
 *
 * Served by the dashboard at /api/public/crew-shop/embed.js and loaded
 * by a tiny stub in a Squarespace Code Block on germaniabrewhaus.com.
 * Because Squarespace only holds the stub, design and behavior changes
 * ship by deploying the dashboard — the Code Block never changes.
 *
 * Stub options (attributes on the <script> tag):
 *   data-header="false"  — hide the big "Crew Shop" heading when the
 *                          Squarespace page already renders its own title.
 */
(function () {
  'use strict';

  var STORE_URL = 'https://germaniavirtualstore.itemorder.com/shop/sale/';

  var script = document.currentScript;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }
  var showHeader = !script || script.getAttribute('data-header') !== 'false';

  var mount = document.getElementById('gbh-crew-shop');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'gbh-crew-shop';
    script.parentNode.insertBefore(mount, script);
  }
  mount.classList.add('gbh-crew-shop');

  // Brand faces via Google Fonts — skip if the page already loads them.
  if (!document.querySelector('link[href*="family=Oswald"]')) {
    var pre1 = document.createElement('link');
    pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
    var pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
    var fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@800&family=Oswald:wght@200;400&display=swap';
    document.head.appendChild(pre1);
    document.head.appendChild(pre2);
    document.head.appendChild(fonts);
  }

  if (!document.getElementById('gbh-crew-shop-css')) {
    var css = document.createElement('style');
    css.id = 'gbh-crew-shop-css';
    css.textContent = [
      '.gbh-crew-shop{--ink:#1a1a1a;--paper:#fff;--cut:#f5f5f5;--muted:#555;--faint:#9a9a9a;--red:#e74c3c;',
      '  color:var(--ink);font-family:"Open Sans",sans-serif}',
      '.gbh-crew-shop *{box-sizing:border-box;margin:0}',
      '.gbh-shop-head{text-align:center;padding:24px 0 8px}',
      '.gbh-shop-head h2{font-family:Oswald,sans-serif;font-weight:200;font-size:clamp(44px,7vw,72px);',
      '  letter-spacing:.08em;text-transform:uppercase;line-height:1.02;color:var(--ink)}',
      '.gbh-shop-sub{font-family:"Open Sans",sans-serif;font-weight:800;font-size:13px;letter-spacing:.34em;',
      '  text-transform:uppercase;margin-top:10px}',
      '.gbh-shop-rule{width:72px;height:3px;background:var(--ink);margin:24px auto 0}',
      '.gbh-shop-note{margin-top:16px;color:var(--muted);font-size:14px;font-weight:400}',
      '.gbh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px;padding:32px 0 8px}',
      '.gbh-card{background:var(--paper);border:1px solid var(--ink);display:flex;flex-direction:column;',
      '  transition:box-shadow .15s ease,transform .15s ease}',
      '.gbh-card:hover{transform:translateY(-2px);box-shadow:0 6px 0 0 var(--ink)}',
      '@media (prefers-reduced-motion:reduce){.gbh-card,.gbh-card:hover{transition:none;transform:none;box-shadow:none}}',
      '.gbh-tile{aspect-ratio:1/.95;background:var(--cut);border-bottom:1px solid var(--ink);position:relative;',
      '  overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.gbh-tile img{width:100%;height:100%;object-fit:cover;display:block}',
      '.gbh-tile .gbh-placeholder{font-family:"Open Sans",sans-serif;font-weight:800;font-size:10px;',
      '  letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}',
      '.gbh-badge{position:absolute;top:10px;left:10px;z-index:1;font-family:"Open Sans",sans-serif;font-weight:800;',
      '  font-size:10px;letter-spacing:.06em;text-transform:uppercase;background:var(--red);color:#fff;',
      '  padding:4px 12px;border-radius:999px}',
      '.gbh-body{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1;text-align:center}',
      '.gbh-name{font-family:Oswald,sans-serif;font-weight:400;font-size:19px;line-height:1.2;',
      '  letter-spacing:.06em;text-transform:uppercase;color:var(--ink)}',
      '.gbh-desc{font-family:"Open Sans",sans-serif;font-weight:800;font-size:10px;letter-spacing:.14em;',
      '  text-transform:uppercase;color:var(--muted)}',
      '.gbh-price{font-family:Oswald,sans-serif;font-weight:200;font-size:24px;letter-spacing:.06em;',
      '  color:var(--ink);font-variant-numeric:tabular-nums}',
      'a.gbh-buy{margin-top:auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;',
      '  border:1px solid var(--ink);background:var(--ink);color:var(--paper);font-family:Oswald,sans-serif;',
      '  font-weight:400;font-size:13px;letter-spacing:.2em;text-transform:uppercase;padding:12px 14px;',
      '  text-decoration:none;cursor:pointer;transition:background .15s ease,color .15s ease}',
      'a.gbh-buy:hover{background:var(--paper);color:var(--ink);text-decoration:none}',
      'a.gbh-buy:focus-visible{outline:3px solid var(--red);outline-offset:2px}',
      'a.gbh-buy svg{width:12px;height:12px}',
      '.gbh-foot{border-top:1px solid var(--ink);margin-top:28px;padding:18px 0 8px;font-size:12.5px;',
      '  color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 24px;font-weight:400}',
      '.gbh-foot b{color:var(--ink);font-weight:800}',
      '.gbh-foot a{color:var(--ink);font-weight:800;text-decoration:none}',
      '.gbh-foot a:hover{text-decoration:underline}',
      '.gbh-empty{text-align:center;padding:40px 0;color:var(--muted);font-size:14px}',
      '.gbh-empty a{color:var(--ink);font-weight:800}',
    ].join('\n');
    document.head.appendChild(css);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Page skeleton. The heading is an <h2> so Squarespace's own page
  // title keeps the page's single <h1>.
  var head = el('div', 'gbh-shop-head');
  head.appendChild(el('h2', null, 'Crew Shop'));
  head.appendChild(el('div', 'gbh-shop-sub', 'Official Germania Brew Haus Merch'));
  head.appendChild(el('div', 'gbh-shop-rule'));
  head.appendChild(el('p', 'gbh-shop-note', 'Printed to order · shipped by our print partner'));
  if (!showHeader) head.style.display = 'none';
  mount.appendChild(head);

  var grid = el('div', 'gbh-grid');
  mount.appendChild(grid);

  // Order questions go straight to the print partner (Logo It), never
  // to the coffee shops — owner's call, they don't handle merch orders.
  var foot = el('div', 'gbh-foot');
  var f1 = el('span');
  f1.appendChild(el('b', null, 'Checkout & fulfillment'));
  f1.appendChild(document.createTextNode(' by Logo It, our print partner, via their secure store.'));
  var f2 = el('span', null, 'Order questions? Contact Logo It directly — ');
  var mail = el('a', null, 'orders@wecanlogoit.com');
  mail.href = 'mailto:orders@wecanlogoit.com';
  f2.appendChild(mail);
  f2.appendChild(document.createTextNode(' · '));
  var tel = el('a', null, '(618) 462-1899');
  tel.href = 'tel:+16184621899';
  f2.appendChild(tel);
  foot.appendChild(f1);
  foot.appendChild(f2);
  mount.appendChild(foot);

  var ARROW_NS = 'http://www.w3.org/2000/svg';
  function arrow() {
    var svg = document.createElementNS(ARROW_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ARROW_NS, 'path');
    path.setAttribute('d', 'M2 10 L10 2 M4 2 h6 v6');
    svg.appendChild(path);
    return svg;
  }

  function render(products) {
    grid.textContent = '';
    products.forEach(function (p) {
      var card = el('div', 'gbh-card');

      var tile = el('div', 'gbh-tile');
      if (p.badge) tile.appendChild(el('span', 'gbh-badge', p.badge));
      if (p.img) {
        var img = document.createElement('img');
        img.src = p.img;
        img.alt = p.name;
        img.loading = 'lazy';
        img.onerror = function () {
          img.remove();
          tile.appendChild(el('span', 'gbh-placeholder', 'Photo coming soon'));
        };
        tile.appendChild(img);
      } else {
        tile.appendChild(el('span', 'gbh-placeholder', 'Photo coming soon'));
      }
      card.appendChild(tile);

      var body = el('div', 'gbh-body');
      body.appendChild(el('div', 'gbh-name', p.name));
      if (p.desc) body.appendChild(el('div', 'gbh-desc', p.desc));
      if (p.price) body.appendChild(el('div', 'gbh-price', p.price));

      var buy = el('a', 'gbh-buy', 'Buy ');
      buy.href = p.url || STORE_URL;
      buy.target = '_blank';
      buy.rel = 'noopener';
      buy.setAttribute('aria-label', 'Buy ' + p.name + ' on our merch store');
      buy.appendChild(arrow());
      body.appendChild(buy);

      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  function renderEmpty() {
    grid.textContent = '';
    var box = el('div', 'gbh-empty');
    box.appendChild(document.createTextNode('The lineup is loading slowly — '));
    var a = el('a', null, 'shop directly on our store');
    a.href = STORE_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    box.appendChild(a);
    box.appendChild(document.createTextNode('.'));
    grid.appendChild(box);
  }

  fetch(origin + '/api/public/crew-shop/products')
    .then(function (res) {
      if (!res.ok) throw new Error('feed ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (data && data.products && data.products.length > 0) render(data.products);
      else renderEmpty();
    })
    .catch(renderEmpty);
})();
