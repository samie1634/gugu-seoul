import type { FlightInput } from './simulation.ts';
import { createInputState, reduceInput, sampleInput, type InputEvent, type InputUpdate, type StickAxes, type TouchControl } from './input-reducer.ts';
import { INACTIVE_PLAY_GATE, setFrameClockGate, stepFrameClock, type FrameClock, type FrameStep, type PlayGate } from './frame-clock.ts';

export interface InputPreview {
  readonly input: Readonly<FlightInput>;
  isCurrent(): boolean;
  commit(): boolean;
}

/** DOM ownership and capture only; the application supplies the lifecycle gate. */
export class Controls {
  private state = createInputState({
    ...INACTIVE_PLAY_GATE,
    focused: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    hidden: document.hidden === true,
  });
  private capturedPointers = new Map<number, { element: HTMLElement; control: TouchControl }>();
  private readonly thumb: HTMLElement;
  onCoo = () => {};
  onView = () => {};
  onPause = () => {};

  constructor(joystick: HTMLElement, flap: HTMLElement, descend: HTMLElement) {
    this.thumb = joystick.querySelector<HTMLElement>('.stick-thumb')!;
    window.addEventListener('keydown', event => this.send({
      type: 'key-down', code: event.code, repeat: event.repeat,
      fromDialog: event.target instanceof Element && !!event.target.closest('dialog'),
    }, event));
    window.addEventListener('keyup', event => this.send({ type: 'key-up', code: event.code }));
    // Standalone adapters stay neutral too; main also updates the clock gate.
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
    const bind = (element: HTMLElement, control: TouchControl) => {
      element.addEventListener('pointerdown', event => {
        const existed = this.state.pointers.some(owner => owner.id === event.pointerId);
        this.send(control === 'stick'
          ? { type: 'pointer-down', id: event.pointerId, control, axes: this.axes(joystick, event) }
          : { type: 'pointer-down', id: event.pointerId, control }, event);
        if (existed || !this.state.pointers.some(owner => owner.id === event.pointerId && owner.control === control)) return;
        this.capturedPointers.set(event.pointerId, { element, control });
        try { element.setPointerCapture(event.pointerId); }
        catch { this.send({ type: 'pointer-cancel', id: event.pointerId, control }); }
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        element.addEventListener(type, event => this.send({
          type: type === 'pointerup' ? 'pointer-up' : type === 'pointercancel' ? 'pointer-cancel' : 'lost-pointer-capture',
          id: event.pointerId, control,
        }));
      }
    };
    bind(joystick, 'stick'); bind(flap, 'flap'); bind(descend, 'descend');
    joystick.addEventListener('pointermove', event => this.send({
      type: 'pointer-move', id: event.pointerId, axes: this.axes(joystick, event),
    }, event));
  }

  get enabled(): boolean { return this.state.gate.enabled; }
  set enabled(enabled: boolean) { this.setGate({ ...this.state.gate, enabled }); }

  setGate(gate: PlayGate): void { this.send({ type: 'gate', gate }); }

  sample(): FlightInput {
    const sample = sampleInput(this.state); this.state = sample.state; return sample.input;
  }

  /** Native frames consume the edge only after all spatial queries succeed. */
  preview(): InputPreview {
    const before = this.state;
    const sample = sampleInput(before);
    let consumed = false;
    const isCurrent = () => !consumed && this.state === before;
    return {
      input: Object.freeze(sample.input), isCurrent,
      commit: () => {
        if (!isCurrent()) return false;
        consumed = true; this.state = sample.state; return true;
      },
    };
  }

  reset(): void { this.send({ type: 'reset' }); }

  private axes(joystick: HTMLElement, event: PointerEvent): StickAxes {
    const rect = joystick.getBoundingClientRect();
    return [(event.clientX - rect.left - rect.width / 2) / (rect.width * 0.34),
      (event.clientY - rect.top - rect.height / 2) / (rect.height * 0.34)];
  }

  private send(event: InputEvent, domEvent?: Event): InputUpdate {
    const result = reduceInput(this.state, event);
    // A command may synchronously open a modal and replace this state again.
    this.state = result.state;
    if (result.preventDefault) domEvent?.preventDefault();
    this.syncPointers();
    if (result.command === 'coo') this.onCoo();
    else if (result.command === 'view') this.onView();
    else if (result.command === 'pause') this.onPause();
    return result;
  }

  private syncPointers(): void {
    for (const [id, capture] of this.capturedPointers) {
      if (this.state.pointers.some(owner => owner.id === id && owner.control === capture.control)) continue;
      this.capturedPointers.delete(id);
      try { if (capture.element.hasPointerCapture(id)) capture.element.releasePointerCapture(id); }
      catch { /* The browser may already have cancelled this pointer. */ }
    }
    const [x, y] = this.state.stick;
    if (x === 0 && y === 0) this.thumb.style.removeProperty('transform');
    else this.thumb.style.transform = 'translate(' + x * 33 + 'px, ' + y * 33 + 'px)';
  }
}

/** Apply one lifecycle transition to input and its timestamp chain together. */
export function applyControlsGate(controls: Pick<Controls, 'setGate'>, clock: FrameClock, gate: PlayGate): FrameClock {
  controls.setGate(gate);
  return setFrameClockGate(clock, gate);
}

/** Preserve a fresh queued tap until a frame accepts positive simulation time. */
export function sampleControlsFrame(controls: Pick<Controls, 'sample'>, clock: FrameClock, timestampMs: number): FrameStep & { input: FlightInput | null } {
  const frame = stepFrameClock(clock, timestampMs);
  return { ...frame, input: frame.acceptedSeconds > 0 ? controls.sample() : null };
}
