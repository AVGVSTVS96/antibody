import { CH, CHANNELS } from "./layout.ts";
import type { MapView, Scenes } from "./layout.ts";
import { wrapPi } from "./polar.ts";
import { SWITCH_SPRING, springAt } from "./spring.ts";

export interface Painter {
  paint: (cur: Float64Array) => void;
}

const EPS = [1e-4, 0.02, 0.02, 0.02, 0.002];
const FADE_MS = 150;

export class Field {
  readonly cur: Float64Array;
  private vel: Float64Array;
  private from: Float64Array;
  private fromV: Float64Array;
  private to: Float64Array;
  private t0: Float64Array;
  private live: Uint8Array;
  private reduced = false;
  private raf = 0;
  private painter: Painter | null = null;
  private readonly scenes: Scenes;

  constructor(scenes: Scenes, view: MapView) {
    this.scenes = scenes;
    const n = scenes.marks.length;
    this.cur = new Float64Array(n * CHANNELS);
    this.vel = new Float64Array(n * CHANNELS);
    this.from = new Float64Array(n * CHANNELS);
    this.fromV = new Float64Array(n * CHANNELS);
    this.to = new Float64Array(n * CHANNELS);
    this.t0 = new Float64Array(n);
    this.live = new Uint8Array(n);
    const order: MapView[] = [view, "trades", "pac", "sections"];

    for (let i = 0; i < n; i++) {
      const o = i * CHANNELS;
      const home = order.find((v) => scenes.targets[v].present[i] === 1);

      if (home) {
        this.cur.set(scenes.targets[home].t.subarray(o, o + CHANNELS), o);
      }

      this.cur[o + CH.alpha] = scenes.targets[view].present[i] === 1 ? 1 : 0;
    }

    this.to.set(this.cur);
  }

  attach(painter: Painter | null) {
    this.painter = painter;
    painter?.paint(this.cur);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced;
  }

  private sample(now: number) {
    for (let i = 0; i < this.live.length; i++) {
      if (this.live[i] !== 1) {
        continue;
      }

      this.evaluate(i, now);
    }
  }

  private evaluate(i: number, now: number): boolean {
    const o = i * CHANNELS;
    const elapsedMs = now - (this.t0[i] ?? now);
    let moving = false;

    for (let c = 0; c < CHANNELS; c++) {
      const k = o + c;
      const from = this.from[k] ?? 0;
      const to = this.to[k] ?? 0;

      if (this.reduced && c === CH.alpha) {
        const p = Math.min(1, Math.max(0, elapsedMs / FADE_MS));
        this.cur[k] = from + (to - from) * p;
        this.vel[k] = 0;

        if (p < 1) {
          moving = true;
        }

        continue;
      }

      const [x, v] = springAt(elapsedMs / 1000, from, this.fromV[k] ?? 0, to, SWITCH_SPRING);
      const eps = EPS[c] ?? 0;

      if (Math.abs(x - to) < eps && Math.abs(v) < eps * 6) {
        this.cur[k] = to;
        this.vel[k] = 0;
      } else {
        this.cur[k] = x;
        this.vel[k] = v;
        moving = true;
      }
    }

    if (!moving) {
      this.live[i] = 0;
    }

    return moving;
  }

  private readonly tick = (now: number) => {
    let any = false;

    for (let i = 0; i < this.live.length; i++) {
      if (this.live[i] === 1 && this.evaluate(i, now)) {
        any = true;
      }
    }

    this.painter?.paint(this.cur);
    this.raf = any ? requestAnimationFrame(this.tick) : 0;
  };

  private settle(k: number, at: number) {
    this.cur[k] = at;
    this.from[k] = at;
    this.vel[k] = 0;
    this.fromV[k] = 0;
  }

  go(view: MapView, animate: boolean) {
    const now = performance.now();
    this.sample(now);
    const sc = this.scenes.targets[view];
    const n = this.live.length;

    for (let i = 0; i < n; i++) {
      const o = i * CHANNELS;
      const hidden = (this.cur[o + CH.alpha] ?? 0) < 0.02;
      const shown = sc.present[i] === 1;

      for (let c = 0; c < CHANNELS; c++) {
        const k = o + c;
        const cur = this.cur[k] ?? 0;
        this.from[k] = cur;
        this.fromV[k] = this.vel[k] ?? 0;

        if (c === CH.alpha) {
          this.to[k] = shown ? 1 : 0;
        } else if (shown) {
          const target = sc.t[k] ?? 0;
          const to = c === CH.angle && !hidden ? cur + wrapPi(target - cur) : target;
          this.to[k] = to;

          if (hidden) {
            this.settle(k, to);
          }
        } else {
          this.to[k] = cur;
        }
      }

      this.t0[i] = now;
      this.live[i] = 1;
    }

    if (!animate) {
      this.cur.set(this.to);
      this.vel.fill(0);
      this.live.fill(0);
      this.stop();
      this.painter?.paint(this.cur);

      return;
    }

    if (this.reduced) {
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < CHANNELS; c++) {
          if (c !== CH.alpha) {
            const k = i * CHANNELS + c;
            this.settle(k, this.to[k] ?? 0);
          }
        }
      }
    }

    this.stop();
    this.raf = requestAnimationFrame(this.tick);
  }
}
