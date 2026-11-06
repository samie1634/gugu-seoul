// Authored for this candidate. Spatial wave vectors are in radians per metre.
export const RIPPLE_LIFETIME = 3.2;
export const bands = [
  { along: 0.68, cross: 1.65, amplitude: 0.050, drift: -0.60, seed: 0.37 },
  { along: 1.89, cross: -2.32, amplitude: 0.038, drift: 0.91, seed: 1.77 },
  { along: 1.72, cross: 5.60, amplitude: 0.016, drift: -1.38, seed: 2.23 },
  { along: 4.12, cross: -8.10, amplitude: 0.009, drift: 1.75, seed: 4.15 },
  { along: 7.80, cross: 15.10, amplitude: 0.0042, drift: -2.35, seed: 5.53 },
] as const;

export function riverVertex(desktop: boolean): string {
  return /* glsl */ `
#define PLANAR_WATER ${desktop ? 1 : 0}
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>

varying vec3 vWaterWorld;
#if PLANAR_WATER
  uniform mat4 textureMatrix;
  varying vec4 vMirror;
#endif

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 transformedNormal = normalize(normalMatrix * normal);
  vWaterWorld = worldPosition.xyz;
  #if PLANAR_WATER
    vMirror = textureMatrix * vec4(position, 1.0);
  #endif
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;
}

export function riverFragment(desktop: boolean, bandCount: number, capacity: number): string {
  const contributions = bands.slice(0, bandCount).map((band, i) =>
    `waves += wave(q, dx, dy, vec2(${band.along.toFixed(5)}, ${band.cross.toFixed(5)}), ${band.amplitude.toFixed(5)}, uPhase[${i}]);`,
  ).join('\n  ');

  return /* glsl */ `
#define IMPACT_CAPACITY ${capacity}
#define IMPACT_LIFETIME ${RIPPLE_LIFETIME.toFixed(2)}
#define PLANAR_WATER ${desktop ? 1 : 0}
uniform vec4 uBounds;
uniform float uDepth;
uniform vec2 uAxis;
uniform vec2 uFlow;
uniform float uPhase[${bandCount}];
uniform vec4 uImpact[IMPACT_CAPACITY];
uniform int uImpactCount;
varying vec3 vWaterWorld;
#if PLANAR_WATER
  uniform sampler2D tDiffuse;
  uniform float uMirrorActive;
  varying vec4 vMirror;
#endif

#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

vec3 wave(vec2 q, vec2 dx, vec2 dy, vec2 k, float height, float phase) {
  float footprint = abs(dot(k, dx)) + abs(dot(k, dy));
  float visible = 1.0 - smoothstep(0.65, 2.75, footprint);
  float angle = dot(q, k) + phase;
  return vec3(k * cos(angle), sin(angle)) * (height * visible);
}

// Stationary variation in the bed. Hash wrapped integer cells to keep arithmetic small.
float bedCell(vec2 i) {
  vec2 m = mod(i, 113.0);
  float n = m.x * 17.0 + m.y * 59.0;
  return fract(n * (n * 0.004751 + 0.19357) + m.x * m.y * 0.22711);
}

float bedNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bedCell(i), bedCell(i + vec2(1.0, 0.0)), f.x),
    mix(bedCell(i + vec2(0.0, 1.0)), bedCell(i + 1.0), f.x), f.y
  );
}

vec3 contactWaves(vec2 p, float pixel) {
  vec3 result = vec3(0.0);
  for (int i = 0; i < IMPACT_CAPACITY; ++i) {
    if (i >= uImpactCount) break;
    vec4 impact = uImpact[i];
    float age = impact.z;
    vec2 delta = p - impact.xy - 0.62 * uFlow * age;
    float d = length(delta);
    float radius = 0.06 + age * (0.94 + 0.56 * impact.w);
    float halfWidth = 0.065 + 0.062 * age;
    float offset = d - radius;
    if (abs(offset) < 2.5 * halfWidth + pixel) {
      float band = 1.0 - smoothstep(halfWidth, 2.5 * halfWidth + pixel, abs(offset));
      float life = 1.0 - age / IMPACT_LIFETIME;
      float a = band * life * life * smoothstep(0.0, 0.09, age) * impact.w
        * (1.0 - smoothstep(0.13, 0.72, pixel));
      float angle = offset * 2.05 / (halfWidth + 0.35 * pixel);
      result.xy += 0.24 * a * sin(angle) * delta / max(0.001, d);
      result.z += 0.033 * a * max(0.0, cos(angle));
    }
  }
  return result;
}

void main() {
  #include <logdepthbuf_fragment>

  vec2 p = vWaterWorld.xz;
  float pixel = max(length(dFdx(p)), length(dFdy(p)));
  vec2 side = vec2(-uAxis.y, uAxis.x);
  vec2 q = vec2(dot(p, uAxis), dot(p, side));
  // Slowly varying world-space currents break up coherent crest lines.
  float eddy = sin(0.31 * q.x - 0.41 * q.y + 0.64 * sin(q.y * 0.90));
  q += vec2(0.47 * eddy + 0.28 * sin(0.63 * q.x + 0.42 * q.y),
    0.64 * sin(0.51 * q.x + 0.49 * q.y + 0.88 * eddy));
  vec2 dx = dFdx(q);
  vec2 dy = dFdy(q);
  vec3 waves = vec3(0.0);
  ${contributions}
  waves.xy *= 0.76 + 0.23 * sin(0.29 * q.x + 0.33 * q.y + 1.4 * sin(0.13 * q.x - 0.39 * q.y));
  vec3 ripples = contactWaves(p, pixel);
  vec2 slope = waves.x * uAxis + waves.y * side + clamp(ripples.xy, -0.38, 0.38);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 towardEye = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
    : cameraPosition - vWaterWorld;
  vec3 eye = towardEye * inversesqrt(max(0.00001, dot(towardEye, towardEye)));
  float incidence = clamp(dot(normal, eye), 0.0, 1.0);
  float fresnel = 0.0204 + 0.9796 * pow(1.0 - incidence, 5.0);

  vec2 toEdge = min(p - uBounds.xz, uBounds.yw - p);
  float bank = max(0.0, min(toEdge.x, toEdge.y));
  float shoreWidth = min(1.9, 0.29 * min(uBounds.y - uBounds.x, uBounds.w - uBounds.z));
  float shelf = smoothstep(0.0, shoreWidth, bank);
  float depth = uDepth * mix(0.15, 1.0, shelf);
  vec3 refracted = refract(-eye, normal, 0.7502);
  float path = depth / max(0.24, -refracted.y);
  vec3 transmittance = exp(-vec3(2.2, 1.05, 0.88) * path);
  vec2 bedPoint = p + refracted.xz * min(12.0, path);
  float stone = (bedNoise(0.63 * bedPoint) - 0.5) * (1.0 - smoothstep(0.72, 2.4, pixel));
  #if PLANAR_WATER
    stone += 0.43 * (bedNoise(4.3 * bedPoint + vec2(12.7, 2.1)) - 0.5)
      * (1.0 - smoothstep(0.10, 0.36, pixel));
  #endif
  vec3 bottom = mix(vec3(0.102, 0.113, 0.091), vec3(0.345, 0.315, 0.218), clamp(0.48 + stone * 0.78, 0.0, 1.0));
  vec3 scatter = vec3(0.036, 0.079, 0.068) * (1.0 + 0.6 * waves.z);
  vec3 through = mix(scatter, bottom, transmittance);

  vec3 ray = reflect(-eye, normal);
  vec3 sky = mix(vec3(0.49, 0.54, 0.51), vec3(0.22, 0.31, 0.37), sqrt(clamp(ray.y, 0.0, 1.0)));
  float horizon = 1.0 - smoothstep(-0.08, mix(0.25, 0.11, shelf), ray.y);
  float bankFacing = 0.39 + 0.45 * abs(dot(ray.xz, side));
  vec3 reflected = mix(sky, vec3(0.084, 0.108, 0.091) * (1.0 + 0.25 * stone), horizon * bankFacing);

  float lit = getShadowMask();
  reflected *= mix(0.33, 1.0, lit);
  #if PLANAR_WATER
    if (uMirrorActive > 0.5 && vMirror.w > 0.0001) {
      vec2 uv = vMirror.xy / vMirror.w;
      vec2 tilt = (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xy;
      vec2 uvDistorted = uv + tilt * vec2(0.058, 0.074);
      vec2 margin = min(uvDistorted, 1.0 - uvDistorted);
      float coverage = smoothstep(0.005, 0.065, min(margin.x, margin.y));
      vec3 mirror = texture2D(tDiffuse, clamp(uvDistorted, 0.002, 0.998)).rgb;
      reflected = mix(reflected, mirror * mix(0.78, 1.0, lit), 0.83 * coverage);
    }
  #endif
  vec3 colour = mix(through * mix(0.43, 1.0, lit), reflected, fresnel);
  float wet = 1.0 - smoothstep(0.018, 0.16 + pixel, bank);
  colour *= 1.0 - 0.20 * wet * (1.0 - smoothstep(0.10, 0.65, pixel));

  #if NUM_DIR_LIGHTS > 0 || NUM_SUN_LIGHTS > 0
    #if NUM_DIR_LIGHTS > 0
      vec3 source = directionalLights[0].direction;
      vec3 irradiance = directionalLights[0].color;
    #else
      vec3 source = sunLights[0].direction;
      vec3 irradiance = sunLights[0].color;
    #endif
    vec3 sun = transformDirectionByInverseViewMatrix(source, viewMatrix);
    vec3 sum = sun + eye;
    vec3 halfWay = sum * inversesqrt(max(0.00001, dot(sum, sum)));
    float alignment = max(0.0, dot(normal, halfWay));
    float fine = 1.0 - smoothstep(0.12, 0.9, pixel);
    float shine = 0.081 * pow(alignment, 34.0) + 0.24 * fine * pow(alignment, 146.0);
    colour += irradiance * (lit * shine * max(0.0, dot(normal, sun)));
  #endif
  colour += vec3(0.65, 0.84, 0.78) * min(0.055, ripples.z) * mix(0.3, 1.0, lit);
  gl_FragColor = vec4(colour, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
}
