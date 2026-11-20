import { LANDING_LOCAL } from "../features/import/messages";
import type { IntakeKind } from "../features/import/types";

export const LANDING_SENTENCE =
  "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.";

export type LandingSample = "manor/before" | "annex";

/**
 * The moon, the fog and the bats behind the title (halloween detail pass): all drawing, no text. The moon stands behind the wings (it is
 * drawn first), the fog drifts low over the floor, and a few bats cross the top of the page now and then. Where each bat rests when
 * nothing moves is `--bat-x`; the bats stay in the band above the title, so that they never cross a word.
 */
const BATS = [
  { x: 300, y: 70, delay: -3000 },
  { x: 900, y: 110, delay: -12000 },
  { x: 1380, y: 80, delay: -20000 },
] as const;

/** The wisps of fog low over the floor: the height of each, and how far into its drift it starts. */
const FOG = [
  { y: 830, delay: -9000 },
  { y: 720, delay: -31000 },
  { y: 610, delay: -52000 },
] as const;

function BatShape() {
  return (
    <g transform="scale(2.1)">
      <g className="landing-bat-wings">
        <path className="landing-bat-body" d="M0 0 C-3 -5 -8 -5 -9.5 -1 L-7.2 0.5 L-5.2 -0.5 L-3.2 1.6 L-1.4 0.6 Z M0 0 C3 -5 8 -5 9.5 -1 L7.2 0.5 L5.2 -0.5 L3.2 1.6 L1.4 0.6 Z" />
      </g>
      <ellipse className="landing-bat-body" cx="0" cy="0.6" rx="1.5" ry="2.6" />
    </g>
  );
}

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
        <defs>
          <radialGradient id="landing-moon-halo">
            <stop offset="0" style={{ stopColor: "var(--ink)", stopOpacity: 0.16 }} />
            <stop offset="1" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id="landing-fog-wisp">
            <stop offset="0" style={{ stopColor: "var(--passage)", stopOpacity: 0.08 }} />
            <stop offset="1" style={{ stopColor: "var(--passage)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <g className="landing-moon" transform="translate(1210 160)">
          <circle r="130" fill="url(#landing-moon-halo)" />
          <circle className="moon-disc" r="52" />
          <circle className="moon-crater" cx="-17" cy="-12" r="9" />
          <circle className="moon-crater" cx="14" cy="10" r="12" />
          <circle className="moon-crater" cx="-4" cy="26" r="5" />
          <circle className="moon-crater" cx="22" cy="-20" r="4" />
        </g>
        {FOG.map((f, i) => (
          <g key={i} className="landing-fog" style={{ animationDelay: `${f.delay}ms` }}>
            <ellipse cx="-560" cy={f.y} rx="560" ry="110" fill="url(#landing-fog-wisp)" />
          </g>
        ))}
        {BATS.map((b, i) => (
          <g key={i} transform={`translate(0 ${b.y})`}>
            <g className="landing-bat" style={{ ["--bat-x" as string]: `${b.x}px`, animationDelay: `${b.delay}ms` }}>
              <BatShape />
            </g>
          </g>
        ))}
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

export function Landing({
  onSample,
  intakeKinds = [],
  onIntake,
}: {
  onSample(id: LandingSample): void;
  /** The intake routes that are wired. Empty or absent: only the two sample buttons are shown. */
  intakeKinds?: readonly IntakeKind[];
  onIntake?(kind: IntakeKind): void;
}) {
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
        {intakeKinds.includes("local") ? (
          <button type="button" onClick={() => onIntake?.("local")}>
            {LANDING_LOCAL}
          </button>
        ) : null}
      </div>
    </main>
  );
}