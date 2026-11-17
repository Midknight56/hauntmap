import { Component, createRef, type ReactNode } from "react";
import { forcedCrashHandled } from "./devHook";

export const ERROR_BOUNDARY_TEXT = "Something went wrong drawing the map. Your investigation is still loaded.";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  /** Bumped by `Reload view` so that the children mount afresh. */
  attempt: number;
}

/**
 * Catches a render error in the investigation screen. The store lives outside it, so the
 * investigation survives. Only the error name and stack reach the console: a message can carry a path.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };
  private reload = createRef<HTMLButtonElement>();

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    const stack = (error.stack ?? "").split("\n").filter((line) => line.trimStart().startsWith("at ")).join("\n");
    console.error(`hauntmap: ${error.name}\n${stack}`);
    forcedCrashHandled();
  }

  componentDidMount(): void {
    if (this.state.failed) this.reload.current?.focus();
  }

  componentDidUpdate(): void {
    if (this.state.failed) this.reload.current?.focus();
  }

  render(): ReactNode {
    if (!this.state.failed) return <div key={this.state.attempt} className="boundary-child">{this.props.children}</div>;
    return (
      <div className="error-boundary">
        <p>{ERROR_BOUNDARY_TEXT}</p>
        <button type="button" ref={this.reload} onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
          Reload view
        </button>
      </div>
    );
  }
}