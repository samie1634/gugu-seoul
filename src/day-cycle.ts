import * as THREE from 'three';
import { createSkyPhotograph, PHOTOGRAPHIC_SKY_GLSL } from './photographic-sky.ts';
import { createWeatherRain, sampleWeather, WEATHER_CLOUD_GLSL, type WeatherOptions } from './weather.ts';
import type { Vec3 } from './native/ported/motion/locomotion/b2/contracts.ts';

/** One active real second is one game minute. Paused/hidden time is not advanced. */
export const DAY_SECONDS = 24 * 60;
export const START_HOUR = 9;
const TAU = Math.PI * 2;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (low: number, high: number, v: number) => { const t = clamp((v - low) / (high - low)); return t * t * (3 - 2 * t); };
export function sampleDayCycle(activeSeconds: number, startHour = START_HOUR) {
  if (!Number.isFinite(activeSeconds) || activeSeconds < 0 || !Number.isFinite(startHour)) throw new RangeError('Invalid day clock');
  const totalMinutes = activeSeconds + startHour * 60;
  const minuteOfDay = ((totalMinutes % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const hour = minuteOfDay / 60;
  const angle = (hour - 6) / 24 * TAU;
  const elevation = Math.sin(angle);
  const sunDirection = { x: Math.cos(angle), y: elevation, z: -0.28 * Math.sin(angle) };
  const length = Math.hypot(sunDirection.x, sunDirection.y, sunDirection.z);
  sunDirection.x /= length; sunDirection.y /= length; sunDirection.z /= length;
  const daylight = smooth(-0.12, 0.25, elevation);
  const twilight = (1 - smooth(0.03, 0.38, Math.abs(elevation))) * smooth(-0.2, -0.03, elevation);
  return { activeSeconds, minuteOfDay, hour, day: Math.floor(totalMinutes / DAY_SECONDS), daylight, twilight,
    sunDirection, moonDirection: { x: -sunDirection.x, y: -sunDirection.y, z: -sunDirection.z } };
}

/** Camera-centred sky only. It adds no interface or changes to camera controls. */
export function createDayCycle(scene: THREE.Scene, hemisphere: THREE.HemisphereLight, light: THREE.DirectionalLight, options: WeatherOptions = {}) {
  const rain = createWeatherRain(scene, options);
  const photograph = createSkyPhotograph(options.quality);
  const root = new THREE.Group(); root.name = 'seoul:day-cycle'; scene.add(root);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { ...photograph.uniforms, zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDirection: { value: new THREE.Vector3() }, dusk: { value: 0 }, cloudiness: { value: .28 }, rainAmount: { value: 0 }, weatherTime: { value: 0 }, weatherDaylight: { value: 1 } },
    vertexShader: `varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDirection; uniform float dusk; uniform float weatherDaylight; varying vec3 vDirection;
      ${WEATHER_CLOUD_GLSL}
      ${PHOTOGRAPHIC_SKY_GLSL}
      void main(){vec3 d=normalize(vDirection);float h=pow(max(0.,d.y),.55); vec3 color=mix(horizon,zenith,h);
        float glow=pow(max(0.,dot(d,sunDirection)),5.)*(1.-h)*dusk; color=mix(color,vec3(1.,.39,.17),glow*.48);
        if(seoulPhotoWeight*seoulPhotoReady<.999)color=weatherClouds(color,d,weatherDaylight); color=applySeoulSkyPhotograph(color,d); gl_FragColor=vec4(color,1.);\n #include <tonemapping_fragment>\n #include <colorspace_fragment> }`,
  });
  // Keep every sky vertex inside the app's existing 2,400 m far plane.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), skyMaterial); dome.frustumCulled = false; dome.renderOrder = -100; root.add(dome);
  const discGeometry = new THREE.CircleGeometry(1, 48);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: '#fff1bf', fog: false, toneMapped: false, depthWrite: false, depthTest: false });
  const moonMaterial = new THREE.MeshBasicMaterial({ color: '#e4ecfa', fog: false, toneMapped: false, depthWrite: false, depthTest: false });
  const sun = new THREE.Mesh(discGeometry, sunMaterial); sun.name = 'seoul:sun'; sun.renderOrder = -99; sun.scale.setScalar(22); root.add(sun);
  const moon = new THREE.Mesh(discGeometry, moonMaterial); moon.name = 'seoul:moon'; moon.renderOrder = -99; moon.scale.setScalar(18); root.add(moon);
  const glowMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false,
    uniforms: { tint: { value: new THREE.Color('#ffdb99') } }, vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 tint;varying vec2 vUv;void main(){float r=length(vUv-.5)*2.;gl_FragColor=vec4(tint,pow(max(0.,1.-r),3.)*.35);}` });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(155,155), glowMaterial); glow.renderOrder = -98; root.add(glow);
  const nightZenith = new THREE.Color('#101a35'), dayZenith = new THREE.Color('#3b79b4');
  const nightHorizon = new THREE.Color('#334567'), dayHorizon = new THREE.Color('#d6e3e4'), duskHorizon = new THREE.Color('#e4a37f');
  const nightSky = new THREE.Color('#9ab6e2'), daySky = new THREE.Color('#e6f0f4');
  const nightGround = new THREE.Color('#5c657d'), dayGround = new THREE.Color('#797867');
  const moonLight = new THREE.Color('#a8c8ff'), sunLight = new THREE.Color('#fff0dc'), duskLight = new THREE.Color('#ffbc86');
  const direction = new THREE.Vector3(), stormHorizon = new THREE.Color('#7f8c9d');
  let state = sampleDayCycle(0), weather = sampleWeather(0), disposed = false;
  function update(activeSeconds: number, camera: THREE.Camera, target: Vec3) {
    if (disposed) return;
    state = sampleDayCycle(activeSeconds); weather = sampleWeather(activeSeconds);
    const { daylight, twilight, sunDirection, moonDirection } = state;
    root.position.copy(camera.position);
    photograph.update(daylight, weather.cloudiness, sunDirection);
    skyMaterial.uniforms.cloudiness.value = weather.cloudiness; skyMaterial.uniforms.rainAmount.value = weather.rain;
    skyMaterial.uniforms.weatherTime.value = options.reducedMotion ? 0 : activeSeconds; skyMaterial.uniforms.weatherDaylight.value = daylight;
    skyMaterial.uniforms.zenith.value.copy(nightZenith).lerp(dayZenith, daylight);
    skyMaterial.uniforms.horizon.value.copy(nightHorizon).lerp(dayHorizon, daylight).lerp(duskHorizon, twilight * .65);
    skyMaterial.uniforms.sunDirection.value.set(sunDirection.x, sunDirection.y, sunDirection.z); skyMaterial.uniforms.dusk.value = twilight;
    skyMaterial.uniforms.horizon.value.lerp(stormHorizon, weather.overcast * daylight * .48);
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = 280 - weather.rain * 180; scene.fog.far = 1700 - weather.rain * 800; }
    if (scene.background instanceof THREE.Color) scene.background.copy(skyMaterial.uniforms.horizon.value);
    if (scene.fog) scene.fog.color.copy(skyMaterial.uniforms.horizon.value);
    hemisphere.color.copy(nightSky).lerp(daySky, daylight); hemisphere.groundColor.copy(nightGround).lerp(dayGround, daylight);
    hemisphere.intensity = Math.max(.38, (.38 + .77 * daylight) * (1 - weather.overcast * .18));
    light.color.copy(moonLight).lerp(sunLight, daylight).lerp(duskLight, twilight * .65);
    light.intensity = Math.max(.28, (.28 + 2.92 * daylight) * (1 - weather.overcast * .72));
    // Follow the existing small player-centred shadow frustum. At night the moon lights it.
    const lit = sunDirection.y >= 0 ? sunDirection : moonDirection;
    direction.set(lit.x, Math.max(.12, lit.y), lit.z).normalize();
    light.target.position.set(target.x, target.y, target.z); light.position.copy(light.target.position).addScaledVector(direction, 360);
    for (const [object, d] of [[sun, sunDirection], [moon, moonDirection]] as const) {
      object.position.set(d.x, d.y, d.z).multiplyScalar(1500); object.quaternion.copy(camera.quaternion); object.visible = d.y > -.035;
    }
    glow.position.copy(sun.position); glow.quaternion.copy(camera.quaternion); glow.visible = sun.visible && weather.overcast < .85 && (photograph.uniforms.seoulPhotoWeight.value * photograph.uniforms.seoulPhotoReady.value) < .5;
    sun.visible = sun.visible && (photograph.uniforms.seoulPhotoWeight.value * photograph.uniforms.seoulPhotoReady.value) < .5;
    sunMaterial.color.set('#fff1bf').lerp(skyMaterial.uniforms.horizon.value, weather.overcast * .92);
    moonMaterial.color.set('#e4ecfa').lerp(skyMaterial.uniforms.horizon.value, weather.overcast * .88);
    rain.update(activeSeconds, camera, weather, daylight);
  }
  return { root, update, load: photograph.load, snapshot: () => ({ ...state, secondsPerDay: DAY_SECONDS, minutesPerSecond: 1, weather: { ...weather }, photograph: photograph.snapshot() }),
    dispose() { if (disposed) return; disposed = true; photograph.dispose(); rain.dispose(); root.removeFromParent(); dome.geometry.dispose(); skyMaterial.dispose(); discGeometry.dispose(); sunMaterial.dispose(); moonMaterial.dispose(); glow.geometry.dispose(); glowMaterial.dispose(); } };
}
