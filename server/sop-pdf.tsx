import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';
import type { Sop, SopVariant, Temperature } from '../src/lib/sop-types.js';
import { TEMP_LABEL } from '../src/lib/sop-types.js';

// Decorative title font. Germania One is a Google Font with a single
// Regular weight — fitting for the drink name only; body stays in
// Helvetica for legibility on the recipe table.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
Font.register({
  family: 'Germania One',
  src: path.join(__dirname, 'fonts', 'GermaniaOne-Regular.ttf'),
});

// Pure black-and-white SOP layout — matches the look of the Word
// templates: clean Arial-style typography, thin rules, no fills.
// Helvetica is react-pdf's closest built-in match to Arial.
const INK = '#000000';
const RULE = '#000000';
const SUBTLE = '#444444';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 56,
    fontSize: 11,
    color: INK,
    fontFamily: 'Helvetica',
  },
  title: {
    fontSize: 34,
    fontFamily: 'Germania One',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  tagLine: {
    fontSize: 10,
    textAlign: 'center',
    color: SUBTLE,
    marginBottom: 1,
  },
  tempBadge: {
    marginTop: 12,
    marginBottom: 6,
    paddingTop: 4,
    paddingBottom: 4,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 4,
    textTransform: 'uppercase',
    borderTopWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: RULE,
  },
  variantSection: {
    // First variant on a combined cold page sits closer to the header;
    // subsequent variants get extra breathing room above their temp label.
  },
  variantSectionGap: {
    marginTop: 10,
  },

  table: {
    marginTop: 2,
    borderTopWidth: 0.75,
    borderLeftWidth: 0.75,
    borderRightWidth: 0.75,
    borderColor: RULE,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderColor: RULE,
    minHeight: 22,
    alignItems: 'stretch',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: RULE,
    minHeight: 24,
    alignItems: 'stretch',
  },
  cellName: {
    flex: 1.6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRightWidth: 0.5,
    borderColor: RULE,
    justifyContent: 'center',
  },
  cellSize: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRightWidth: 0.5,
    borderColor: RULE,
    justifyContent: 'center',
  },
  cellSizeLast: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
  },
  headerCellName: {
    flex: 1.6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRightWidth: 0.5,
    borderColor: RULE,
  },
  headerCellSize: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRightWidth: 0.5,
    borderColor: RULE,
    justifyContent: 'center',
  },
  headerCellSizeLast: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  rowName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  rowModifier: {
    fontSize: 9,
    color: SUBTLE,
    marginTop: 2,
  },
  rowCellText: {
    fontSize: 10.5,
    textAlign: 'center',
    lineHeight: 1.3,
  },

  footnotes: { marginTop: 12 },
  footnote: { fontSize: 9, color: SUBTLE, marginTop: 3, lineHeight: 1.4 },

  assemblyTitle: {
    marginTop: 18,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  assemblyDivider: {
    marginTop: 4,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderColor: RULE,
  },
  bigIdea: {
    fontSize: 10,
    fontFamily: 'Helvetica-Oblique',
    color: SUBTLE,
    marginBottom: 4,
  },
  assemblyStep: { marginTop: 3, fontSize: 10.5, lineHeight: 1.4 },
});

function HeaderBlock({ sop }: { sop: Sop }) {
  const tagLines: string[] = [];
  if (sop.syrupDietaryTags) tagLines.push(`Syrup: ${sop.syrupDietaryTags}`);
  if (sop.drinkContains) tagLines.push(`Drink Contains: ${sop.drinkContains}`);
  if (!sop.syrupDietaryTags && sop.dietaryTags) tagLines.push(sop.dietaryTags);
  if (sop.refrigerationNote) tagLines.push(`Temp: ${sop.refrigerationNote}`);
  return (
    <View>
      <Text style={styles.title}>{sop.name}</Text>
      {tagLines.map((line, i) => (
        <Text key={i} style={styles.tagLine}>{line}</Text>
      ))}
    </View>
  );
}

function RecipeTable({ variant }: { variant: SopVariant }) {
  const sizeCount = variant.sizeLabels.length;
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <View style={styles.headerCellName}><Text> </Text></View>
        {variant.sizeLabels.map((label, i) => (
          <View key={i} style={i === sizeCount - 1 ? styles.headerCellSizeLast : styles.headerCellSize}>
            <Text style={styles.headerLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {variant.rows.map((row, rIdx) => (
        <View key={rIdx} style={styles.row}>
          <View style={styles.cellName}>
            <Text style={styles.rowName}>{row.name}</Text>
            {row.modifier ? <Text style={styles.rowModifier}>{row.modifier}</Text> : null}
          </View>
          {variant.sizeLabels.map((_, cIdx) => {
            const value = row.cells[cIdx] ?? '';
            return (
              <View key={cIdx} style={cIdx === sizeCount - 1 ? styles.cellSizeLast : styles.cellSize}>
                <Text style={styles.rowCellText}>{value}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function FootnotesBlock({ variant }: { variant: SopVariant }) {
  if (!variant.footnotes || variant.footnotes.length === 0) return null;
  return (
    <View style={styles.footnotes}>
      {variant.footnotes.map((fn, i) => (
        <Text key={i} style={styles.footnote}>{fn.marker} {fn.text}</Text>
      ))}
    </View>
  );
}

function AssemblyBlock({ variant }: { variant: SopVariant }) {
  const hasSteps = variant.assemblySteps && variant.assemblySteps.length > 0;
  if (!variant.assemblyBigIdea && !hasSteps) return null;
  return (
    <View>
      <Text style={styles.assemblyTitle}>Drink Assembly</Text>
      <View style={styles.assemblyDivider} />
      {variant.assemblyBigIdea ? <Text style={styles.bigIdea}>Big Idea: {variant.assemblyBigIdea}</Text> : null}
      {(variant.assemblySteps ?? []).map((step, i) => (
        <Text key={i} style={styles.assemblyStep}>{i + 1}. {step}</Text>
      ))}
    </View>
  );
}

function VariantSection({ variant, isFirst }: { variant: SopVariant; isFirst: boolean }) {
  return (
    <View style={isFirst ? styles.variantSection : styles.variantSectionGap}>
      <Text style={styles.tempBadge}>{TEMP_LABEL[variant.temperature]}</Text>
      <RecipeTable variant={variant} />
      <FootnotesBlock variant={variant} />
      <AssemblyBlock variant={variant} />
    </View>
  );
}

function SopPage({ sop, variants }: { sop: Sop; variants: SopVariant[] }) {
  return (
    <Page size="LETTER" style={styles.page}>
      <HeaderBlock sop={sop} />
      {variants.map((v, i) => (
        <VariantSection key={v.temperature} variant={v} isFirst={i === 0} />
      ))}
    </Page>
  );
}

// Group a SOP's variants into print pages. Cold variants (iced and
// frozen) always share a page; hot always lives on its own page.
// Order: cold page first, then hot. Empty pages are skipped — e.g. a
// hot-only drink like the Cortado gets one (hot) page, not an empty
// cold page + hot.
function pagesForSop(sop: Sop): SopVariant[][] {
  const byTemp = new Map<Temperature, SopVariant>();
  for (const v of sop.variants) byTemp.set(v.temperature, v);
  const cold: SopVariant[] = [];
  if (byTemp.has('iced')) cold.push(byTemp.get('iced')!);
  if (byTemp.has('frozen')) cold.push(byTemp.get('frozen')!);
  const hot = byTemp.has('hot') ? [byTemp.get('hot')!] : [];
  const pages: SopVariant[][] = [];
  if (cold.length > 0) pages.push(cold);
  if (hot.length > 0) pages.push(hot);
  return pages;
}

// Exported for the packet renderer so it can splice these pages in
// between cover and category dividers without re-implementing the
// cold/hot grouping rule.
export function buildSopPages(sop: Sop): React.ReactElement[] {
  return pagesForSop(sop).map((pageVariants, pi) => (
    <SopPage key={`${sop.slug}-page-${pi}`} sop={sop} variants={pageVariants} />
  ));
}

export function SopDocument({ sops }: { sops: Sop[] }) {
  return (
    <Document>
      {sops.flatMap((sop) => buildSopPages(sop))}
    </Document>
  );
}

export async function renderSopsToPdfBuffer(sops: Sop[]): Promise<Buffer> {
  return await renderToBuffer(<SopDocument sops={sops} />);
}
