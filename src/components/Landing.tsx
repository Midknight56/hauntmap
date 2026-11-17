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

export function Landing({ onSample }: { onSample(id: LandingSample): void }) {
  return (
    <main className="landing">
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