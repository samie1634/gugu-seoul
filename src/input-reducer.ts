import type { FlightInput } from './simulation.ts';
import { INACTIVE_PLAY_GATE, isPlaying, type PlayGate } from './frame-clock.ts';

export type StickAxes = readonly [x: number, y: number];
export type TouchControl = 'stick' | 'flap' | 'descend';
export type InputCommand = 'coo' | 'view' | 'pause';
export interface PointerOwner {
  readonly id: number;
  readonly control: TouchControl;
}

export type InputEvent =
  | { type: 'gate'; gate: PlayGate }
  | { type: 'reset' }
  | { type: 'key-down'; code: string; repeat: boolean; fromDialog?: boolean }
  | { type: 'key-up'; code: string }
  | { type: 'pointer-down'; id: number; control: 'stick'; axes: StickAxes }
  | { type: 'pointer-down'; id: number; control: 'flap' | 'descend' }
  | { type: 'pointer-move'; id: number; axes: StickAxes }
  | { type: 'pointer-up' | 'pointer-cancel' | 'lost-pointer-capture'; id: number; control: TouchControl };

type FlapEdge = 'confirmed' | { readonly pointerId: number };

export interface InputState {
  readonly gate: PlayGate;
  readonly keys: readonly string[];
  readonly escapeHeld: boolean;
  readonly pointers: readonly PointerOwner[];
  readonly stick: StickAxes;
  readonly flapEdge: FlapEdge | null;
}

export interface InputUpdate {
  readonly state: InputState;
  readonly command: InputCommand | null;
  readonly preventDefault: boolean;
}

export interface InputSample {
  readonly state: InputState;
  readonly input: FlightInput;
}

const neutralStick: StickAxes = Object.freeze([0, 0]);
const gameKeys = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyV',
]);
const nativeScrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createInputState(gate: PlayGate = INACTIVE_PLAY_GATE): InputState {
  return { gate: { ...gate }, keys: [], escapeHeld: false, pointers: [], stick: neutralStick, flapEdge: null };
}

const update = (state: InputState, preventDefault = false, command: InputCommand | null = null): InputUpdate =>
  ({ state, preventDefault, command });

const canTogglePause = (gate: PlayGate): boolean => gate.enabled && gate.focused && !gate.hidden;
const flapHeld = (state: InputState): boolean => state.keys.includes('Space') ||
  state.pointers.some(pointer => pointer.control === 'flap');

function normalizeStick([x, y]: StickAxes): StickAxes {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return neutralStick;
  const length = Math.max(1, Math.hypot(x, y));
  return [x / length, y / length];
}

export function reduceInput(state: InputState, event: InputEvent): InputUpdate {
  switch (event.type) {
    case 'gate': {
      const next = isPlaying(event.gate) ? { ...state, gate: { ...event.gate } } : createInputState(event.gate);
      // Escape stays latched while opening/closing a dialog; focus loss clears it.
      return update({ ...next, escapeHeld: state.escapeHeld && canTogglePause(event.gate) });
    }
    case 'reset': return update(createInputState(state.gate));
    case 'key-up':
      if (event.code === 'Escape') return update({ ...state, escapeHeld: false });
      return update({ ...state, keys: state.keys.filter(code => code !== event.code) });
    case 'key-down': {
      const { code, repeat, fromDialog } = event;
      if (code === 'Escape') {
        if (!canTogglePause(state.gate)) return update(state);
        if (repeat || state.escapeHeld) return update(state, true);
        return update({ ...state, escapeHeld: true }, true, 'pause');
      }
      if (!isPlaying(state.gate) || fromDialog || !gameKeys.has(code)) return update(state);
      const preventDefault = nativeScrollKeys.has(code);
      if (repeat || state.keys.includes(code)) return update(state, preventDefault);
      const flapEdge = code === 'Space' && !flapHeld(state) ? state.flapEdge ?? 'confirmed' : state.flapEdge;
      return update({ ...state, keys: [...state.keys, code], flapEdge }, preventDefault,
        code === 'KeyC' ? 'coo' : code === 'KeyV' ? 'view' : null);
    }
    case 'pointer-down': {
      if (!isPlaying(state.gate) || state.pointers.some(owner => owner.id === event.id ||
        (owner.control === 'stick' && event.control === 'stick'))) return update(state);
      const flapEdge = event.control === 'flap' && !flapHeld(state)
        ? state.flapEdge ?? { pointerId: event.id } : state.flapEdge;
      return update({
        ...state, flapEdge,
        pointers: [...state.pointers, { id: event.id, control: event.control }],
        stick: event.control === 'stick' ? normalizeStick(event.axes) : state.stick,
      }, true);
    }
    case 'pointer-move':
      if (!state.pointers.some(owner => owner.id === event.id && owner.control === 'stick')) return update(state);
      return update({ ...state, stick: normalizeStick(event.axes) }, true);
    case 'pointer-up':
    case 'pointer-cancel':
    case 'lost-pointer-capture': {
      if (!state.pointers.some(owner => owner.id === event.id && owner.control === event.control)) return update(state);
      const pointers = state.pointers.filter(owner => owner.id !== event.id);
      let flapEdge = state.flapEdge;
      if (event.control === 'flap' && flapEdge !== null && flapEdge !== 'confirmed' && flapEdge.pointerId === event.id) {
        // A completed tap survives pointerup. Cancellation drops the unconsumed edge
        // only if no other flap source is still holding the action.
        const otherFlap = pointers.find(owner => owner.control === 'flap');
        if (event.type === 'pointer-up' || state.keys.includes('Space')) flapEdge = 'confirmed';
        else flapEdge = otherFlap ? { pointerId: otherFlap.id } : null;
      }
      return update({ ...state, pointers, flapEdge, stick: event.control === 'stick' ? neutralStick : state.stick });
    }
  }
}

const clampAxis = (value: number): number => Math.max(-1, Math.min(1, value));

export function sampleInput(state: InputState): InputSample {
  const active = isPlaying(state.gate);
  const key = (...codes: string[]): number => active && codes.some(code => state.keys.includes(code)) ? 1 : 0;
  return {
    state: state.flapEdge === null ? state : { ...state, flapEdge: null },
    input: {
      forward: active ? clampAxis(key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown') - state.stick[1]) : 0,
      turn: active ? clampAxis(key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft') + state.stick[0]) : 0,
      flapPressed: active && state.flapEdge !== null,
      flapHeld: active && flapHeld(state),
      descend: active && (key('ShiftLeft', 'ShiftRight') === 1 || state.pointers.some(owner => owner.control === 'descend')),
    },
  };
}
