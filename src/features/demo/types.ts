// State of the investigation steps panel (requirement 8). Task 11 adds the completion rules beside it.

export type DemoStepId = "follow" | "loop" | "compare";

export interface DemoStepState {
  version: 1;
  steps: { id: DemoStepId; status: "todo" | "done" | "skipped" }[];
  dismissed: boolean;
}
