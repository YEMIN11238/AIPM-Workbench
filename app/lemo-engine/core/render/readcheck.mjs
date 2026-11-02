// Reading-time self-check: node core/render/readcheck.mjs <demo> [--q 'k=v'] [--step 0.04] [--latin-cps 15] [--cjk-cps 4.5] [--pad 1.5] [--min 1.5] [--size 1920x1080]
// Page contract: window.TEXTS(t) → [{id, text, x0, y0, x1, y1}]: every piece of text visible on screen at t seconds and its screen box (pixels, viewport the same as --size, default 1920×1080).
//   id identifies "this block of text" (a number or a string); if the text under the same id changes, it counts as a new piece and timing restarts. Don't report the subtitle bar: its hold is set by the .srt.
//   text must be the block's [complete text] from the first frame it appears: if a typewriter effect reports "the substring typed so far", every extra character is a new piece and the whole check fails —
//   for typewriter text, always report the full text in TEXTS and leave "which characters are shown yet" to the picture itself.
// Rule (same as DIRECTOR.md §7): from the moment a piece of text first fully enters the frame, the time it stays fully in frame continuously, and still in TEXTS, must be ≥
//   (number of hanzi/kana/hangul ÷ cjk-cps + number of other non-whitespace characters ÷ latin-cps) + pad seconds, and no less than min. Defaults 4.5 chars/s (CJK), 15 chars/s (alphanumeric), pad 1.5, min 1.5.
//   Text that never fully enters the frame (cropped at the edge, a ticker running out of frame) is reported as "never fully visible".
// Exit code: 0 all pass; 1 some fail; 2 the check couldn't run (the page has no window.TEXTS, or the whole film never returned any text) — this does not count as a pass.
import { openDemo, closeServer, requireDemo, takeSize } from './page.mjs';
import { scanReadingTime, readingCheckReceipt } from './readcheck-scan.mjs';
const args = process.argv.slice(2), { w: VW, h: VH } = takeSize(args), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args[0]; requireDemo(dir);
const Q = opt('--q', ''), STEP = +opt('--step', 0.04), LATIN = +opt('--latin-cps', 15), CJK = +opt('--cjk-cps', 4.5), PAD = +opt('--pad', 1.5), MIN = +opt('--min', 1.5);
if (![STEP, LATIN, CJK, PAD, MIN].every(Number.isFinite) || STEP <= 0 || LATIN <= 0 || CJK <= 0) { console.error('bad option value (step and the cps values must be > 0)'); process.exit(2); }
const { browser, page } = await openDemo(dir, { w: VW, h: VH, q: Q });
const res = await page.evaluate(scanReadingTime, { STEP });
await browser.close(); closeServer();

const receipt = readingCheckReceipt(res);
if (receipt) console.log('AIPM_READABILITY ' + JSON.stringify(receipt));
if (res.noTexts || res.noDur || (!res.seen.length && !res.partial.length)) {
  console.error('readcheck: NOT CHECKED — ' + (res.noTexts ? 'the page has no window.TEXTS(t) (see the header of core/render/readcheck.mjs for the contract).'
    : res.noDur ? 'window.DUR is not a positive number.'
    : receipt ? 'window.TEXTS is a literal empty-text function; no frames were rendered.'
    : 'window.TEXTS(t) never returned any text over the whole film.') + ' This is not a pass.');
  process.exit(2);
}
const isCJK = ch => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch);
const need = text => { let cjk = 0, other = 0; for (const ch of text) { if (/\s/.test(ch)) continue; isCJK(ch) ? cjk++ : other++; } return Math.max(MIN, cjk / CJK + other / LATIN + PAD); };
let bad = 0;
for (const s of res.seen) {
  const n = need(s.text), ok = s.run >= n - 1e-6; if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${s.id.padEnd(18)} at ${s.t0.toFixed(2)}s  ${String([...s.text].filter(c => !/\s/.test(c)).length).padStart(3)} chars  need ${n.toFixed(2)}s  got ${s.run.toFixed(2)}s  ${JSON.stringify(s.text.slice(0, 24))}`);
}
for (const s of res.partial) { bad++; console.log(`BAD ${s.id.padEnd(18)} at ${s.t0.toFixed(2)}s  never fully visible (its box is outside the frame)  ${JSON.stringify(s.text.slice(0, 24))}`); }
process.exit(bad ? 1 : 0);
