import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Page, Text, View, Svg, Line, G, Path, Circle, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, 'fonts');

Font.register({ family: 'Oswald', fonts: [
  { src: path.join(FONT_DIR, 'Oswald-ExtraLight.ttf'), fontWeight: 200 },
  { src: path.join(FONT_DIR, 'Oswald-Light.ttf'), fontWeight: 300 },
  { src: path.join(FONT_DIR, 'Oswald-Regular.ttf'), fontWeight: 400 },
  { src: path.join(FONT_DIR, 'Oswald-Medium.ttf'), fontWeight: 500 },
  { src: path.join(FONT_DIR, 'Oswald-SemiBold.ttf'), fontWeight: 600 },
  { src: path.join(FONT_DIR, 'Oswald-Bold.ttf'), fontWeight: 700 },
]});
Font.register({ family: 'Open Sans', fonts: [
  { src: path.join(FONT_DIR, 'OpenSans-ExtraBold.ttf'), fontWeight: 800 },
]});
Font.registerHyphenationCallback((word: string) => [word]);

const INK = '#1a1a1a';

// ─── Decorative dividers ─────────────────────────────────────

function Divider({ width, scale = 1 }: { width: number; scale?: number }) {
  const spacing = 24 * scale;
  const crossCount = Math.floor(width / spacing);
  const totalW = crossCount * spacing;
  const offsetX = (width - totalW) / 2;
  const h = 18 * scale;
  const armLen = 5 * scale;
  const vLen = 7 * scale;
  return (
    <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
      <Line x1={0} y1={h / 2} x2={width} y2={h / 2} stroke={INK} strokeWidth={0.7 * scale} />
      {Array.from({ length: crossCount }, (_, i) => {
        const cx = offsetX + i * spacing + spacing / 2;
        const cy = h / 2;
        return (
          <G key={i}>
            <Line x1={cx - armLen} y1={cy - armLen} x2={cx + armLen} y2={cy + armLen} stroke={INK} strokeWidth={0.8 * scale} />
            <Line x1={cx + armLen} y1={cy - armLen} x2={cx - armLen} y2={cy + armLen} stroke={INK} strokeWidth={0.8 * scale} />
            <Line x1={cx} y1={cy - vLen} x2={cx} y2={cy + vLen} stroke={INK} strokeWidth={0.5 * scale} />
          </G>
        );
      })}
    </Svg>
  );
}

function SmallDivider({ width, scale = 1 }: { width: number; scale?: number }) {
  const spacing = 18 * scale;
  const crossCount = Math.floor(width / spacing);
  const totalW = crossCount * spacing;
  const offsetX = (width - totalW) / 2;
  const h = 12 * scale;
  const armLen = 4 * scale;
  return (
    <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
      <Line x1={0} y1={h / 2} x2={width} y2={h / 2} stroke={INK} strokeWidth={0.5 * scale} />
      {Array.from({ length: crossCount }, (_, i) => {
        const cx = offsetX + i * spacing + spacing / 2;
        const cy = h / 2;
        return (
          <G key={i}>
            <Line x1={cx - armLen} y1={cy - armLen} x2={cx + armLen} y2={cy + armLen} stroke={INK} strokeWidth={0.6 * scale} />
            <Line x1={cx + armLen} y1={cy - armLen} x2={cx - armLen} y2={cy + armLen} stroke={INK} strokeWidth={0.6 * scale} />
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Scaled components (all sizes parameterized by scale) ────

interface ScaleCtx {
  s: number; // scale factor (1 = 24x36 base)
  contentW: number;
  padH: number;
}

function CategoryHeader({ name, subtitle, ctx }: { name: string; subtitle: string | null; ctx: ScaleCtx }) {
  const { s, contentW } = ctx;
  const nameSize = 104 * s;
  const subSize = 30 * s;
  const textEstW = name.length * nameSize * 0.55;
  const sideW = Math.max(60 * s, (contentW - textEstW) / 2 - 16 * s);
  return (
    <View style={{ alignItems: 'center', marginTop: 14 * s, marginBottom: 6 * s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: contentW, justifyContent: 'center' }}>
        <View style={{ width: sideW }}><Divider width={sideW} scale={s} /></View>
        <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: nameSize, textTransform: 'uppercase', letterSpacing: 2 * s, textAlign: 'center', paddingHorizontal: 12 * s }}>
          {name}
        </Text>
        <View style={{ width: sideW }}><Divider width={sideW} scale={s} /></View>
      </View>
      {subtitle && (
        <Text style={{ fontFamily: 'Open Sans', fontWeight: 800, fontSize: subSize, textTransform: 'uppercase', letterSpacing: 4 * s, marginTop: -10 * s, textAlign: 'center' }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function SpotifyIcon({ size }: { size: number }) {
  const r = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0z" fill="#1DB954" />
        <Path d="M17.2 17.3c-.2 0-.4-.1-.5-.2-2.5-1.5-5.6-1.9-8.4-1.2-.3.1-.6-.1-.7-.4-.1-.3.1-.6.4-.7 3.1-.8 6.5-.3 9.3 1.3.3.2.4.5.2.8-.1.2-.3.4-.3.4z" fill="white" />
        <Path d="M18.5 14.1c-.2 0-.4-.1-.6-.2-2.9-1.8-6.8-2.3-10-1.3-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 3.6-1.1 7.8-.5 11 1.5.3.2.4.6.2.9-.1.2-.4.3-.2.3z" fill="white" />
        <Path d="M18.8 10.7c-.2 0-.3 0-.5-.1-3.3-2-8.1-2.5-11.6-1.4-.4.1-.7-.1-.8-.4-.1-.4.1-.7.4-.8C10.1 7.8 15.3 8.3 19 10.5c.3.2.4.6.2 1-.1.1-.3.2-.4.2z" fill="white" />
      </Svg>
    </View>
  );
}

function DrinkItem({ item, ctx, half }: { item: any; ctx: ScaleCtx; half?: boolean }) {
  const { s } = ctx;
  const nameSize = half ? 70 * s : 79 * s;
  const descSize = half ? 24 * s : 30 * s;
  const sizeSize = half ? 22 * s : 26 * s;
  const priceSize = half ? 24 * s : 28 * s;
  const tempSize = half ? 22 * s : 26 * s;
  const colW = half ? 110 * s : 140 * s;
  const spotifySize = half ? 28 * s : 36 * s;

  return (
    <View style={{ alignItems: 'center', marginBottom: 14 * s, ...(half ? { width: '100%' } : {}) }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' }}>
        {item.hasSpotify && <View style={{ width: spotifySize + 4 * s }} />}
        <Text style={{ fontFamily: 'Oswald', fontWeight: 400, fontSize: nameSize, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 1 * s }}>
          {item.name}
        </Text>
        {item.hasSpotify && <View style={{ marginLeft: 4 * s, marginTop: 2 * s }}><SpotifyIcon size={spotifySize} /></View>}
      </View>
      {item.description && (
        <Text style={{ fontFamily: 'Open Sans', fontWeight: 800, fontSize: descSize, textTransform: 'uppercase', letterSpacing: 1.5 * s, textAlign: 'center', marginTop: 2 * s }}>
          {item.description}
        </Text>
      )}
      {item.sizeLabels && item.prices && (
        <View style={{ marginTop: 6 * s, alignItems: 'center' }}>
          {item.sizeLabels.length === 1 ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: sizeSize, textTransform: 'uppercase', letterSpacing: 2 * s, textAlign: 'center' }}>
                {item.sizeLabels[0]}
              </Text>
              <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: priceSize, textAlign: 'center' }}>
                {item.prices[0]}
              </Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {item.sizeLabels.map((sz: string, i: number) => (
                  <Text key={i} style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: sizeSize, textTransform: 'uppercase', letterSpacing: 2 * s, textAlign: 'center', width: colW }}>
                    {sz}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {item.prices.map((p: string, i: number) => (
                  <Text key={i} style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: priceSize, textAlign: 'center', width: colW }}>
                    {p}
                  </Text>
                ))}
              </View>
            </>
          )}
        </View>
      )}
      {item.temps && (
        <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: tempSize, textTransform: 'uppercase', letterSpacing: 2 * s, textAlign: 'center', marginTop: 4 * s }}>
          {item.temps}
        </Text>
      )}
    </View>
  );
}

function FrozenNote({ ctx }: { ctx: ScaleCtx }) {
  const { s } = ctx;
  return (
    <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: 22 * s, textTransform: 'uppercase', letterSpacing: 1 * s, textAlign: 'center', marginTop: 4 * s, marginBottom: 4 * s, color: '#555' }}>
      Frozen Prices Vary
    </Text>
  );
}

function FoodItem({ item, ctx }: { item: any; ctx: ScaleCtx }) {
  const { s } = ctx;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 14 * s, width: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14 * s, flex: 1 }}>
        {item.isNew && (
          <View style={{ backgroundColor: '#e74c3c', borderRadius: 16 * s, width: 70 * s, height: 32 * s, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Open Sans', fontWeight: 800, fontSize: 14 * s, color: '#fff', textTransform: 'uppercase' }}>NEW</Text>
          </View>
        )}
        <Text style={{ fontFamily: 'Oswald', fontWeight: 400, fontSize: 56 * s, textTransform: 'uppercase' }}>
          {item.name}
        </Text>
        {item.foodSubtitle && (
          <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: 32 * s, textTransform: 'uppercase' }}>
            {item.foodSubtitle}
          </Text>
        )}
      </View>
      <Text style={{ fontFamily: 'Oswald', fontWeight: 400, fontSize: 56 * s }}>
        {item.foodPrice}
      </Text>
    </View>
  );
}

function BottomLists({ lists, ctx }: { lists: any[]; ctx: ScaleCtx }) {
  if (lists.length === 0) return null;
  const { s, contentW } = ctx;
  const colW = contentW / lists.length;
  return (
    <View style={{ flexDirection: 'row', marginTop: 'auto', paddingTop: 10 * s }}>
      {lists.map((list: any) => (
        <View key={list.id} style={{ width: colW, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: 36 * s, textTransform: 'uppercase', letterSpacing: 2 * s, marginBottom: 8 * s, textAlign: 'center' }}>
            {list.name}
          </Text>
          <SmallDivider width={colW * 0.6} scale={s} />
          {(() => {
            const listItems = list.items || [];
            const half = Math.ceil(listItems.length / 2);
            const col1 = listItems.slice(0, half);
            const col2 = listItems.slice(half);
            return (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 * s, marginTop: 10 * s }}>
                <View style={{ alignItems: 'center' }}>
                  {col1.map((item: any, i: number) => (
                    <Text key={i} style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: 24 * s, textAlign: 'center' }}>
                      ~{item.name}~
                    </Text>
                  ))}
                </View>
                {col2.length > 0 && (
                  <View style={{ alignItems: 'center' }}>
                    {col2.map((item: any, i: number) => (
                      <Text key={i} style={{ fontFamily: 'Oswald', fontWeight: 200, fontSize: 24 * s, textAlign: 'center' }}>
                        ~{item.name}~
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })()}
        </View>
      ))}
    </View>
  );
}

// ─── Page renderer ───────────────────────────────────────────

function MenuPage({ season, side, location, pageW, pageH, padH, scale }: {
  season: any; side: 'front' | 'back'; location: string;
  pageW: number; pageH: number; padH: number; scale: number;
}) {
  const ctx: ScaleCtx = { s: scale, contentW: pageW - padH * 2, padH };
  const categories = (season.categories || []).filter((c: any) => c.side === side);
  const lists = (season.lists || []).filter((l: any) => l.side === side);

  return (
    <Page size={[pageW, pageH]} style={{ paddingHorizontal: padH, paddingTop: 20 * scale, paddingBottom: 80 * scale, backgroundColor: '#ffffff' }}>
      <View style={{ flex: 1 }}>
      {categories.map((cat: any) => {
        const items = cat.items.filter((item: any) => {
          if (item.kind === 'food' && item.locations && item.locations.length > 0) {
            return item.locations.some((l: any) => l.location === location);
          }
          return true;
        });
        if (items.length === 0) return null;

        const drinkItems = items.filter((i: any) => i.kind === 'drink');
        const foodItems = items.filter((i: any) => i.kind === 'food');
        const hasFrozenNote = items.some((i: any) => i.frozenNote);
        // Sweet Coffee always renders as a 2-column grid
        const isGrid = cat.name.toLowerCase().includes('sweet');

        return (
          <View key={cat.id}>
            <CategoryHeader name={cat.name} subtitle={cat.subtitle} ctx={ctx} />

            {isGrid && drinkItems.length > 0 ? (
              <View>
                {Array.from({ length: Math.ceil(drinkItems.length / 2) }, (_, pairIdx) => {
                  const left = drinkItems[pairIdx * 2];
                  const right = drinkItems[pairIdx * 2 + 1];
                  return (
                    <View key={pairIdx} style={{ flexDirection: 'row', marginBottom: 8 * scale }}>
                      <View style={{ width: '50%', alignItems: 'center' }}>
                        {left && <DrinkItem item={left} ctx={ctx} half />}
                      </View>
                      <View style={{ width: '50%', alignItems: 'center' }}>
                        {right && <DrinkItem item={right} ctx={ctx} half />}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              drinkItems.map((item: any) => (
                <DrinkItem key={item.id} item={item} ctx={ctx} />
              ))
            )}

            {foodItems.map((item: any) => (
              <FoodItem key={item.id} item={item} ctx={ctx} />
            ))}

            {hasFrozenNote && <FrozenNote ctx={ctx} />}
          </View>
        );
      })}

      <BottomLists lists={lists} ctx={ctx} />
      </View>
    </Page>
  );
}

// ─── Export ──────────────────────────────────────────────────

export async function renderMenuPdf(season: any, location: string): Promise<Buffer> {
  const is18x48 = location === 'G4';
  const pageW = is18x48 ? 18 * 72 : 24 * 72;
  const pageH = is18x48 ? 48 * 72 : 36 * 72;
  const padH = is18x48 ? 80 : 100;
  const scale = is18x48 ? 0.75 : 1;

  const doc = (
    <Document>
      <MenuPage season={season} side="front" location={location} pageW={pageW} pageH={pageH} padH={padH} scale={scale} />
      <MenuPage season={season} side="back" location={location} pageW={pageW} pageH={pageH} padH={padH} scale={scale} />
    </Document>
  );

  return await renderToBuffer(doc);
}
