// Parses a Google Doc's text representation into our SOP schema shape.
// Input: { title, content } from Drive's read_file_content (where
// content is a Markdown-ish dump with pipe tables). Output: SOP-shaped
// JSON ready for POST /api/sops.
//
// The doc format Germania uses:
//   1) Drink name on its own line at the top
//   2) Single-cell pipe table with dietary tags + "Temp: ..." line
//   3) Variant blocks, each = a temperature label line ("Iced"/"Frozen"/
//      "Hot"/"Iced Only"/etc.) followed by a pipe table whose first row
//      is size labels (Kids/R/L or S/R/L or a single cell) and the
//      remaining rows are ingredient (or modifier) rows.
//   4) Header (drink name + tags + refrig) may repeat between variants;
//      we de-dupe.

const TEMP_REGEX = /^(Iced(?:\s+Only)?|Frozen|Hot)\s*$/i;

function stripBold(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\\\*\\\*/g, '').replace(/\*\*/g, '').replace(/\\\*/g, '*').trim();
}

function unescape(s) {
  return stripBold(s)
    .replace(/\\&/g, '&')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']');
}

// Split the doc into an array of "lines" but keep markdown table rows
// intact (no trimming away the |s).
function tokenize(content) {
  const lines = content.split(/\r?\n/);
  return lines.map((l) => l.replace(/\s+$/, ''));
}

// A "table" is a contiguous block of lines that start with |, EXCLUDING
// alignment rows like `| :-: | :-: |`.
function collectTables(lines) {
  const tables = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().startsWith('|')) {
      if (cur === null) cur = { startIdx: i, rows: [] };
      // Skip alignment row (e.g. `| :-: | :-: |`)
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|/.test(l.trim())) continue;
      const cells = l.split('|').slice(1, -1).map((c) => unescape(c));
      // Drop markdown's empty placeholder header rows; only actual
      // content rows make it in.
      if (cells.every((c) => !c || !c.trim())) continue;
      cur.rows.push(cells);
    } else {
      if (cur) { cur.endIdx = i; tables.push(cur); cur = null; }
    }
  }
  if (cur) { cur.endIdx = lines.length; tables.push(cur); }
  return tables;
}

function normTemp(label) {
  const t = label.toLowerCase().replace(/\s+only/i, '').trim();
  if (t === 'iced') return 'iced';
  if (t === 'frozen') return 'frozen';
  if (t === 'hot') return 'hot';
  return null;
}

function parseHeader(headerCellText) {
  // headerCellText might look like "DF, GF Temp: Room Temp" or
  // "Syrup: DF, GF, Vegan Drink Contains: Dairy, Soy Temp: Needs refrigeration"
  const text = headerCellText.replace(/\s+/g, ' ').trim();
  const out = { dietaryTags: null, syrupDietaryTags: null, drinkContains: null, refrigerationNote: null };

  // Pull out "Temp:" first
  const tempMatch = text.match(/Temp:\s*(.+?)$/i);
  let rest = text;
  if (tempMatch) {
    out.refrigerationNote = tempMatch[1].trim();
    rest = text.slice(0, tempMatch.index).trim();
  }
  // Pull "Syrup:" segment
  const syrupMatch = rest.match(/Syrup:\s*([^A-Z][^.]*?)(?=Drink Contains:|Contains:|$)/i);
  if (syrupMatch) {
    out.syrupDietaryTags = syrupMatch[1].trim().replace(/[.;]$/, '');
    rest = rest.replace(syrupMatch[0], '').trim();
  }
  // Pull "Drink Contains:" or "Contains:" segment
  const containsMatch = rest.match(/(?:Drink )?Contains:\s*(.+?)$/i);
  if (containsMatch) {
    out.drinkContains = containsMatch[1].trim().replace(/[.;]$/, '');
    rest = rest.replace(containsMatch[0], '').trim();
  }
  // Whatever's left is the dietary tags line (if not already captured by syrup)
  if (rest && !out.syrupDietaryTags) {
    out.dietaryTags = rest.replace(/[.;]$/, '');
  }
  return out;
}

export function parseSopDoc(title, content) {
  const lines = tokenize(content);
  // Drink name = first non-empty line.
  const nameLine = lines.find((l) => l.trim().length > 0) || title;
  const drinkName = nameLine.trim();

  const tables = collectTables(lines);
  if (tables.length === 0) {
    return { name: drinkName, variants: [], note: 'no_tables_found' };
  }

  // Decide whether tables[0] is the dietary/temp header box (single
  // column → it is) or jumps straight into a recipe table (multi-column
  // → no separate header; we'll start the recipe loop at index 0).
  const firstIsHeaderBox = (tables[0].rows[0]?.length ?? 0) < 2;
  let headerFields = { dietaryTags: null, syrupDietaryTags: null, drinkContains: null, refrigerationNote: null };
  let recipeStart = 0;
  if (firstIsHeaderBox) {
    const headerText = tables[0].rows.map((r) => r.join(' ').trim()).filter(Boolean).join(' ');
    headerFields = parseHeader(headerText);
    recipeStart = 1;
  }

  // For each recipe table, walk backwards from its startIdx until we
  // find a non-empty line; that's the temperature label.
  const variantsByTemp = new Map();
  for (let i = recipeStart; i < tables.length; i++) {
    const tbl = tables[i];
    // Skip dietary/temp header reprints (single-column boxes that
    // appear before each variant's actual recipe table on multi-page
    // SOPs).
    if (tbl.rows.length === 0 || tbl.rows[0].length < 2) continue;
    // Walk up to find the temp label
    let temp = null;
    for (let li = tbl.startIdx - 1; li >= 0; li--) {
      const l = lines[li].trim();
      if (!l) continue;
      const m = l.match(TEMP_REGEX);
      if (m) { temp = normTemp(m[1]); break; }
      // Skip drink name re-headers and pipe table bits
      if (l.startsWith('|') || l === drinkName) continue;
      // Otherwise — not a temp marker, treat as no-match.
      break;
    }
    // No temp marker — fall back to 'hot' as a placeholder so the
    // variant still imports. Common for non-drink recipes (cold foam,
    // syrup batches) which don't have iced/frozen/hot at all.
    if (!temp) temp = 'hot';

    // tbl.rows: first row is size header (cell 0 empty, cells 1..n are
    // size labels). Subsequent rows are ingredient rows (cell 0 = name,
    // cells 1..n = per-size quantities).
    if (tbl.rows.length === 0) continue;
    const sizeHeader = tbl.rows[0];
    const sizeLabels = sizeHeader.slice(1).filter((c) => c && c.trim().length > 0).map((c) => c.trim());
    const recipeRows = tbl.rows.slice(1);

    const rowsOut = [];
    const footnotes = [];
    for (const r of recipeRows) {
      if (!r || r.length === 0) continue;
      // Footnote rows usually have content only in the first cell and
      // start with "*" or "* -".
      const firstCell = (r[0] || '').trim();
      const restEmpty = r.slice(1).every((c) => !c || !c.trim());
      if (firstCell.startsWith('*') && restEmpty) {
        const fnMatch = firstCell.match(/^(\*+(?:[-=])?)\s*-?\s*(.+)$/);
        if (fnMatch) footnotes.push({ marker: fnMatch[1], text: fnMatch[2].trim() });
        continue;
      }
      if (!firstCell) continue;
      // The ingredient name may contain a parenthetical modifier "(Extra Pump)"
      // either inline or on a second logical line. We try inline first.
      let name = firstCell;
      let modifier = null;
      const modMatch = name.match(/^(.+?)\s*(\([^)]+\))\s*$/);
      if (modMatch) { name = modMatch[1].trim(); modifier = modMatch[2].trim(); }
      const cells = [];
      for (let i = 0; i < sizeLabels.length; i++) cells.push((r[i + 1] ?? '').trim());
      rowsOut.push({ name, modifier, cells });
    }

    // If this temp already exists (e.g. ALL doc with repeated variants), keep
    // the latest definition — last one wins (closer to author intent).
    variantsByTemp.set(temp, {
      temperature: temp,
      position: temp === 'iced' ? 0 : temp === 'frozen' ? 1 : 2,
      sizeLabels,
      footnotes,
      rows: rowsOut,
    });
  }

  return {
    name: drinkName,
    dietaryTags: headerFields.dietaryTags,
    syrupDietaryTags: headerFields.syrupDietaryTags,
    drinkContains: headerFields.drinkContains,
    refrigerationNote: headerFields.refrigerationNote,
    variants: Array.from(variantsByTemp.values()).sort((a, b) => a.position - b.position),
  };
}

// CLI helper: feed it { title, content } JSON via stdin, get the parsed SOP back.
if (process.argv[1] && process.argv[1].endsWith('parse-sop-doc.mjs')) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    const { title, content } = JSON.parse(raw);
    const parsed = parseSopDoc(title, content);
    process.stdout.write(JSON.stringify(parsed, null, 2));
  });
}
