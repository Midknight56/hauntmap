import { easeOut } from "./effects";

// The rooms of a loop as the ghost walks it: each lap they start dim, a room lights with a candle glow in 200 ms when the ghost
// reaches its door, stays lit for the rest of the lap, and goes dim again at the start of the next lap. Pure, no PixiJS. It reads the
// ghost's leg and lap only: it never touches the graph, the selection or the steps.

/** A room that the ghost has not reached shows at this fraction of its full brightness. */
export const DIM_BRIGHTNESS = 0.45;
/** A room lights up in about this long once the ghost reaches its door. */
export const LIGHT_UP_MS = 200;

export interface RoomLightReading {
  id: string;
  /** True from the moment the ghost reaches the door of the room until the end of the lap. */
  lit: boolean;
  /** 0 dim, 1 full candle glow: the light coming up. */
  glow: number;
  /** 0.45 when dim, 1 when lit. */
  brightness: number;
}

export interface LoopLights {
  /** The ghost stands at or has passed the door of `index` (the leg it is on) in lap `lap`: every room up to it is lit. A new lap dims every room first. */
  sync(index: number, lap: number): void;
  advance(deltaMs: number): void;
  /** Light every room at once and keep it so (reduced motion). */
  still(): void;
  rooms(): RoomLightReading[];
  readonly lap: number;
}

export function createLoopLights(modules: readonly string[]): LoopLights {
  const lit = modules.map(() => false);
  const age = modules.map(() => 0);
  let lap = 1;
  let frozen = false;
  const glowOf = (i: number): number => (lit[i] === true ? easeOut(Math.min(1, (age[i] as number) / LIGHT_UP_MS)) : 0);
  return {
    sync(index, nextLap) {
      if (frozen) return;
      if (nextLap !== lap) {
        lap = nextLap;
        for (let i = 0; i < lit.length; i++) {
          lit[i] = false;
          age[i] = 0;
        }
      }
      for (let i = 0; i <= index && i < lit.length; i++) {
        if (lit[i] !== true) {
          lit[i] = true;
          age[i] = 0;
        }
      }
    },
    advance(deltaMs) {
      if (frozen) return;
      for (let i = 0; i < lit.length; i++) if (lit[i] === true) age[i] = Math.min(LIGHT_UP_MS, (age[i] as number) + Math.max(0, deltaMs));
    },
    still() {
      frozen = true;
      for (let i = 0; i < lit.length; i++) {
        lit[i] = true;
        age[i] = LIGHT_UP_MS;
      }
    },
    rooms() {
      return modules.map((id, i) => {
        const glow = frozen ? 1 : glowOf(i);
        return { id, lit: lit[i] === true, glow, brightness: DIM_BRIGHTNESS + (1 - DIM_BRIGHTNESS) * glow };
      });
    },
    get lap() {
      return lap;
    },
  };
}
