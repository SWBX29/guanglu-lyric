export interface LyricLine {
  time: number; // seconds
  text: string;
}

/** Parse LRC content, supports multiple timestamps per line */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(re)];
    if (!matches.length) continue;
    const text = rawLine.replace(re, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const t = parseInt(m[1]) * 60 + parseFloat(m[2]);
      lines.push({ time: t, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Fallback: plain text lines evenly spaced */
export function plainToLyrics(text: string, duration: number): LyricLine[] {
  const rows = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const step = duration / (rows.length + 1);
  return rows.map((t, i) => ({ time: (i + 1) * step, text: t }));
}
