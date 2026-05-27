import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Page, Text, View, Svg, G, Path, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';
import type { Sop, Availability } from '../src/lib/sop-types.js';
import { SOP_CATEGORIES } from '../src/lib/sop-types.js';
import { buildSopPages } from './sop-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

Font.register({ family: 'Germania One', src: path.join(__dirname, 'fonts', 'GermaniaOne-Regular.ttf') });
Font.register({ family: 'Anton', src: path.join(__dirname, 'fonts', 'Anton-Regular.ttf') });
Font.register({ family: 'Work Sans', fonts: [
  { src: path.join(__dirname, 'fonts', 'WorkSans-Regular.ttf'), fontWeight: 400 },
  { src: path.join(__dirname, 'fonts', 'WorkSans-SemiBold.ttf'), fontWeight: 600 },
]});

Font.registerHyphenationCallback((word: string) => [word]);

const INK = '#0a0a0a';

const s = StyleSheet.create({
  page: {
    width: 612, height: 792, // LETTER
    paddingTop: 40, paddingBottom: 30, paddingHorizontal: 45,
    fontFamily: 'Work Sans', fontSize: 10, color: INK,
    position: 'relative' as const,
  },

  // --- header bar ---
  headerBar: {
    flexDirection: 'row', gap: 10,
    fontSize: 7.5, letterSpacing: 2.4, textTransform: 'uppercase', fontWeight: 600,
    paddingBottom: 10, borderBottomWidth: 1.2, borderBottomColor: INK,
  },
  headerSep: { opacity: 0.4 },

  // --- corner logo ---
  corner: {
    position: 'absolute', top: 18, right: 45,
    fontFamily: 'Anton', fontSize: 24, lineHeight: 1,
    letterSpacing: -0.5,
  },

  // --- giant title ---
  titleBlock: { marginTop: 14, marginBottom: 10 },
  titleRow: {
    fontFamily: 'Anton', fontSize: 90, lineHeight: 1.0,
    textTransform: 'uppercase', letterSpacing: -1,
  },
  yearRow: {
    fontFamily: 'Anton', fontSize: 18, letterSpacing: 5,
    textTransform: 'uppercase', marginTop: 4,
  },
  tagline: {
    fontSize: 9, lineHeight: 1.5, maxWidth: 390, marginBottom: 14,
  },

  // --- TOC ---
  tocSection: { marginBottom: 10 },
  tocHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 4, marginBottom: 3,
    borderBottomWidth: 0.8, borderBottomColor: INK,
  },
  tocNum: { fontFamily: 'Anton', fontSize: 18 },
  tocName: { fontFamily: 'Anton', fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.4 },
  tocLine: { flex: 1, height: 0.7, backgroundColor: 'rgba(10,10,10,0.3)' },
  tocCount: { fontSize: 7, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600, opacity: 0.6 },

  tocGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  tocItem: {
    width: '50%',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 3, paddingRight: 10,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(10,10,10,0.2)', borderBottomStyle: 'dashed',
    fontSize: 9.5,
  },
  tocItemRight: {
    width: '50%',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 3, paddingLeft: 10, paddingRight: 0,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(10,10,10,0.2)', borderBottomStyle: 'dashed',
    fontSize: 9.5,
  },
  drinkName: { fontWeight: 600 },
  drinkKind: { fontSize: 7, letterSpacing: 1.8, textTransform: 'uppercase', opacity: 0.6 },

  // --- half-row (1st / 2nd half side by side) ---
  halfRow: { flexDirection: 'row', gap: 18, marginBottom: 10 },
  halfCol: { flex: 1 },

  // --- inventory section ---
  invWrap: { marginTop: 4, paddingTop: 8, borderTopWidth: 1.5, borderTopColor: INK },
  invHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 4, marginBottom: 4,
    borderBottomWidth: 0.8, borderBottomColor: INK,
  },
  invCols: { flexDirection: 'row', gap: 18 },
  invCol: { flex: 1 },
  invLabel: {
    fontFamily: 'Anton', fontSize: 14, letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 3,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  invArrow: { fontSize: 16, lineHeight: 1 },
  invItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 2,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(10,10,10,0.2)', borderBottomStyle: 'dashed',
    fontSize: 9,
  },
  invName: { fontWeight: 600 },
  invTag: { fontSize: 7, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.6 },

  // --- footer ---
  footer: {
    marginTop: 'auto',
    paddingTop: 10, borderTopWidth: 1.2, borderTopColor: INK,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 7.5, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600,
  },

  // --- divider page ---
  dividerPage: {
    paddingTop: 60, paddingBottom: 60, paddingHorizontal: 60,
    color: INK, fontFamily: 'Helvetica',
    justifyContent: 'center', alignItems: 'center',
  },
  dividerText: { fontSize: 64, fontFamily: 'Germania One', textAlign: 'center' },
});

function seasonLabel(collection: string | null): string {
  if (!collection) return '';
  const m = collection.match(/(Spring|Summer|Fall|Winter)/i);
  return m ? m[1].toUpperCase() : collection.toUpperCase();
}

function shortSeason(collection: string | null): string {
  if (!collection) return '';
  const m = collection.match(/(Spring|Summer|Fall|Winter)\s*(\d{4})/i);
  if (m) return `${m[1].toUpperCase()} '${m[2].slice(2)}`;
  return collection.toUpperCase();
}

function yearFromCollection(collection: string | null): string {
  if (!collection) return '';
  const m = collection.match(/(\d{4})/);
  return m ? m[1] : '';
}

function volNumber(): string {
  return '12';
}

function categoryShortName(sop: Sop): string {
  if (!sop.category) return '';
  const cat = SOP_CATEGORIES.find((c) => c.key === sop.category);
  if (!cat) return '';
  if (cat.key === 'tsm') return 'Tea/Smoothie';
  return cat.shortName;
}

// Anton font glyph paths for "MENU" — extracted from the TTF at 2048 upem.
// Used to render an outline-only (stroke, no fill) version of the word,
// since react-pdf doesn't support CSS text-stroke.
const MENU_GLYPHS = [
  { offset: 0, d: 'M78 0V1760H614L762 687L909 1760H1450V0H1128V1268L926 0H610L396 1268V0Z' },
  { offset: 1528, d: 'M78 0V1760H782V1420H436V1077H768V746H436V343H805V0Z' },
  { offset: 2371, d: 'M78 0V1760H440L602 917V1760H942V0H598L422 880V0Z' },
  { offset: 3391, d: 'M485 -16Q265 -16 161.0 107.5Q57 231 57 471V1760H399V485Q399 441 404.0 400.5Q409 360 427.0 334.0Q445 308 485 308Q526 308 544.0 333.5Q562 359 566.5 400.0Q571 441 571 485V1760H913V471Q913 231 809.0 107.5Q705 -16 485 -16Z' },
];
const MENU_TOTAL_W = 4361;
const MENU_H = 1776; // cap height 1760 + descent 16
const MENU_CAP = 1760;
const UPEM = 2048;
const TITLE_PT = 90;
const MENU_SVG_W = MENU_TOTAL_W * (TITLE_PT / UPEM); // ~191.6
const MENU_SVG_H = MENU_H * (TITLE_PT / UPEM);       // ~78

function MenuOutline() {
  return (
    <View style={{ width: MENU_SVG_W, height: MENU_SVG_H, marginTop: -2 }}>
      <Svg width={MENU_SVG_W} height={MENU_SVG_H} viewBox={`0 0 ${MENU_TOTAL_W} ${MENU_H}`}>
        <G transform={`translate(0,${MENU_H}) scale(1,-1)`}>
          {MENU_GLYPHS.map((g, i) => (
            <Path
              key={i}
              d={g.d}
              fill="none"
              stroke={INK}
              strokeWidth={28}
              transform={`translate(${g.offset},0)`}
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

function CoverPage({ sops, collection, transitionNote }: { sops: Sop[]; collection: string | null; transitionNote: string | null }) {
  const grouped: Record<Availability | 'Unspecified', Sop[]> = {
    'All-Season': [],
    '1st Half Only': [],
    '2nd Half Only': [],
    'Unspecified': [],
  };
  for (const sop of sops) {
    const key = (sop.availability ?? 'Unspecified') as keyof typeof grouped;
    grouped[key].push(sop);
  }
  const categoryOrder = new Map(SOP_CATEGORIES.map((c, i) => [c.key, i]));
  const sortByCategory = (a: Sop, b: Sop) => {
    const ai = a.category ? categoryOrder.get(a.category) ?? 99 : 99;
    const bi = b.category ? categoryOrder.get(b.category) ?? 99 : 99;
    return ai - bi || a.name.localeCompare(b.name);
  };
  Object.values(grouped).forEach((list) => list.sort(sortByCategory));

  const season = seasonLabel(collection);
  const year = yearFromCollection(collection);
  const totalPages = sops.filter((sop) => sop.sopRequired !== false).length;
  const has1st = grouped['1st Half Only'].length > 0;
  const has2nd = grouped['2nd Half Only'].length > 0;

  let sectionNum = 0;

  return (
    <Page size="LETTER" style={s.page}>
      {/* Corner logo */}
      <Text style={s.corner}>G/H</Text>

      {/* Header bar */}
      <View style={s.headerBar}>
        <Text>VOL. {volNumber()}</Text>
        <Text style={s.headerSep}>/</Text>
        <Text>{shortSeason(collection)}</Text>
        <Text style={s.headerSep}>/</Text>
        <Text>RECIPE PACKET</Text>
      </View>

      {/* Giant title */}
      <View style={s.titleBlock}>
        <Text style={s.titleRow}>{season || 'MENU'}</Text>
        <MenuOutline />
        <Text style={s.yearRow}>— {year} —</Text>
      </View>

      {/* Tagline */}
      <Text style={s.tagline}>
        A complete book of standard operating procedures for the {season.toLowerCase()} season.{'\n'}
        Bridge drinks, sweet builds, artisanal pours, tea &amp; smoothies.
      </Text>

      {/* 01 All-Season */}
      {grouped['All-Season'].length > 0 && (
        <TocSection
          num={String(++sectionNum).padStart(2, '0')}
          name="All-Season"
          items={grouped['All-Season']}
          twoCol
        />
      )}

      {/* 02/03 half sections side by side, only if either exists */}
      {(has1st || has2nd) && (
        <View style={s.halfRow}>
          {has1st && (
            <View style={s.halfCol}>
              <TocSection
                num={String(++sectionNum).padStart(2, '0')}
                name="1st Half Only"
                items={grouped['1st Half Only']}
                twoCol={false}
              />
            </View>
          )}
          {has2nd && (
            <View style={s.halfCol}>
              <TocSection
                num={String(++sectionNum).padStart(2, '0')}
                name="2nd Half Only"
                items={grouped['2nd Half Only']}
                twoCol={false}
              />
            </View>
          )}
        </View>
      )}

      {/* Unspecified */}
      {grouped['Unspecified'].length > 0 && (
        <TocSection
          num={String(++sectionNum).padStart(2, '0')}
          name="Other"
          items={grouped['Unspecified']}
          twoCol
        />
      )}

      {/* 04 Bottles & Inventory */}
      {transitionNote && <InventorySection num={String(++sectionNum).padStart(2, '0')} note={transitionNote} season={season.toLowerCase()} />}

      {/* Footer */}
      <View style={s.footer}>
        <Text>GERMANIA HAUS COFFEE</Text>
        <Text>00 / {String(totalPages).padStart(2, '0')}</Text>
      </View>
    </Page>
  );
}

function TocSection({ num, name, items, twoCol }: { num: string; name: string; items: Sop[]; twoCol: boolean }) {
  const count = items.length;
  return (
    <View style={s.tocSection}>
      <View style={s.tocHead}>
        <Text style={s.tocNum}>{num}</Text>
        <Text style={s.tocName}>{name}</Text>
        <View style={s.tocLine} />
        <Text style={s.tocCount}>{String(count).padStart(2, '0')} ITEMS</Text>
      </View>
      <View style={s.tocGrid}>
        {items.map((sop, i) => {
          const isRight = twoCol && i % 2 === 1;
          return (
            <View key={sop.slug} style={isRight ? s.tocItemRight : (twoCol ? s.tocItem : { ...s.tocItem, width: '100%', paddingRight: 0 })}>
              <Text style={s.drinkName}>{sop.name}</Text>
              <Text style={s.drinkKind}>{categoryShortName(sop)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function InventorySection({ num, note, season }: { num: string; note: string; season: string }) {
  // Parse transition note into Leaving / Coming In sections.
  // Expected format from the collection meta transition_note field
  // is free text. We'll parse structured format if present, otherwise
  // show the raw note as a simple line.
  const lines = note.split('\n').map((l) => l.trim()).filter(Boolean);

  // Try to parse structured "LEAVING: item (tag), item (tag)\nCOMING IN: ..."
  let leaving: Array<{ name: string; tag: string }> = [];
  let coming: Array<{ name: string; tag: string }> = [];

  let currentList: typeof leaving | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('leaving')) {
      currentList = leaving;
      const rest = line.replace(/^leaving[:\s]*/i, '').trim();
      if (rest) parseItems(rest, leaving);
      continue;
    }
    if (lower.startsWith('coming in') || lower.startsWith('coming:')) {
      currentList = coming;
      const rest = line.replace(/^coming\s*in?[:\s]*/i, '').trim();
      if (rest) parseItems(rest, coming);
      continue;
    }
    if (currentList) parseItems(line, currentList);
  }

  const hasStructured = leaving.length > 0 || coming.length > 0;

  return (
    <View style={s.invWrap}>
      <View style={s.invHead}>
        <Text style={s.tocNum}>{num}</Text>
        <Text style={s.tocName}>Bottles &amp; Inventory</Text>
        <View style={s.tocLine} />
        <Text style={s.tocCount}>{season} transition</Text>
      </View>
      {hasStructured ? (
        <View style={s.invCols}>
          {leaving.length > 0 && (
            <View style={s.invCol}>
              <View style={s.invLabel}>
                <Text style={s.invArrow}>←</Text>
                <Text>LEAVING</Text>
              </View>
              {leaving.map((item, i) => (
                <View key={i} style={s.invItem}>
                  <Text style={s.invName}>{item.name}</Text>
                  <Text style={s.invTag}>{item.tag}</Text>
                </View>
              ))}
            </View>
          )}
          {coming.length > 0 && (
            <View style={s.invCol}>
              <View style={s.invLabel}>
                <Text style={s.invArrow}>→</Text>
                <Text>COMING IN</Text>
              </View>
              {coming.map((item, i) => (
                <View key={i} style={s.invItem}>
                  <Text style={s.invName}>{item.name}</Text>
                  <Text style={s.invTag}>{item.tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <Text style={{ fontSize: 9, marginTop: 4 }}>{note}</Text>
      )}
    </View>
  );
}

function parseItems(text: string, out: Array<{ name: string; tag: string }>) {
  // "Peppermint syrup (winter rotation), Eggnog base (seasonal)"
  // or line-by-line: "Peppermint syrup | winter rotation"
  const parts = text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*[(\|]\s*(.+?)\s*\)?$/);
    if (m) {
      out.push({ name: m[1].trim(), tag: m[2].trim() });
    } else if (part) {
      out.push({ name: part, tag: '' });
    }
  }
}

function CategoryDividerPage({ label }: { label: string }) {
  return (
    <Page size="LETTER" style={s.dividerPage}>
      <Text style={s.dividerText}>{label}</Text>
    </Page>
  );
}

export async function renderPacketPdfBuffer(sops: Sop[], collection: string | null, transitionNote: string | null): Promise<Buffer> {
  const printable = sops.filter((sop) => sop.sopRequired !== false);
  const drinks = printable.filter((sop) => (sop.kind ?? 'drink') === 'drink');
  const recipes = printable.filter((sop) => sop.kind === 'recipe');

  const byCategory = new Map<string, Sop[]>();
  for (const sop of drinks) {
    const key = sop.category ?? 'uncategorized';
    const arr = byCategory.get(key) ?? [];
    arr.push(sop);
    byCategory.set(key, arr);
  }
  const orderedKeys: string[] = [
    ...SOP_CATEGORIES.map((c) => c.key).filter((k) => byCategory.has(k)),
    ...(byCategory.has('uncategorized') ? ['uncategorized'] : []),
  ];

  const children: React.ReactElement[] = [
    <CoverPage key="cover" sops={sops} collection={collection} transitionNote={transitionNote} />,
  ];
  for (const key of orderedKeys) {
    const cat = SOP_CATEGORIES.find((c) => c.key === key);
    const label = cat ? cat.name : 'Other';
    children.push(<CategoryDividerPage key={`divider-${key}`} label={label} />);
    for (const sop of byCategory.get(key) ?? []) {
      buildSopPages(sop).forEach((p, i) => {
        children.push(React.cloneElement(p, { key: `${sop.slug}-pkt-${i}` }));
      });
    }
  }
  if (recipes.length > 0) {
    children.push(<CategoryDividerPage key="divider-recipes" label="Recipes & Add-Ons" />);
    for (const sop of recipes) {
      buildSopPages(sop).forEach((p, i) => {
        children.push(React.cloneElement(p, { key: `${sop.slug}-pkt-${i}` }));
      });
    }
  }

  return await renderToBuffer(<Document>{children}</Document>);
}
