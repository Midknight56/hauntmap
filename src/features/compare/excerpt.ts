// The source excerpt of an occurrence: its line with two lines before and after, one-based. Written here
// because this feature imports nothing from `src/components/**` (10.6).

export interface ExcerptLine {
  line: number;
  text: string;
}

/** Empty when `line` is outside the text. A trailing line break does not start a line of its own. */
export function excerptLines(text: string, line: number): ExcerptLine[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return [];
  const out: ExcerptLine[] = [];
  for (let n = Math.max(1, line - 2); n <= Math.min(lines.length, line + 2); n++) out.push({ line: n, text: lines[n - 1] ?? "" });
  return out;
}
