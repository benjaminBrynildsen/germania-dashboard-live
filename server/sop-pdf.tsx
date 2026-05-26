import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';
import type { Sop, SopVariant, Temperature } from '../src/lib/sop-types.js';
import { SOP_CATEGORIES, parseCollectionSeasons } from '../src/lib/sop-types.js';

// Crafted SOP layout. Cream paper, monospace labels + values, big bold
// title, top-right 3-row meta box, black section banner with a "G" mark
// and step count, numbered recipe table with black header.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, 'fonts');

Font.register({ family: 'Germania One', src: path.join(FONT_DIR, 'GermaniaOne-Regular.ttf') });
Font.register({ family: 'IBM Plex Sans', fonts: [{ src: path.join(FONT_DIR, 'IBMPlexSans-Bold.ttf'), fontWeight: 700 }] });
Font.register({ family: 'IBM Plex Mono', fonts: [
  { src: path.join(FONT_DIR, 'IBMPlexMono-Regular.ttf'), fontWeight: 400 },
  { src: path.join(FONT_DIR, 'IBMPlexMono-Bold.ttf'), fontWeight: 700 },
] });

// Default react-pdf hyphenates long words (e.g. "Origin" → "Ori-/gin")
// at line breaks. Disable so the drink title and component names stay
// intact and the layout just shrinks the title font when needed.
Font.registerHyphenationCallback((word) => [word]);

const INK = '#101010';
const PAPER = '#ffffff';
const PAPER_CUT = '#f5f5f5';
const RULE = '#101010';
const MUTED = '#8e8e8e';
const STEP_MUTED = '#bdbdbd';

const SANS = 'IBM Plex Sans';
const MONO = 'IBM Plex Mono';

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 38,
    fontSize: 10,
    color: INK,
    fontFamily: MONO,
    backgroundColor: PAPER,
  },

  // ── header row ──────────────────────────────────────────────
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerLeft: { flex: 1, paddingRight: 14 },
  eyebrow: { fontSize: 8.5, fontFamily: MONO, letterSpacing: 1.6, color: INK },
  title: { fontFamily: SANS, fontWeight: 700, letterSpacing: -2, lineHeight: 1, marginTop: 4, marginBottom: 8, color: INK },
  craftedBy: { fontSize: 8.5, fontFamily: MONO, letterSpacing: 1.6, color: INK, textTransform: 'uppercase' },

  // ── meta box top-right ──────────────────────────────────────
  metaBox: { borderWidth: 1, borderColor: INK, width: 200 },
  metaRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: INK, minHeight: 22, alignItems: 'stretch' },
  metaRowLast: { flexDirection: 'row', minHeight: 22, alignItems: 'stretch' },
  metaLabel: { width: 60, backgroundColor: INK, color: PAPER, paddingHorizontal: 8, paddingVertical: 6, fontSize: 8, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.2 },
  metaValue: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, fontSize: 9.5, fontFamily: MONO, color: INK, alignSelf: 'center' },

  // ── section banner ───────────────────────────────────────────
  divider: { borderBottomWidth: 1, borderColor: INK, marginTop: 14 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 6 },
  sectionMark: { width: 34, height: 34, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  sectionMarkText: { fontFamily: 'Germania One', fontSize: 22, color: PAPER },
  sectionLabel: { fontSize: 26, fontFamily: SANS, fontWeight: 700, letterSpacing: 1.4, color: INK, textTransform: 'uppercase' },
  sectionRule: { flex: 1, marginHorizontal: 16, height: 1, backgroundColor: MUTED, alignSelf: 'center' },
  sectionSteps: { fontSize: 9, fontFamily: MONO, letterSpacing: 1.4, color: INK },

  // ── recipe table ─────────────────────────────────────────────
  table: { borderWidth: 1, borderColor: INK, marginTop: 4 },
  thead: { flexDirection: 'row', backgroundColor: INK, minHeight: 30, alignItems: 'stretch' },
  thHash: { width: 54, backgroundColor: STEP_MUTED, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: INK },
  thHashText: { fontFamily: MONO, fontSize: 13, color: INK },
  thName: { flex: 2.2, paddingHorizontal: 12, justifyContent: 'center', borderRightWidth: 1, borderColor: PAPER },
  thNameText: { fontFamily: MONO, fontSize: 10, color: PAPER, letterSpacing: 1.6 },
  thSize: { flex: 1, paddingHorizontal: 8, justifyContent: 'center', borderRightWidth: 1, borderColor: PAPER, alignItems: 'center' },
  thSizeLast: { flex: 1, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  thSizeText: { fontFamily: MONO, fontSize: 10, color: PAPER, letterSpacing: 1.6 },

  tr: { flexDirection: 'row', borderTopWidth: 1, borderColor: INK, minHeight: 56, alignItems: 'stretch', backgroundColor: PAPER },
  tdStep: { width: 54, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: INK },
  tdStepText: { fontFamily: MONO, fontSize: 14, color: STEP_MUTED, letterSpacing: 0.5 },
  tdName: { flex: 2.2, paddingHorizontal: 14, justifyContent: 'center', borderRightWidth: 1, borderColor: INK },
  tdNameText: { fontFamily: SANS, fontWeight: 700, fontSize: 17, color: INK, lineHeight: 1.15 },
  tdNameModifier: { fontFamily: MONO, fontSize: 9, color: MUTED, marginTop: 4, letterSpacing: 0.6 },
  tdSize: { flex: 1, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1, borderColor: INK },
  tdSizeLast: { flex: 1, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  tdSizeText: { fontFamily: MONO, fontSize: 17, color: INK, textAlign: 'center', lineHeight: 1.15 },

  // ── footer / extras ──────────────────────────────────────────
  footnotes: { marginTop: 10 },
  footnote: { fontSize: 8.5, fontFamily: MONO, color: MUTED, marginTop: 2, letterSpacing: 0.4 },
  assemblyTitle: { marginTop: 16, fontSize: 10, fontFamily: SANS, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase' },
  assemblyRule: { marginTop: 4, marginBottom: 6, height: 1, backgroundColor: INK },
  bigIdea: { fontSize: 9, fontFamily: MONO, color: MUTED, marginBottom: 4 },
  assemblyStep: { marginTop: 3, fontSize: 10, fontFamily: MONO },
  availabilityNote: { marginTop: 8, fontSize: 9.5, fontFamily: MONO, fontWeight: 700, textAlign: 'center', color: INK, letterSpacing: 0.6 },
  subtitle: { fontSize: 11, fontFamily: SANS, fontWeight: 700, color: INK, marginBottom: 6, marginTop: -4 },
});

const TEMP_SECTION_LABEL: Record<Temperature, string> = {
  iced: 'ICED BUILD',
  frozen: 'FROZEN BUILD',
  hot: 'HOT BUILD',
};

function dietLine(sop: Sop): string {
  // Crunch the dietary fields into one short "DF · GF · VG" line.
  const tokens: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    for (const t of s.split(',').map((x) => x.trim()).filter(Boolean)) {
      // Normalize so the line stays compact: Vegan → VG, Vegetarian → VEG.
      let norm = t.toUpperCase();
      if (/^vegan$/i.test(t)) norm = 'VG';
      else if (/^vegetarian$/i.test(t)) norm = 'VEG';
      if (!tokens.includes(norm)) tokens.push(norm);
    }
  };
  push(sop.dietaryTags);
  push(sop.syrupDietaryTags);
  return tokens.join(' · ');
}

// Scale the giant drink title down as names get longer so they don't
// blow the column width or wrap into 3 lines. Tuned against the title
// column (~322pt wide) and IBM Plex Sans Bold metrics.
function titleFontSize(name: string): number {
  const len = (name || '').length;
  if (len <= 11) return 72;
  if (len <= 14) return 60;
  if (len <= 18) return 52;
  if (len <= 22) return 44;
  if (len <= 26) return 38;
  return 34;
}

function storeLine(sop: Sop): string {
  return sop.refrigerationNote ? sop.refrigerationNote.toUpperCase() : '—';
}

function pumpsLine(sop: Sop): string {
  return sop.pumpsNote && sop.pumpsNote.trim() ? sop.pumpsNote.toUpperCase() : 'STANDARD';
}

function eyebrowText(sop: Sop): string {
  const cat = sop.category ? SOP_CATEGORIES.find((c) => c.key === sop.category) : null;
  const catLabel = cat ? cat.name.toUpperCase() : (sop.kind === 'recipe' ? 'RECIPE' : 'SOP');
  const version = `Version ${sop.version ?? 1}`;
  const yr = parseCollectionSeasons(sop.collection || '')?.year ?? new Date().getFullYear();
  return `${catLabel} · ${version} · ${yr}`;
}

function craftedByText(sop: Sop): string {
  const who = sop.craftedBy && sop.craftedBy.trim() ? sop.craftedBy.trim() : 'THE MENU TEAM';
  return `CRAFTED BY ${who.toUpperCase()}`;
}

function HeaderBlock({ sop }: { sop: Sop }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <Text style={styles.eyebrow}>{eyebrowText(sop)}</Text>
        <Text style={[styles.title, { fontSize: titleFontSize(sop.name) }]}>{sop.name}</Text>
        {sop.subtitle ? <Text style={styles.subtitle}>{sop.subtitle}</Text> : null}
        <Text style={styles.craftedBy}>{craftedByText(sop)}</Text>
      </View>
      <View style={styles.metaBox}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>DIET</Text>
          <Text style={styles.metaValue}>{dietLine(sop) || '—'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>STORE</Text>
          <Text style={styles.metaValue}>{storeLine(sop)}</Text>
        </View>
        <View style={styles.metaRowLast}>
          <Text style={styles.metaLabel}>PUMPS</Text>
          <Text style={styles.metaValue}>{pumpsLine(sop)}</Text>
        </View>
      </View>
    </View>
  );
}

function SectionBanner({ label, steps }: { label: string; steps: number }) {
  return (
    <View>
      <View style={styles.divider} />
      <View style={styles.sectionRow}>
        <View style={styles.sectionMark}><Text style={styles.sectionMarkText}>G</Text></View>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.sectionRule} />
        <Text style={styles.sectionSteps}>{steps} STEPS</Text>
      </View>
    </View>
  );
}

function RecipeTable({ variant }: { variant: SopVariant }) {
  const sizeCount = variant.sizeLabels.length;
  return (
    <View style={styles.table}>
      <View style={styles.thead}>
        <View style={styles.thHash}><Text style={styles.thHashText}>#</Text></View>
        <View style={styles.thName}><Text style={styles.thNameText}>COMPONENT</Text></View>
        {variant.sizeLabels.map((label, i) => (
          <View key={i} style={i === sizeCount - 1 ? styles.thSizeLast : styles.thSize}>
            <Text style={styles.thSizeText}>{(label || '').toUpperCase()}</Text>
          </View>
        ))}
      </View>
      {variant.rows.map((row, rIdx) => (
        <View key={rIdx} style={styles.tr}>
          <View style={styles.tdStep}><Text style={styles.tdStepText}>{String(rIdx + 1).padStart(2, '0')}</Text></View>
          <View style={styles.tdName}>
            <Text style={styles.tdNameText}>{row.name}</Text>
            {row.modifier ? <Text style={styles.tdNameModifier}>{row.modifier.toUpperCase()}</Text> : null}
          </View>
          {variant.sizeLabels.map((_, cIdx) => (
            <View key={cIdx} style={cIdx === sizeCount - 1 ? styles.tdSizeLast : styles.tdSize}>
              <Text style={styles.tdSizeText}>{row.cells[cIdx] ?? ''}</Text>
            </View>
          ))}
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
      <View style={styles.assemblyRule} />
      {variant.assemblyBigIdea ? <Text style={styles.bigIdea}>Big Idea: {variant.assemblyBigIdea}</Text> : null}
      {(variant.assemblySteps ?? []).map((step, i) => (
        <Text key={i} style={styles.assemblyStep}>{i + 1}. {step}</Text>
      ))}
    </View>
  );
}

function VariantPage({ sop, variant }: { sop: Sop; variant: SopVariant }) {
  const label = sop.kind === 'recipe' ? 'RECIPE' : TEMP_SECTION_LABEL[variant.temperature];
  return (
    <Page size="LETTER" style={styles.page}>
      <HeaderBlock sop={sop} />
      <SectionBanner label={label} steps={variant.rows.length} />
      {sop.availabilityNote ? <Text style={styles.availabilityNote}>{sop.availabilityNote}</Text> : null}
      <RecipeTable variant={variant} />
      <FootnotesBlock variant={variant} />
      <AssemblyBlock variant={variant} />
    </Page>
  );
}

// Crafted layout puts each variant on its own page (matches the
// designed Iced / Frozen / Hot screenshots) so the header card is
// fully visible above every recipe table.
export function buildSopPages(sop: Sop): React.ReactElement[] {
  return sop.variants.map((v) => (
    <VariantPage key={`${sop.slug}-${v.temperature}`} sop={sop} variant={v} />
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
