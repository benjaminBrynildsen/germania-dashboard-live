# Crew Shop page for germaniabrewhaus.com

A branded merch page for the public Squarespace site. It shows our products
in the Brew Haus look (menu-board typography: Oswald caps, Open Sans labels,
black/white, red pills) and deep-links each **Buy** button to the item on the
vendor store (`germaniavirtualstore.itemorder.com`, OrderMyGear). The vendor
still handles cart, payment, and fulfillment — this page just replaces their
generic storefront as the thing customers browse.

`crew-shop-code-block.html` is the whole page. It is self-contained
(HTML + CSS + a small script that renders the product grid from a list).

## Adding it to Squarespace

1. In Squarespace: **Pages → + → Blank Page**, name it **Crew Shop**, and
   place it in the main navigation.
2. Edit the page, add a **Code** block (type: HTML).
3. Paste the entire contents of `crew-shop-code-block.html` into the block
   and save.

Notes:
- Code blocks with scripts require a Squarespace **Business** plan or higher.
  On a Personal plan the script tag is stripped — if that's our plan, ask and
  we'll generate a static (no-script) version of the grid instead.
- The page pulls Germania One / Oswald / Open Sans from Google Fonts, so it
  matches the brand even if the site theme uses different fonts.

## Updating products

Open the Code block and edit the `PRODUCTS` list near the bottom:

```js
{ name: 'G Crew Hoodie', desc: 'Black · S–3XL', price: '$42',
  url: 'https://germaniavirtualstore.itemorder.com/shop/product/...',
  img: 'https://images.squarespace-cdn.com/.../hoodie.jpg',
  badge: 'Best Seller' }
```

- **url** — open the item on the vendor store and copy the address bar.
  If left `''`, the button falls back to the store's front page.
- **img** — upload the product photo to Squarespace (an image block on any
  unlinked page works, or Design → Custom Files) and paste the image URL.
  While `''`, the card shows an "add product photo" placeholder.
  Ask the vendor for their high-res product mockups — they have them from
  the proofing process.
- **badge** — optional red pill ("New", "Best Seller"). Remove the field
  for no badge.

Items appear in list order. To retire an item, delete its line.
