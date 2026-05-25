import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Sop, SopVariant, Temperature } from '../src/lib/sop-types.js';
import { TEMP_LABEL } from '../src/lib/sop-types.js';

// Palette chosen to feel warm/print-friendly without depending on a
// brand font. If Ben wants to match a specific brand palette later,
// override these three constants.
const COLOR_INK = '#1f1a17';
const COLOR_MUTED = '#5a5048';
const COLOR_RULE = '#d8cfc4';
const COLOR_BAND = '#f3ebe1';
const COLOR_BAND_HOT = '#f4d8c8';
const COLOR_BAND_FROZEN = '#dfeaf2';
const COLOR_BAND_ICED = '#e6efe1';

const BAND_BY_TEMP: Record<Temperature, string> = {
  iced: COLOR_BAND_ICED,
  frozen: COLOR_BAND_FROZEN,
  hot: COLOR_BAND_HOT,
};

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 36, paddingHorizontal: 42, fontSize: 11, color: COLOR_INK, fontFamily: 'Helvetica' },
  title: { fontSize: 26, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 4 },
  tagLine: { fontSize: 10, textAlign: 'center', color: COLOR_MUTED, marginBottom: 2 },
  tempBadge: { marginTop: 14, padding: 6, textAlign: 'center', fontSize: 16, fontFamily: 'Helvetica-Bold', backgroundColor: COLOR_BAND, borderRadius: 4 },
  table: { marginTop: 12, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: COLOR_RULE },
  headerRow: { flexDirection: 'row', backgroundColor: COLOR_BAND, borderBottomWidth: 1, borderColor: COLOR_RULE, minHeight: 22, alignItems: 'center' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: COLOR_RULE, minHeight: 28, alignItems: 'stretch' },
  rowAlt: { backgroundColor: '#fbf9f6' },
  cellName: { flex: 1.4, paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderColor: COLOR_RULE, justifyContent: 'center' },
  cellSize: { flex: 1, paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderColor: COLOR_RULE, justifyContent: 'center' },
  cellSizeLast: { flex: 1, paddingHorizontal: 8, paddingVertical: 5, justifyContent: 'center' },
  headerCellName: { flex: 1.4, paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderColor: COLOR_RULE, fontFamily: 'Helvetica-Bold' },
  headerCellSize: { flex: 1, paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderColor: COLOR_RULE, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  headerCellSizeLast: { flex: 1, paddingHorizontal: 8, paddingVertical: 5, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  rowName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  rowModifier: { fontSize: 9, color: COLOR_MUTED, marginTop: 1 },
  rowCellText: { fontSize: 10, textAlign: 'center' },
  footnotes: { marginTop: 8 },
  footnote: { fontSize: 9, color: COLOR_MUTED, marginTop: 2 },
  assemblyTitle: { marginTop: 14, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bigIdea: { marginTop: 4, fontSize: 10, fontStyle: 'italic', color: COLOR_MUTED },
  assemblyStep: { marginTop: 3, fontSize: 10 },
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
            <Text>{label}</Text>
          </View>
        ))}
      </View>
      {variant.rows.map((row, rIdx) => (
        <View key={rIdx} style={[styles.row, rIdx % 2 === 1 ? styles.rowAlt : null].filter(Boolean) as any}>
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
      {variant.assemblyBigIdea ? <Text style={styles.bigIdea}>Big Idea: {variant.assemblyBigIdea}</Text> : null}
      {(variant.assemblySteps ?? []).map((step, i) => (
        <Text key={i} style={styles.assemblyStep}>{i + 1}. {step}</Text>
      ))}
    </View>
  );
}

function VariantPage({ sop, variant }: { sop: Sop; variant: SopVariant }) {
  return (
    <Page size="LETTER" style={styles.page}>
      <HeaderBlock sop={sop} />
      <View style={[styles.tempBadge, { backgroundColor: BAND_BY_TEMP[variant.temperature] }] as any}>
        <Text>{TEMP_LABEL[variant.temperature]}</Text>
      </View>
      <RecipeTable variant={variant} />
      <FootnotesBlock variant={variant} />
      <AssemblyBlock variant={variant} />
    </Page>
  );
}

export function SopDocument({ sops }: { sops: Sop[] }) {
  return (
    <Document>
      {sops.flatMap((sop) =>
        sop.variants.map((v) => <VariantPage key={`${sop.slug}-${v.temperature}`} sop={sop} variant={v} />)
      )}
    </Document>
  );
}

export async function renderSopsToPdfBuffer(sops: Sop[]): Promise<Buffer> {
  return await renderToBuffer(<SopDocument sops={sops} />);
}
