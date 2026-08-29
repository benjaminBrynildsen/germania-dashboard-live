// Rasterizes one PDF page to PNG in a throwaway child process, so the
// memory-hungry pdfjs/canvas work (a 24x36 board is a ~40MB bitmap plus
// rendering buffers) never lives inside the long-running server. When this
// process exits, every byte goes back to the OS — and if a render ever blows
// the instance's memory limit, this worker dies instead of the dashboard.
//
// Usage: node png-worker.mjs <pdfPath> <outPath> <page> <scale>
// Exit codes: 0 ok, 3 page out of range, anything else = render failure.
import { pdfToPng } from 'pdf-to-png-converter';
import { readFileSync, writeFileSync } from 'fs';

const [pdfPath, outPath, pageArg, scaleArg] = process.argv.slice(2);
const page = Number(pageArg) || 1;
const scale = Number(scaleArg) || 1.5;

try {
  const pdfBuf = readFileSync(pdfPath);
  const pages = await pdfToPng(pdfBuf, { viewportScale: scale, pagesToProcess: [page] });
  if (pages.length === 0) process.exit(3);
  writeFileSync(outPath, pages[0].content);
  process.exit(0);
} catch (err) {
  console.error('[png-worker]', err instanceof Error ? err.message : err);
  process.exit(1);
}
