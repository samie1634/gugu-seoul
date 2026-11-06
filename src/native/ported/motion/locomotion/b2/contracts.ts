/** Native metres, Y up, heading zero faces -Z. All positions are plain data. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NativeBody {
  readonly horizontalRadiusM: number;
  readonly heightM: number;
  readonly centreToSoleM: number;
  readonly footSupportRadiusM: number;
  readonly eyeFromSoleM: Vec3;
}

export interface NativeSupportProbe {
  /** Candidate sole position. previousFeetY is the sole height before the sweep. */
  readonly at: Vec3;
  readonly previousFeetY: number;
  readonly footRadiusM: number;
  readonly heightM: number;
  readonly maxRiseM: number;
  readonly maxDropM: number;
  /** Previous support layer, when known. It is a preference within the height interval. */
  readonly layerId?: string;
}

export interface NativeSupport {
  readonly id: string;
  readonly layerId: string;
  readonly height: number;
  readonly normal: Vec3;
  readonly surface: string;
  readonly walkable: boolean;
  readonly landable: boolean;
}

export interface NativeSweepHit {
  readonly fraction: number;
  /** Tested shape centre along the input segment at fraction. */
  readonly point: Vec3;
  /** Unit normal pointing from the collider toward the moving shape. */
  readonly normal: Vec3;
  readonly colliderId: string;
  readonly layerId?: string;
}

/** null is a validated miss. undefined means unavailable, invalid or unverified. */
export type NativeQueryResult<T> = T | null | undefined;

export interface NativeWorldQueries {
  /** Query the whole sole disk in [min(previousFeetY, at.y)-maxDropM, previousFeetY+maxRiseM]. */
  supportAt(probe: NativeSupportProbe): NativeQueryResult<NativeSupport>;
  sweepBody(fromCenter: Vec3, toCenter: Vec3, body: NativeBody): NativeQueryResult<NativeSweepHit>;
  /** true is verified clear; false is known overlap; undefined is unverified. */
  sphereClear(center: Vec3, radiusM: number): boolean | undefined;
  /** Includes initial penetration (fraction 0); a tangent moving away remains clear. */
  sweepSphere(from: Vec3, to: Vec3, radiusM: number): NativeQueryResult<NativeSweepHit>;
}
