import type { ElementStyle } from './visual';

export const lightingModes = ['Fill', 'Outline', 'Glow', 'Fill + glow', 'Gradient', 'Ripple', 'Analog Fill', 'Off'] as const;
export const motionModes = ['None', 'Press', 'Scale', 'Lift', 'Bounce', 'Pulse'] as const;
export const easingModes = ['Linear', 'Ease out', 'Ease in out', 'Spring'] as const;
export const animationFields = ['lighting', 'motion', 'easing', 'pressDelay', 'releaseDelay', 'lightingOpacity', 'secondaryColor', 'gradientAngle', 'motionScale'] as const;
export function animationSettings(style: ElementStyle) {
  const modern = ['motion', 'lighting', 'easing', 'pressDelay', 'releaseDelay', 'motionScale'].some(key => style[key as keyof ElementStyle] !== undefined);
  return {
    lighting: style.lighting ?? (style.effect === 'Glow' ? 'Fill + glow' : style.effect === 'Analog Fill' ? 'Analog Fill' : 'Fill'),
    motion: style.motion ?? (style.effect === 'Instant' ? 'None' : style.effect === 'Pulse' ? 'Pulse' : 'Press'),
    easing: style.easing ?? 'Ease out', pressDelay: style.pressDelay ?? 0, releaseDelay: style.releaseDelay ?? 0,
    lightingOpacity: style.lightingOpacity ?? 1, secondaryColor: style.secondaryColor ?? '#8acbff', gradientAngle: style.gradientAngle ?? 135, motionScale: style.motionScale ?? .92,
    pressMs: !modern && style.effect === 'Instant' ? 0 : style.pressDuration ?? 90,
    releaseMs: !modern && style.effect === 'Instant' ? 0 : style.releaseDuration ?? 140,
  };
}
export const easingCss = { Linear: 'linear', 'Ease out': 'cubic-bezier(.2,.7,.2,1)', 'Ease in out': 'ease-in-out', Spring: 'cubic-bezier(.2,1.6,.4,1)' };

/** One bounded timeline per cap. Short taps survive a delayed onset; releases
 * cancel on re-press. No timers, queues or changes to the physical input state. */
export class PressTimeline {
  logical = 0;
  value = 0;
  private peak = 0;
  private pressAt = Infinity;
  private releaseAt = Infinity;
  private visibleAt = -Infinity;
  reset(value = 0) { this.logical = this.value = value; this.peak = value; this.pressAt = this.releaseAt = Infinity; this.visibleAt = -Infinity; }
  input(value: number, now: number, pressDelay: number, releaseDelay: number) {
    value = Math.max(0, Math.min(1, value));
    if (value === this.logical) return;
    const was = this.logical; this.logical = value;
    if (value > 0) {
      this.peak = value; this.releaseAt = Infinity;
      if (this.value > 0) this.value = value;
      else if (!was) this.pressAt = Math.min(this.pressAt, now + pressDelay);
    } else if (was > 0) {
      this.releaseAt = Math.max(now + releaseDelay, this.pressAt < Infinity ? this.pressAt + 65 : this.visibleAt + 65);
    }
  }
  advance(now: number) {
    if (now >= this.pressAt) { this.value = this.logical || this.peak; this.visibleAt = now; this.pressAt = Infinity; this.releaseAt = Math.max(this.releaseAt, now + 65); }
    if (!this.logical && now >= this.releaseAt) { this.value = 0; this.releaseAt = Infinity; }
    return this.value;
  }
  get deadline() { return Math.min(this.pressAt, this.releaseAt); }
}
