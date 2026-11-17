export const LANDING_SENTENCE =
  "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.";

export type LandingSample = "manor/before" | "annex";

/** The one ghost of the landing page: the shape of the map's ghost (rounded top, three scallops, two eyes), drawn as a vector. */
function Ghost() {
  return (
    <svg className="landing-ghost" viewBox="-30 -30 60 60" width="84" height="84" aria-hidden="true" focusable="false">
      <circle r="28" className="ghost-halo" />
      <circle r="22" className="ghost-halo" />
      <path className="ghost-body" d="M-14 11 L-14 -1 A14 14 0 0 1 14 -1 L14 11 A4.667 4.667 0 0 1 4.667 11 A4.667 4.667 0 0 1 -4.667 11 A4.667 4.667 0 0 1 -14 11 Z" />
      <circle className="ghost-eye" cx="-5" cy="-2" r="2.2" />
      <circle className="ghost-eye" cx="5" cy="-2" r="2.2" />
    </svg>
  );
}

/** The wings of the manor behind the title: x, y, width, height, and how many rooms across and down. */
const WINGS = [
  { x: 120, y: 430, w: 420, h: 290, cols: 3, rows: 2 },
  { x: 600, y: 320, w: 480, h: 420, cols: 4, rows: 3 },
  { x: 1140, y: 410, w: 340, h: 310, cols: 3, rows: 2 },
] as const;

/**
 * A living manor behind the title (design pass 3, item 9): wings and rooms drawn faintly, the windows of some rooms flickering like
 * candles, a candle glow, and one ghost drifting slowly past. It is all drawing: no text, no focus, hidden from assistive technology.
 * The motion is CSS and stops under prefers-reduced-motion and under the Motion toggle (the reduced-motion block of app.css).
 */
function LivingManor() {
  let window = 0;
  return (
    <div className="landing-manor" aria-hidden="true">
      <div className="landing-candle" />
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <path className="manor-passage" d="M540 600 H600 M1080 560 H1140 M330 430 V380 H840 V320 M840 740 V800 H1310 V720" />
        {WINGS.map((w) => {
          const cw = (w.w - 40) / w.cols;
          const ch = (w.h - 70) / w.rows;
          return (
            <g key={w.x}>
              <rect className="manor-wall" x={w.x} y={w.y} width={w.w} height={w.h} rx="4" />
              {Array.from({ length: w.cols * w.rows }, (_, i) => {
                const x = w.x + 20 + (i % w.cols) * cw;
                const y = w.y + 50 + Math.floor(i / w.cols) * ch;
                const lit = (i + w.x) % 3 !== 1;
                const n = window++;
                return (
                  <g key={i}>
                    <rect className="manor-room" x={x + 6} y={y + 6} width={cw - 12} height={ch - 12} rx="3" />
                    {lit ? <rect className="manor-window" x={x + cw / 2 - 7} y={y + ch / 2 - 10} width="14" height="20" rx="2" style={{ animationDelay: `${-((n * 733) % 3400)}ms`, animationDuration: `${3000 + ((n * 411) % 1700)}ms` }} /> : null}
                  </g>
                );
              })}
            </g>
          );
        })}
        <g className="manor-drift">
          <g transform="translate(760 560) scale(2.4)">
            <g className="manor-ghost">
              <circle r="28" className="manor-ghost-halo" />
              <circle r="22" className="manor-ghost-halo" />
              <path className="manor-ghost-body" d="M-14 11 L-14 -1 A14 14 0 0 1 14 -1 L14 11 A4.667 4.667 0 0 1 4.667 11 A4.667 4.667 0 0 1 -4.667 11 A4.667 4.667 0 0 1 -14 11 Z" />
              <circle className="manor-ghost-eye" cx="-5" cy="-2" r="2.2" />
              <circle className="manor-ghost-eye" cx="5" cy="-2" r="2.2" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

export function Landing({ onSample }: { onSample(id: LandingSample): void }) {
  return (
    <main className="landing">
      <LivingManor />
      <Ghost />
      <h1>HauntMap</h1>
      <p>{LANDING_SENTENCE}</p>
      <div className="landing-actions">
        <button type="button" className="primary" onClick={() => onSample("manor/before")}>
          Explore the manor
        </button>
        <button type="button" onClick={() => onSample("annex")}>
          Explore the annex
        </button>
      </div>
    </main>
  );
}