import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_RESTORE_TIMEOUT_MS, watchContext } from "../../src/scene/fallback";

describe("context watcher (12.3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const target = new EventTarget();
    const log: string[] = [];
    const stop = watchContext(target, {
      onLost: () => log.push("lost"),
      onRestored: () => log.push("restored"),
      onFallback: () => log.push("fallback"),
    });
    return { target, log, stop };
  }

  it("waits 5,000 ms", () => expect(CONTEXT_RESTORE_TIMEOUT_MS).toBe(5000));

  it("prevents the default of the lost event so that a restore can happen", () => {
    const { target } = setup();
    const event = new Event("webglcontextlost", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("restore inside the window cancels the fallback", () => {
    const { target, log } = setup();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(900);
    target.dispatchEvent(new Event("webglcontextrestored"));
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(["lost", "restored"]);
  });

  it("calls the fallback once after 5,000 ms without a restore", () => {
    const { target, log } = setup();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(4999);
    expect(log).toEqual(["lost"]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(["lost", "fallback"]);
    vi.advanceTimersByTime(20_000);
    expect(log).toEqual(["lost", "fallback"]);
  });

  it("a second loss restarts the timer; stop removes the listeners and the timer", () => {
    const { target, log, stop } = setup();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(3000);
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(3000);
    expect(log).toEqual(["lost", "lost"]);
    stop();
    vi.advanceTimersByTime(10_000);
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(log).toEqual(["lost", "lost"]);
  });
});