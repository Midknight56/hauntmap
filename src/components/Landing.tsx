export const LANDING_SENTENCE =
  "Find how the modules of a JavaScript or TypeScript project import each other: rooms are files, doors are imports, and a corridor that returns to its start is a dependency cycle.";

export type LandingSample = "manor/before" | "annex";

export function Landing({ onSample }: { onSample(id: LandingSample): void }) {
  return (
    <main className="landing">
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