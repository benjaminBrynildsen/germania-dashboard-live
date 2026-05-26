// Reads /tmp/sop-import-raw.json (array of fetched Drive docs), runs
// each through parse-sop-doc.mjs, and emits /tmp/sop-import-parsed.json
// ready for POST /api/sops/bulk-import.

import fs from 'node:fs';
import { parseSopDoc } from './parse-sop-doc.mjs';

const raw = JSON.parse(fs.readFileSync('/tmp/sop-import-raw.json', 'utf8'));

const parsed = raw.map((r) => {
  const sop = parseSopDoc(r.title, r.content);
  // Tag with collection per the user's rule: folder season + filename year.
  const collection = r.seasonFolder && r.year ? `${r.seasonFolder} ${r.year}` : null;
  return {
    name: sop.name,
    kind: r.kind || 'drink',
    collection,
    dietaryTags: sop.dietaryTags,
    syrupDietaryTags: sop.syrupDietaryTags,
    drinkContains: sop.drinkContains,
    refrigerationNote: sop.refrigerationNote,
    subtitle: r.subtitle ?? null,
    variants: sop.variants,
    // Audit fields — useful for debugging, server ignores.
    _sourceFileId: r.fileId,
    _sourceTitle: r.title,
  };
});

fs.writeFileSync('/tmp/sop-import-parsed.json', JSON.stringify(parsed, null, 2));

// Brief stdout summary
console.log(`Parsed ${parsed.length} SOPs`);
for (const p of parsed) {
  const temps = p.variants.map((v) => `${v.temperature}(${v.rows.length})`).join(', ');
  console.log(`  ${p.name.padEnd(35)} kind=${p.kind} collection=${(p.collection || '—').padEnd(14)} ${temps}`);
  if (p.variants.length === 0) console.log(`    ⚠ no variants parsed`);
}
