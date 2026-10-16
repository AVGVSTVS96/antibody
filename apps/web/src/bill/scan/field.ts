import { CH, CHANNELS, type MapView, type Scenes } from "./layout.ts";
import { wrapPi } from "./polar.ts";
import { SWITCH_SPRING, springAt } from "./spring.ts";

export interface Painter {
  paint(cur: Float64Array): void;
}

const EPS = [1e-4, 0.02, 0.02, 0.02, 0.002];
const FADE_MS = 150;

/**
 * Every mark of every view, each with a position, a length, a size and an opacity that spring to the next view's
 * layout. A mark that was hidden appears where it belongs and fades in; one that is still moving when the view
 * changes again carries its velocity into the new target (a second click re-aims from where it is).
 */
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

  constructor(
    private scenes: Scenes,
    view: MapView,
  ) {
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
      const home = order.find((v) => scenes.targets[v].present[i]);
      if (home) for (let c = 0; c < CHANNELS; c++) this.cur[o + c] = scenes.targets[home].t[o + c]!;
      const here = scenes.targets[view];
      this.cur[o + CH.alpha] = here.present[i] ? 1 : 0;
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
      if (!this.live[i]) continue;
      this.evaluate(i, now);
    }
  }

  private evaluate(i: number, now: number): boolean {
    const o = i * CHANNELS;
    const t = (now - this.t0[i]!) / 1000;
    let moving = false;
    for (let c = 0; c < CHANNELS; c++) {
      const k = o + c;
      if (this.reduced && c === CH.alpha) {
        const p = Math.min(1, Math.max(0, (now - this.t0[i]!) / FADE_MS));
        this.cur[k] = this.from[k]! + (this.to[k]! - this.from[k]!) * p;
        this.vel[k] = 0;
        if (p < 1) moving = true;
        continue;
      }
      const [x, v] = springAt(t, this.from[k]!, this.fromV[k]!, this.to[k]!, SWITCH_SPRING);
      if (Math.abs(x - this.to[k]!) < EPS[c]! && Math.abs(v) < EPS[c]! * 6) {
        this.cur[k] = this.to[k]!;
        this.vel[k] = 0;
      } else {
        this.cur[k] = x;
        this.vel[k] = v;
        moving = true;
      }
    }
    if (!moving) this.live[i] = 0;
    return moving;
  }

  private tick = (now: number) => {
    let any = false;
    for (let i = 0; i < this.live.length; i++) if (this.live[i] && this.evaluate(i, now)) any = true;
    this.painter?.paint(this.cur);
    this.raf = any ? requestAnimationFrame(this.tick) : 0;
  };

  go(view: MapView, animate: boolean) {
    const now = performance.now();
    this.sample(now);
    const sc = this.scenes.targets[view];
    const n = this.live.length;
    for (let i = 0; i < n; i++) {
      const o = i * CHANNELS;
      const hidden = this.cur[o + CH.alpha]! < 0.02;
      for (let c = 0; c < CHANNELS; c++) {
        const k = o + c;
        this.from[k] = this.cur[k]!;
        this.fromV[k] = this.vel[k]!;
        if (c === CH.alpha) this.to[k] = sc.present[i] ? 1 : 0;
        else if (!sc.present[i]) this.to[k] = this.cur[k]!;
        else {
          const target = sc.t[k]!;
          this.to[k] = c === CH.angle && !hidden ? this.cur[k]! + wrapPi(target - this.cur[k]!) : target;
          if (hidden) {
            this.cur[k] = this.from[k] = this.to[k]!;
            this.vel[k] = this.fromV[k] = 0;
          }
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
      for (let i = 0; i < n; i++)
        for (let c = 0; c < CHANNELS; c++) {
          if (c === CH.alpha) continue;
          const k = i * CHANNELS + c;
          this.cur[k] = this.from[k] = this.to[k]!;
          this.vel[k] = this.fromV[k] = 0;
        }
    }
    this.stop();
    this.raf = requestAnimationFrame(this.tick);
  }
}
