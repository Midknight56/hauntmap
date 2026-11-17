import { useId, type ReactElement } from "react";

export const NO_SOURCE_TEXT = "Source not included in this snapshot; evidence is path, line and specifier.";

export interface ExcerptLine {
  line: number;
  text: string;
}

/** The source line with two lines before and after, one-based. Empty when `line` is outside the text. */
export function excerpt(text: string, line: number): ExcerptLine[] {
  const lines = text.split(/\r\n|\r|\n/);
  // A trailing line break does not start a line of its own.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return [];
  const first = Math.max(1, line - 2);
  const last = Math.min(lines.length, line + 2);
  const out: ExcerptLine[] = [];
  for (let n = first; n <= last; n++) out.push({ line: n, text: lines[n - 1] ?? "" });
  return out;
}

interface Props {
  /** The source text of the module, or null when the investigation has none. */
  text: string | null | undefined;
  line: number;
  /** False for a snapshot that carries no source text at all. */
  hasSource: boolean;
}

export function SourceExcerpt({ text, line, hasSource }: Props): ReactElement {
  const headingId = useId();
  let body: ReactElement;
  if (!hasSource) {
    body = <p>{NO_SOURCE_TEXT}</p>;
  } else {
    const lines = text === undefined || text === null ? [] : excerpt(text, line);
    body =
      lines.length === 0 ? (
        <p>{`Line ${line} is not in the current source text.`}</p>
      ) : (
        <ol className="excerpt-lines" aria-label="Source lines">
          {lines.map((l) => (
            <li key={l.line} aria-current={l.line === line ? "true" : undefined}>
              <pre>{`${l.line} ${l.text}`}</pre>
            </li>
          ))}
        </ol>
      );
  }
  return (
    <section aria-labelledby={headingId} className="excerpt">
      <h3 id={headingId}>Source excerpt</h3>
      {body}
    </section>
  );
}