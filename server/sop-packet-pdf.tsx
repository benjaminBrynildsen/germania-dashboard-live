import React from 'react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';
import type { Sop, Availability } from '../src/lib/sop-types.js';
import { SOP_CATEGORIES } from '../src/lib/sop-types.js';
import { buildSopPages } from './sop-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'public', 'logo.png');
const LOGO_EXISTS = fs.existsSync(LOGO_PATH);

Font.register({
  family: 'Germania One',
  src: path.join(__dirname, 'fonts', 'GermaniaOne-Regular.ttf'),
});

const INK = '#000000';
const SUBTLE = '#3a3a3a';
const FAINT = '#777777';

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 50,
    paddingHorizontal: 60,
    fontSize: 12,
    color: INK,
    fontFamily: 'Helvetica',
  },
  coverHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  coverTitleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  coverTitle: {
    fontSize: 46,
    fontFamily: 'Germania One',
    color: INK,
  },
  coverTitleAccent: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    marginLeft: 14,
    color: INK,
  },
  logoBox: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: { width: 80, height: 80, objectFit: 'contain' },
  transitionLine: {
    textAlign: 'center',
    fontSize: 12,
    fontStyle: 'italic',
    color: SUBTLE,
    marginTop: 16,
    marginBottom: 28,
  },
  sectionHeading: {
    fontSize: 22,
    fontFamily: 'Germania One',
    marginTop: 18,
    marginBottom: 10,
  },
  drinkLine: {
    fontSize: 12,
    marginTop: 4,
    color: INK,
  },
  drinkLineFaint: {
    fontSize: 12,
    marginTop: 4,
    color: FAINT,
    fontStyle: 'italic',
  },
  parensFooter: {
    fontSize: 10,
    fontStyle: 'italic',
    color: FAINT,
    marginTop: 32,
  },

  dividerPage: {
    paddingTop: 60,
    paddingBottom: 60,
    paddingHorizontal: 60,
    color: INK,
    fontFamily: 'Helvetica',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dividerText: {
    fontSize: 64,
    fontFamily: 'Germania One',
    textAlign: 'center',
  },
});

function CoverPage({ sops, collection, transitionNote }: { sops: Sop[]; collection: string | null; transitionNote: string | null }) {
  // Group sops by availability for the three cover sections. Within a
  // section they appear in category order (matches the divider order).
  const grouped: Record<Availability | 'Unspecified', Sop[]> = {
    'All-Season': [],
    '1st Half Only': [],
    '2nd Half Only': [],
    'Unspecified': [],
  };
  for (const s of sops) {
    const key = (s.availability ?? 'Unspecified') as keyof typeof grouped;
    grouped[key].push(s);
  }
  const categoryOrder = new Map(SOP_CATEGORIES.map((c, i) => [c.key, i]));
  const sortByCategory = (a: Sop, b: Sop) => {
    const ai = a.category ? categoryOrder.get(a.category) ?? 99 : 99;
    const bi = b.category ? categoryOrder.get(b.category) ?? 99 : 99;
    return ai - bi || a.name.localeCompare(b.name);
  };
  Object.values(grouped).forEach((list) => list.sort(sortByCategory));

  const sections: Array<{ label: string; items: Sop[] }> = [
    { label: 'All-Season', items: grouped['All-Season'] },
    { label: '1st Half Only', items: grouped['1st Half Only'] },
    { label: '2nd Half Only', items: grouped['2nd Half Only'] },
  ];
  if (grouped['Unspecified'].length > 0) sections.push({ label: 'Other', items: grouped['Unspecified'] });

  // "Sweet - Lemon White Mocha" style line.
  function drinkLine(sop: Sop): string {
    const cat = sop.category ? SOP_CATEGORIES.find((c) => c.key === sop.category) : null;
    const prefix = cat ? `${cat.shortName} - ` : '';
    return `${prefix}${sop.name}`;
  }

  const hasAnyParens = sops.some((s) => s.sopRequired === false);

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.coverHeader}>
        <View style={styles.coverTitleWrap}>
          <Text style={styles.coverTitle}>Calendar</Text>
          {collection ? <Text style={styles.coverTitleAccent}>| {collection}</Text> : null}
        </View>
        {LOGO_EXISTS ? (
          <View style={styles.logoBox}><Image src={LOGO_PATH} style={styles.logoImage} /></View>
        ) : null}
      </View>
      {transitionNote ? <Text style={styles.transitionLine}>{transitionNote}</Text> : null}
      {sections.map((sec) => sec.items.length === 0 ? null : (
        <View key={sec.label}>
          <Text style={styles.sectionHeading}>{sec.label}</Text>
          {sec.items.map((sop) => {
            const line = drinkLine(sop);
            const isFaint = sop.sopRequired === false;
            return (
              <Text key={sop.slug} style={isFaint ? styles.drinkLineFaint : styles.drinkLine}>
                {isFaint ? `(${line})` : line}
              </Text>
            );
          })}
        </View>
      ))}
      {hasAnyParens ? (
        <Text style={styles.parensFooter}>No SOP provided for drinks (in parentheses) because of familiarity.</Text>
      ) : null}
    </Page>
  );
}

function CategoryDividerPage({ label }: { label: string }) {
  return (
    <Page size="LETTER" style={styles.dividerPage}>
      <Text style={styles.dividerText}>{label}</Text>
    </Page>
  );
}

// Compose the launch packet: cover → for each category present →
// divider page + SOPs in that category. SOPs marked sop_required=false
// only appear on the cover (in parens) and don't get a divider/SOP
// page.
export async function renderPacketPdfBuffer(sops: Sop[], collection: string | null, transitionNote: string | null): Promise<Buffer> {
  const printable = sops.filter((s) => s.sopRequired !== false);
  // Group printable sops by category (in canonical category order).
  const byCategory = new Map<string, Sop[]>();
  for (const s of printable) {
    const key = s.category ?? 'uncategorized';
    const arr = byCategory.get(key) ?? [];
    arr.push(s);
    byCategory.set(key, arr);
  }
  // Render category sections in canonical SOP_CATEGORIES order; trailing
  // "uncategorized" if any.
  const orderedKeys: string[] = [
    ...SOP_CATEGORIES.map((c) => c.key).filter((k) => byCategory.has(k)),
    ...(byCategory.has('uncategorized') ? ['uncategorized'] : []),
  ];

  // Build a single Document with: CoverPage, then per-category
  // [divider page + each SOP's pages]. We piggy-back on SopDocument
  // for the SOP pages by rendering its children pages inline.
  // @react-pdf doesn't let us nest Documents, so we render the
  // SopDocument's pages via the same machinery here.
  const packetSops = orderedKeys.flatMap((key) => byCategory.get(key) ?? []);
  // We need to interleave divider pages with SOP pages, so we can't
  // just hand packetSops to SopDocument. Instead we build the children
  // list explicitly.

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

  return await renderToBuffer(<Document>{children}</Document>);
}
