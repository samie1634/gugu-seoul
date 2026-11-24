import type { NativeMotionTuning } from './ported/motion/locomotion/b2/native-motion.ts';

// Restored from the pre-4bf3541 native scene. Vertical flight physics are unchanged.
export const NORMAL_FLIGHT_TUNING: NativeMotionTuning = Object.freeze({ walkSpeed: .9, flightSpeed: 12, glideSpeed: 15 });
export const FED_FLIGHT_TUNING: NativeMotionTuning = Object.freeze({ walkSpeed: 1.8, flightSpeed: 70 / 3.6, glideSpeed: 60 / 3.6 });
export const FOOD_BOOST_SECONDS = 10;
export interface FoodBoost {
  readonly remainingSeconds: number;
  readonly capacitySeconds: number;
  readonly eaten: number;
}
export const createFoodBoost = (): FoodBoost => Object.freeze({ remainingSeconds: 0, capacitySeconds: FOOD_BOOST_SECONDS, eaten: 0 });
/** Advance only on an accepted scene commit. New meals add a full ten seconds. */
export function advanceFoodBoost(state: FoodBoost, seconds: number, eaten: number): FoodBoost {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > .1 || !Number.isSafeInteger(eaten) || eaten < state.eaten) return state;
  const additions = (eaten - state.eaten) * FOOD_BOOST_SECONDS;
  const afterElapsed = Math.max(0, state.remainingSeconds - seconds);
  const remainingSeconds = afterElapsed + additions;
  const capacitySeconds = additions > 0 ? Math.max(FOOD_BOOST_SECONDS, remainingSeconds)
    : remainingSeconds > 0 ? state.capacitySeconds : FOOD_BOOST_SECONDS;
  return Object.freeze({ remainingSeconds: remainingSeconds < 1e-9 ? 0 : remainingSeconds, capacitySeconds, eaten });
}
export const flightTuningAfterFood = (remainingSeconds: number): NativeMotionTuning => remainingSeconds > 1e-9 ? FED_FLIGHT_TUNING : NORMAL_FLIGHT_TUNING;
export function foodBoostDisplay(state: FoodBoost): { remainingSeconds: number; capacitySeconds: number; label: string; active: boolean } {
  const active = state.remainingSeconds > 1e-9;
  return { remainingSeconds: state.remainingSeconds, capacitySeconds: state.capacitySeconds, label: `${active ? Math.ceil(state.remainingSeconds) : 0}초`, active };
}
