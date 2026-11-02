// Self-contained browser callback: Puppeteer serializes this function.
export async function scanReadingTime({ STEP }) {
  if (typeof window.TEXTS !== 'function') return { noTexts: true };
  if (!(window.DUR > 0)) return { noDur: true };
  // Only syntax with an unconditional, literal empty array can skip rendering.
  // Do not infer an entire film's text from a sample or a broad source pattern.
  const source = Function.prototype.toString.call(window.TEXTS).replace(/\s/g, '');
  const emptyLiterals = [
    '()=>[]', '()=>{return[]}', '()=>{return[];}',
    'function(){return[]}', 'function(){return[];}',
  ];
  if (emptyLiterals.includes(source)) return { seen: [], partial: [], literalEmpty: true, renderedFrames: 0 };
  const W = innerWidth, H = innerHeight, seen = {}, partial = {};
  for (let t = 0; t <= window.DUR; t += STEP) {
    await window.render(t);
    const vis = new Set();
    for (const b of window.TEXTS(t) || []) {
      b.id = String(b.id);
      const key = b.id + '\u0000' + b.text;
      if (!(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H)) {
        partial[key] ??= { id: b.id, text: b.text, t0: t };
        continue;
      }
      vis.add(key);
      const s = seen[key] ??= { id: b.id, text: b.text, t0: t, run: 0, done: false };
      if (!s.done) s.run = Math.min(t + STEP, window.DUR) - s.t0;
    }
    for (const k in seen) if (!vis.has(k)) seen[k].done = true;
  }
  for (const k in partial) if (seen[k]) delete partial[k];
  return { seen: Object.values(seen), partial: Object.values(partial) };
}

export function readingCheckReceipt(result) {
  if (result?.literalEmpty !== true || result.renderedFrames !== 0
      || result.seen?.length !== 0 || result.partial?.length !== 0) return null;
  return { status: 'not_applicable', reason: 'literal-empty-text-function', renderedFrames: 0 };
}
