import { emptyInput, type FlightInput } from './simulation.ts';

export class Controls {
  private keys = new Set<string>();
  private flapQueued = false;
  private touchFlap = false;
  private touchDescend = false;
  private joystickPointer: number | null = null;
  private capturedPointers = new Map<number, HTMLElement>();
  private stick = { x: 0, y: 0 };
  enabled = false;
  onCoo = () => {};
  onView = () => {};
  onPause = () => {};

  constructor(joystick: HTMLElement, flap: HTMLElement, descend: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) this.onPause(); return; }
      if (!this.enabled || (e.target instanceof Element && e.target.closest('dialog'))) return;
      if (e.repeat && !this.keys.has(e.code)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space' && !e.repeat && !this.keys.has(e.code)) this.flapQueued = true;
      if (!e.repeat && e.code === 'KeyC') this.onCoo();
      if (!e.repeat && e.code === 'KeyV') this.onView();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
    const bindHold = (element: HTMLElement, start: () => void, end: () => void) => {
      element.addEventListener('pointerdown', e => {
        if (!this.enabled) return;
        e.preventDefault(); element.setPointerCapture(e.pointerId); this.capturedPointers.set(e.pointerId, element); start();
      });
      const stop = (e: PointerEvent) => { this.capturedPointers.delete(e.pointerId); end(); };
      element.addEventListener('pointerup', stop);
      element.addEventListener('pointercancel', stop);
      element.addEventListener('lostpointercapture', stop);
    };
    bindHold(flap, () => { this.touchFlap = true; this.flapQueued = true; }, () => { this.touchFlap = false; });
    bindHold(descend, () => { this.touchDescend = true; }, () => { this.touchDescend = false; });
    const thumb = joystick.querySelector<HTMLElement>('.stick-thumb')!;
    const updateStick = (e: PointerEvent) => {
      const r = joystick.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width * 0.34);
      let y = (e.clientY - r.top - r.height / 2) / (r.height * 0.34);
      const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
      this.stick = { x, y };
      thumb.style.transform = `translate(${x * 33}px, ${y * 33}px)`;
    };
    joystick.addEventListener('pointerdown', e => {
      if (!this.enabled || this.joystickPointer !== null) return;
      e.preventDefault(); this.joystickPointer = e.pointerId; joystick.setPointerCapture(e.pointerId);
      this.capturedPointers.set(e.pointerId, joystick); updateStick(e);
    });
    joystick.addEventListener('pointermove', e => { if (e.pointerId === this.joystickPointer) updateStick(e); });
    const releaseStick = (e: PointerEvent) => {
      if (e.pointerId !== this.joystickPointer) return;
      this.joystickPointer = null; this.capturedPointers.delete(e.pointerId); this.stick = { x: 0, y: 0 }; thumb.style.transform = '';
    };
    joystick.addEventListener('pointerup', releaseStick);
    joystick.addEventListener('pointercancel', releaseStick);
    joystick.addEventListener('lostpointercapture', releaseStick);
  }

  sample(): FlightInput {
    if (!this.enabled) return emptyInput();
    const key = (...codes: string[]) => codes.some(c => this.keys.has(c)) ? 1 : 0;
    const input = {
      forward: Math.max(-1, Math.min(1, key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown') - this.stick.y)),
      turn: Math.max(-1, Math.min(1, key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft') + this.stick.x)),
      flapPressed: this.flapQueued,
      flapHeld: this.touchFlap || this.keys.has('Space'),
      descend: this.touchDescend || !!key('ShiftLeft', 'ShiftRight'),
    };
    this.flapQueued = false;
    return input;
  }

  reset(): void {
    this.keys.clear(); this.flapQueued = false; this.touchFlap = false;
    this.touchDescend = false; this.stick = { x: 0, y: 0 };
    this.joystickPointer = null;
    for (const [id, element] of this.capturedPointers) {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    this.capturedPointers.clear();
    document.querySelector<HTMLElement>('.stick-thumb')?.style.removeProperty('transform');
  }
}
