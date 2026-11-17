import type { HostLegendEntry } from "./host";

/** The three comparison concepts of the legend, shown while a comparison is active (5.3). */
export const LEGEND_ENTRIES: HostLegendEntry[] = [
  { concept: "Changed source", costume: "amber lamp" },
  { concept: "Removed in the newer snapshot", costume: "ghost outline" },
  { concept: "Added in the newer snapshot", costume: "green doorway" },
];