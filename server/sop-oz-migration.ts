import type { Database } from 'better-sqlite3';
import { bellsToOz } from '../src/lib/sop-types.js';
import type { SopFootnote } from '../src/lib/sop-types.js';

// One-time migration: convert every 2026-collection SOP from bell
// measurements to ounces (1 small bell = 3 oz, 1 large bell = 5 oz).
// Team decision Aug 2026 — oz is the canonical unit from 2026 onward;
// older collections stay in bells (the "Show oz" toggle covers reading
// them).
//
// Safety rails:
//   - Every changed value's original JSON is copied to
//     sop_oz_migration_backup BEFORE the rewrite, so a revert is a
//     matter of replaying that table.
//   - Runs once, gated by a migration_flags row. Re-boots are no-ops.
//   - Only touches sops whose collection contains "2026".

const FLAG = 'sops-2026-bells-to-oz';

export function migrateSops2026ToOz(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    );
    -- kind: 'row-cells' (ref = sop_rows.id), 'variant-footnotes' or
    -- 'variant-assembly' (ref = sop_variants.id). old_json is the
    -- column value before conversion.
    CREATE TABLE IF NOT EXISTS sop_oz_migration_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      old_json TEXT NOT NULL,
      migrated_at INTEGER NOT NULL
    );
  `);
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;

  const sops = db.prepare(
    "SELECT id, name, collection FROM sops WHERE collection LIKE '%2026%'",
  ).all() as Array<{ id: number; name: string; collection: string }>;

  const backup = db.prepare(
    'INSERT INTO sop_oz_migration_backup (kind, ref_id, old_json, migrated_at) VALUES (?, ?, ?, ?)',
  );
  const updateRowCells = db.prepare('UPDATE sop_rows SET cells_json = ? WHERE id = ?');
  const updateFootnotes = db.prepare('UPDATE sop_variants SET footnotes_json = ? WHERE id = ?');
  const updateAssembly = db.prepare('UPDATE sop_variants SET assembly_steps_json = ? WHERE id = ?');

  const now = Date.now();
  let rowsChanged = 0;
  const sopsTouched = new Set<number>();

  const tx = db.transaction(() => {
    for (const sop of sops) {
      const variants = db.prepare(
        'SELECT id, footnotes_json, assembly_steps_json FROM sop_variants WHERE sop_id = ?',
      ).all(sop.id) as Array<{ id: number; footnotes_json: string; assembly_steps_json: string | null }>;

      for (const v of variants) {
        // Recipe cells.
        const rows = db.prepare(
          'SELECT id, cells_json FROM sop_rows WHERE variant_id = ?',
        ).all(v.id) as Array<{ id: number; cells_json: string }>;
        for (const r of rows) {
          let cells: unknown;
          try { cells = JSON.parse(r.cells_json); } catch { continue; }
          if (!Array.isArray(cells)) continue;
          const converted = cells.map((c) => (typeof c === 'string' ? (bellsToOz(c) ?? c) : c));
          const convertedJson = JSON.stringify(converted);
          if (convertedJson !== JSON.stringify(cells)) {
            backup.run('row-cells', r.id, r.cells_json, now);
            updateRowCells.run(convertedJson, r.id);
            rowsChanged++;
            sopsTouched.add(sop.id);
          }
        }

        // Footnote texts ({marker, text} objects).
        let footnotes: unknown;
        try { footnotes = JSON.parse(v.footnotes_json ?? '[]'); } catch { footnotes = null; }
        if (Array.isArray(footnotes)) {
          const converted = (footnotes as SopFootnote[]).map((f) =>
            f && typeof f === 'object' && typeof f.text === 'string'
              ? { ...f, text: bellsToOz(f.text) ?? f.text }
              : f,
          );
          const convertedJson = JSON.stringify(converted);
          if (convertedJson !== JSON.stringify(footnotes)) {
            backup.run('variant-footnotes', v.id, v.footnotes_json, now);
            updateFootnotes.run(convertedJson, v.id);
            sopsTouched.add(sop.id);
          }
        }

        // Assembly steps (string array). Only measured quantities are
        // converted; prose like "add bell(s) of cold brew" has no
        // number+kind and passes through untouched.
        if (v.assembly_steps_json) {
          let steps: unknown;
          try { steps = JSON.parse(v.assembly_steps_json); } catch { steps = null; }
          if (Array.isArray(steps)) {
            const converted = steps.map((s) => (typeof s === 'string' ? (bellsToOz(s) ?? s) : s));
            const convertedJson = JSON.stringify(converted);
            if (convertedJson !== JSON.stringify(steps)) {
              backup.run('variant-assembly', v.id, v.assembly_steps_json, now);
              updateAssembly.run(convertedJson, v.id);
              sopsTouched.add(sop.id);
            }
          }
        }
      }
    }
    db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, now);
  });
  tx();

  if (sopsTouched.size > 0) {
    console.log(
      `[sop-oz-migration] converted ${rowsChanged} recipe row(s) across ${sopsTouched.size} SOP(s) in 2026 collections to oz (backup in sop_oz_migration_backup)`,
    );
  } else {
    console.log(`[sop-oz-migration] no 2026 bell measurements found to convert (${sops.length} SOPs scanned); flag set`);
  }
}

/** Undo: replay the backup table. Not wired to any route — run it by
 *  hand (or from a one-off script) if the team reverses the decision.
 *  Clears the flag so the migration could run again later. */
export function revertSops2026OzMigration(db: Database) {
  const rows = db.prepare('SELECT kind, ref_id, old_json FROM sop_oz_migration_backup ORDER BY id').all() as
    Array<{ kind: string; ref_id: number; old_json: string }>;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.kind === 'row-cells') db.prepare('UPDATE sop_rows SET cells_json = ? WHERE id = ?').run(r.old_json, r.ref_id);
      else if (r.kind === 'variant-footnotes') db.prepare('UPDATE sop_variants SET footnotes_json = ? WHERE id = ?').run(r.old_json, r.ref_id);
      else if (r.kind === 'variant-assembly') db.prepare('UPDATE sop_variants SET assembly_steps_json = ? WHERE id = ?').run(r.old_json, r.ref_id);
    }
    db.prepare('DELETE FROM sop_oz_migration_backup').run();
    db.prepare('DELETE FROM migration_flags WHERE key = ?').run(FLAG);
  });
  tx();
  console.log(`[sop-oz-migration] reverted ${rows.length} value(s) back to bells`);
}
