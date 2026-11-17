import { describe, expect, it } from "vitest";
import { CULL_MARGIN, visibleRoomIds } from "../../src/scene/culling";
import { createTickerGate } from "../../src/scene/tickerGate";

const VP = { width: 1000, height: 600 };
const room = (id: string, x: number, y: number) => ({ id, x, y, w: 96, h: 64 });

describe("culling (9.4)", () => {
  it("uses a 100 px margin", () => expect(CULL_MARGIN).toBe(100));

  it("keeps rooms inside the viewport plus the margin and drops the rest", () => {
    const cam = { x: 500, y: 300, zoom: 1 };
    // The viewport spans scene x 0..1000, y 0..600; the margin extends it to -100..1100, -100..700.
    const rooms = [room("in", 10, 10), room("edge", 1099, 10), room("justOut", 1101, 10), room("farLeft", -300, 10), room("below", 10, 701)];
    expect(visibleRoomIds(rooms, cam, VP)).toEqual(["in", "edge"]);
  });

  it("measures the margin in screen pixels, so it shrinks in scene units when zoomed in", () => {
    const cam = { x: 500, y: 300, zoom: 2 };
    // Viewport spans scene x 250..750; the 100 px margin is 50 scene units: 200..800.
    const rooms = [room("a", 799, 300), room("b", 801, 300)];
    expect(visibleRoomIds(rooms, cam, VP)).toEqual(["a"]);
  });
});

describe("ticker gate (9.4)", () => {
  it("runs only while the document is visible and the container intersects the viewport", () => {
    const calls: string[] = [];
    const gate = createTickerGate({ start: () => calls.push("start"), stop: () => calls.push("stop") });
    expect(gate.running).toBe(true);
    gate.setDocumentHidden(true);
    expect(gate.running).toBe(false);
    gate.setIntersecting(false);
    gate.setDocumentHidden(false);
    expect(gate.running).toBe(false);
    gate.setIntersecting(true);
    expect(gate.running).toBe(true);
    expect(calls).toEqual(["stop", "start"]);
  });

  it("does not call start or stop twice for the same state", () => {
    const calls: string[] = [];
    const gate = createTickerGate({ start: () => calls.push("start"), stop: () => calls.push("stop") });
    gate.setDocumentHidden(true);
    gate.setDocumentHidden(true);
    gate.setIntersecting(false);
    expect(calls).toEqual(["stop"]);
  });

  it("an external stop (a lost context) keeps it stopped until resumed", () => {
    const calls: string[] = [];
    const gate = createTickerGate({ start: () => calls.push("start"), stop: () => calls.push("stop") });
    gate.setSuspended(true);
    gate.setDocumentHidden(true);
    gate.setDocumentHidden(false);
    expect(gate.running).toBe(false);
    gate.setSuspended(false);
    expect(gate.running).toBe(true);
    expect(calls).toEqual(["stop", "start"]);
  });
});