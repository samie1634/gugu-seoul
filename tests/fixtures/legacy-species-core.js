/* eslint-disable */
// Frozen generated pre-rebind core for historical regression comparison only.
import * as e from "three";
import { BufferAttribute as t, BufferGeometry as n, Color as r, Float32BufferAttribute as i, Group as a, Mesh as o, MeshStandardMaterial as s } from "three";
// appearance.ts
var c = Object.freeze([
	"pigeon",
	"sparrow",
	"crow",
	"magpie",
	"tawny-owl",
	"eagle-owl",
	"kestrel"
]), l = [
	{
		speciesId: "pigeon",
		skinId: "gray"
	},
	{
		speciesId: "pigeon",
		skinId: "white"
	},
	...c.filter((e) => e !== "pigeon").map((e) => ({
		speciesId: e,
		skinId: "default"
	}))
], u = Object.freeze(l.map((e) => Object.freeze(e)));
function d(e) {
	if (!e || typeof e != "object") throw RangeError("Missing appearance");
	let { speciesId: t, skinId: n } = e;
	if (!c.includes(t)) throw RangeError("Unsupported species");
	if (t === "pigeon") {
		if (n !== "default" && n !== "gray" && n !== "white") throw RangeError("Unsupported pigeon skin");
		return Object.freeze({
			speciesId: t,
			skinId: n === "default" ? "gray" : n
		});
	}
	if (n !== "default") throw RangeError("Only pigeon has alternate skins");
	return Object.freeze({
		speciesId: t,
		skinId: n
	});
}
function f(e) {
	if (e !== 0 && e !== 1 && e !== 2) throw RangeError("Unsupported bird LOD");
	return e;
}
function p(e) {
	if (e === "pigeon") return d({
		speciesId: "pigeon",
		skinId: "gray"
	});
	if (e === "white") return d({
		speciesId: "pigeon",
		skinId: "white"
	});
	if (e === "owl") return d({
		speciesId: "eagle-owl",
		skinId: "default"
	});
	throw RangeError("Unsupported legacy look");
}
// ../../../src/simulation.ts
var m = .65, h = {
	strideInLegHeights: 2.8,
	lift: .09,
	hop: !1,
	headReach: .14,
	headLift: .04,
	foldSweep: 1.24,
	foldSpan: .48,
	foldElevation: -.23,
	foldTwist: 1.38,
	flightSweep: .16,
	glideElevation: .13,
	flapSeconds: .33,
	flapDepth: .84,
	tailFlex: .13,
	callPitch: .19
}, g = {
	foldSweep: 1.55,
	foldElevation: -.18,
	foldTwist: 1.52
}, _ = {
	pigeon: h,
	sparrow: {
		...h,
		strideInLegHeights: 3.75,
		lift: .19,
		hop: !0,
		headReach: .037,
		headLift: .02,
		foldSpan: .62,
		flightSweep: .21,
		flapSeconds: .23,
		flapDepth: .92,
		tailFlex: .18,
		callPitch: .11
	},
	crow: {
		...h,
		strideInLegHeights: 3,
		lift: .1,
		headReach: .06,
		headLift: .025,
		foldSpan: .51,
		flightSweep: .2,
		glideElevation: .09,
		flapSeconds: .39,
		tailFlex: .19,
		callPitch: .14
	},
	magpie: {
		...h,
		strideInLegHeights: 2.8,
		lift: .12,
		headReach: .075,
		headLift: .033,
		foldSweep: 1.3,
		foldSpan: .58,
		glideElevation: .08,
		flapSeconds: .29,
		tailFlex: .21,
		callPitch: .12
	},
	"tawny-owl": {
		...h,
		...g,
		strideInLegHeights: 2.2,
		lift: .07,
		headReach: .009,
		headLift: .005,
		foldSpan: .43,
		flightSweep: .075,
		glideElevation: .2,
		flapSeconds: .38,
		flapDepth: .82,
		tailFlex: .08,
		callPitch: .07
	},
	"eagle-owl": {
		...h,
		...g,
		strideInLegHeights: 2.1,
		lift: .06,
		headReach: .006,
		headLift: .004,
		foldSpan: .4,
		flightSweep: .1,
		glideElevation: .22,
		flapSeconds: .42,
		flapDepth: .8,
		tailFlex: .065,
		callPitch: .06
	},
	kestrel: {
		...h,
		...g,
		strideInLegHeights: 2.35,
		lift: .08,
		headReach: .025,
		headLift: .013,
		foldSpan: .5,
		flightSweep: .025,
		glideElevation: .065,
		flapSeconds: .26,
		flapDepth: .69,
		tailFlex: .16,
		callPitch: .09
	}
}, v = 2 * Math.PI, { clamp: y, euclideanModulo: b, lerp: x } = e.MathUtils;
function S(e, t) {
	return e < .5 ? t / 4 * Math.cos(v * e) : t * (e - .75);
}
function C(t, n) {
	let r = t.parent;
	for (; r && r !== n;) r = r.parent;
	if (!r || !t.parent) throw Error("A bird pivot must be a descendant of its model root");
	let i = t.position.clone(), a = t.quaternion.clone(), o = t.scale.clone();
	t.matrixAutoUpdate || t.matrix.decompose(i, a, o);
	let s = t.parent.matrixWorld, c = new e.Quaternion().setFromRotationMatrix(new e.Matrix4().extractRotation(s)).normalize();
	return {
		pivot: t,
		position: i,
		rotation: a,
		scale: o,
		parentRotation: c,
		inverseParentRotation: c.clone().invert(),
		modelToParent: new e.Matrix3().setFromMatrix4(s.clone().invert())
	};
}
function w(t, n, r) {
	let i = _[t.species], a = t.metrics.standingHeightM, o = t.pivots;
	if (new Set(Object.values(o)).size !== 6) throw Error("Bird pivots must be six distinct groups");
	t.root.updateWorldMatrix(!1, !0);
	let s = C(o.head, t.root), c = C(o.leftWing, t.root), l = C(o.rightWing, t.root), u = C(o.tail, t.root), d = C(o.leftFoot, t.root), f = C(o.rightFoot, t.root), p = Math.min(o.leftFoot.matrixWorld.elements[13], o.rightFoot.matrixWorld.elements[13]), m = (p > 0 ? p : a * .2) * i.strideInLegHeights, h = m * r, g = new e.Vector3(), w = new e.Euler(0, 0, 0, "YZX"), T = new e.Quaternion();
	function E(e, t, n, r, i = 0, a = 0, o = 1) {
		g.set(0, t, n).applyMatrix3(e.modelToParent), T.setFromEuler(w.set(r, i, a));
		let s = e.pivot;
		s.position.copy(e.position).add(g), s.quaternion.copy(e.inverseParentRotation).multiply(T).multiply(e.parentRotation).multiply(e.rotation), s.scale.copy(e.scale), s.scale.x *= o, s.matrixAutoUpdate || s.updateMatrix();
	}
	return (e) => {
		let t = !e.reducedMotion, r = t && Number.isFinite(e.time) ? e.time % v : 0, o = i.foldSweep, p = i.foldSpan, g = i.foldElevation, _ = i.foldTwist, C = a * i.headLift * .22 * Math.sin(r * 2), w = 0, T = 0, D = 0, O = 0, k = 0, A = 0, j = 0, M = 0, N = 0;
		switch (e.mode) {
			case "walk": {
				if (!t) break;
				let n = b(Number.isFinite(e.steps) ? e.steps : 0, h) / h, r = v * n, o = Math.sin(r);
				if (i.hop) {
					let e = .35, t = y((n - e) / .65, 0, 1);
					O = a * i.lift * Math.sin(Math.PI * t) ** 2, A = M = n < e ? m * (n - e / 2) : m * e / 2 * Math.cos(Math.PI * t);
				} else k = a * i.lift * Math.max(0, o) ** 2, j = a * i.lift * Math.max(0, -o) ** 2, A = S(n, m), M = S((n + .5) % 1, m);
				C = a * i.headLift * Math.abs(o), w = -a * i.headReach * Math.sin(r * 2), D = i.tailFlex * (Math.cos(r * 2) - 1) / 2;
				break;
			}
			case "flap": {
				let n = Number.isFinite(e.flapAge) ? e.flapAge : 0, r = t ? y(n / i.flapSeconds, 0, 1) : .45, s = Math.sin(Math.PI * r) ** 2, c = y(r * 6, 0, 1);
				o = x(o, i.flightSweep + .22 * (1 - s), c), p = x(p, 1, c), g = x(g, x(.72, .11, r) - i.flapDepth * s, c), _ = x(_, -.14 + .29 * s, c), D = i.tailFlex * (.7 - s) * c, k = j = a * .09 * c, N = -.83 * c;
				break;
			}
			case "glide":
				p = 1, o = i.flightSweep, g = i.glideElevation + .027 * Math.sin(r * 3), _ = -.075, D = -i.tailFlex * .65, k = j = a * .095, N = -.9;
				break;
			case "fall": p = .75, o = i.flightSweep + .63, g = -.1 + .046 * Math.sin(r * 5), _ = .3, T = -.1, D = i.tailFlex * .55, k = j = a * .045, N = -.56;
		}
		let P = e.callAge ?? Infinity;
		t && P >= 0 && P < .9 && (T += i.callPitch * (1 - P / .9) * Math.sin(24 * P));
		let F = e.landing ?? 0, I = y(Number.isFinite(F) ? F : 0, 0, 1);
		p = x(p, 1, I), o = x(o, i.flightSweep + .26, I), g = x(g, .48 + i.glideElevation, I), _ = x(_, .28, I), C *= 1 - I, w *= 1 - I, T = x(T, .045, I), D = x(D, -.23 - i.tailFlex / 2, I), O *= 1 - I, k *= 1 - I, j *= 1 - I, A *= 1 - I, M *= 1 - I, N *= 1 - I, n.position.y = O, E(s, C, w, T), E(c, 0, 0, _, o, -g, p), E(l, 0, 0, _, -o, g, p), E(u, 0, 0, D), E(d, k, A, N), E(f, j, M, N);
	};
}
function T(t, n, r = {}) {
	let i = { ...t }, a = r.visualScale ?? 1;
	if (!Number.isFinite(a) || a <= 0) throw RangeError("Bird visual scale must be finite and positive");
	let o = new e.Group(), s = new e.Group();
	r.origin === "legacy-center" && (s.position.y = -m), s.scale.setScalar(a), o.add(s);
	let c = {
		mode: "rest",
		time: 0,
		flapAge: 0,
		steps: 0
	};
	function l(t) {
		let r = n({
			...i,
			lod: t
		});
		if (r.root.parent) throw Error("The bird factory must return a detached model");
		try {
			if (r.species !== i.species || r.lod !== t) throw Error("The bird factory returned the wrong species or LOD");
			if (r.metrics.footY !== 0 || !(r.metrics.standingHeightM > 0) || !Number.isFinite(r.metrics.standingHeightM)) throw Error("The bird model must use metres and a zero sole plane");
			if (!r.metrics.eye.every(Number.isFinite)) throw Error("The bird eye anchor must be finite");
			let n = new e.Group(), o = w(r, n, a), s = new e.Vector3(...r.metrics.eye), l = r.pivots.head.worldToLocal(r.root.localToWorld(s));
			return n.add(r.root), o(c), {
				model: r,
				stance: n,
				eyeInHead: l,
				pose: o
			};
		} catch (e) {
			throw r.root.removeFromParent(), r.dispose(), e;
		}
	}
	function u(e) {
		s.remove(e.stance), e.stance.remove(e.model.root), e.model.dispose();
	}
	let d = l(i.lod);
	s.add(d.stance);
	function f() {
		if (!d) throw Error("The bird rig has been disposed");
		return d;
	}
	return {
		root: o,
		get model() {
			return f().model;
		},
		pose(e) {
			f().pose(e), c.mode = e.mode, c.time = e.time, c.flapAge = e.flapAge, c.steps = e.steps, c.callAge = e.callAge, c.landing = e.landing, c.reducedMotion = e.reducedMotion;
		},
		setLod(e) {
			let t = f();
			if (t.model.lod === e) return;
			let n = l(e);
			s.add(n.stance), d = n, u(t);
		},
		getEyeWorldPosition(e) {
			let { model: t, eyeInHead: n } = f();
			return t.pivots.head.localToWorld(e.copy(n));
		},
		dispose() {
			if (!d) return;
			let e = d;
			d = void 0, o.remove(s), u(e);
		}
	};
}
// ../../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js
function E(e, t = !1) {
	let r = e[0].index !== null, i = new Set(Object.keys(e[0].attributes)), a = new Set(Object.keys(e[0].morphAttributes)), o = {}, s = {}, c = e[0].morphTargetsRelative, l = new n();
	l.morphTargetsRelative = c;
	let u = 0;
	for (let n = 0; n < e.length; ++n) {
		let d = e[n], f = 0, p = 0;
		if (r !== (d.index !== null)) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."), null;
		for (let e in d.attributes) {
			if (!i.has(e)) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". All geometries must have compatible attributes; make sure \"" + e + "\" attribute exists among all geometries, or in none of them."), null;
			o[e] === void 0 && (o[e] = []), o[e].push(d.attributes[e]), f++;
		}
		if (f !== i.size) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". Make sure all geometries have the same number of attributes."), null;
		if (c !== d.morphTargetsRelative) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". .morphTargetsRelative must be consistent throughout all geometries."), null;
		for (let t in d.morphAttributes) {
			if (!a.has(t)) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ".  .morphAttributes must be consistent throughout all geometries."), null;
			if (d.morphAttributes[t].length !== e[0].morphAttributes[t].length) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". All geometries must have the same number of morph targets for the \"" + t + "\" morph attribute."), null;
			s[t] === void 0 && (s[t] = []), s[t].push(d.morphAttributes[t]), p++;
		}
		if (p !== a.size) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". Make sure all geometries have the same number of morph attributes."), null;
		if (t) {
			let e;
			if (r) e = d.index.count;
			else if (d.attributes.position !== void 0) e = d.attributes.position.count;
			else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + n + ". The geometry must have either an index or a position attribute"), null;
			l.addGroup(u, e, n), u += e;
		}
	}
	if (r) {
		let t = 0, n = [];
		for (let r = 0; r < e.length; ++r) {
			let i = e[r].index;
			for (let e = 0; e < i.count; ++e) n.push(i.getX(e) + t);
			t += e[r].attributes.position.count;
		}
		l.setIndex(n);
	}
	for (let e in o) {
		let t = D(o[e]);
		if (!t) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the " + e + " attribute."), null;
		l.setAttribute(e, t);
	}
	for (let e in s) {
		let t = s[e][0].length;
		if (t !== 0) {
			l.morphAttributes = l.morphAttributes || {}, l.morphAttributes[e] = [];
			for (let n = 0; n < t; ++n) {
				let t = [];
				for (let r = 0; r < s[e].length; ++r) t.push(s[e][r][n]);
				let r = D(t);
				if (!r) return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the " + e + " morphAttribute."), null;
				l.morphAttributes[e].push(r);
			}
		}
	}
	return l;
}
function D(e) {
	let n, r, i, a = -1, o = 0;
	for (let t = 0; t < e.length; ++t) {
		let s = e[t];
		if (n === void 0 && (n = s.array.constructor), n !== s.array.constructor) return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."), null;
		if (r === void 0 && (r = s.itemSize), r !== s.itemSize) return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."), null;
		if (i === void 0 && (i = s.normalized), i !== s.normalized) return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."), null;
		if (a === -1 && (a = s.gpuType), a !== s.gpuType) return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."), null;
		o += s.count * r;
	}
	let s = new n(o), c = new t(s, r, i), l = 0;
	for (let t = 0; t < e.length; ++t) {
		let n = e[t];
		if (n.isInterleavedBufferAttribute) {
			let e = l / r;
			for (let t = 0, i = n.count; t < i; t++) for (let i = 0; i < r; i++) {
				let r = n.getComponent(t, i);
				c.setComponent(t + e, i, r);
			}
		} else s.set(n.array, l);
		l += n.count * r;
	}
	return a !== void 0 && (c.gpuType = a), c;
}
// ../../../src/native/ported/birds/urban/geometry.ts
var O = Math.PI * 2;
function k(t, n, r, i, a) {
	let o = (r - t) / 2, s = (i - n) / 2, c = a * a, l = c * a, u = (2 * l - 3 * c + 1) * n + (l - 2 * c + a) * o + (-2 * l + 3 * c) * r + (l - c) * s;
	return e.MathUtils.clamp(u, Math.min(n, r), Math.max(n, r));
}
function A(e, t) {
	let n = e[0], r = e[e.length - 1];
	if (t <= n[0]) return n;
	if (t >= r[0]) return r;
	let i = e.findIndex((e) => e[0] >= t) - 1, a = e[i], o = e[i + 1], s = (t - a[0]) / (o[0] - a[0]), c = e[Math.max(0, i - 1)], l = e[Math.min(e.length - 1, i + 2)], u = (e) => k(c[e] ?? 0, a[e] ?? 0, o[e] ?? 0, l[e] ?? 0, s);
	return [
		t,
		u(1),
		u(2),
		u(3),
		u(4)
	];
}
function j([e, t, n, r, i = 0], a) {
	return [
		i + r * Math.cos(a),
		(n + t) / 2 + (n - t) / 2 * Math.sin(a),
		e
	];
}
function M(e, t, n) {
	return j(A(e, t), n);
}
function N(t, n, r) {
	let i = new e.Vector3(...M(t, n, r + .005)).sub(new e.Vector3(...M(t, n, r - .005))), a = new e.Vector3(...M(t, n + 1e-4, r)).sub(new e.Vector3(...M(t, n - 1e-4, r)));
	return i.cross(a).normalize();
}
function P(t, n, r) {
	let i = new e.BufferGeometry();
	return i.setAttribute("position", new e.Float32BufferAttribute(t, 3)), i.setAttribute("color", new e.Float32BufferAttribute(n, 3)), i.setIndex(r), i.computeVertexNormals(), i;
}
var F = class {
	pieces = [];
	loft(t, { sides: n, subdivisions: r = 1, paint: i, transform: a, extraAngles: o = [] }) {
		let s = Array.from({ length: n }, (e, t) => t * O / n);
		for (let e of o) s.every((t) => Math.abs(t - e) > 1e-6) && s.push(e);
		s.sort((e, t) => e - t);
		let c = s.length, l = [], u = [], d = [], f = (e, t) => {
			let n = j(e, t);
			l.push(...a ? a(n) : n);
			let r = i(n, t, e[0]);
			u.push(r.r, r.g, r.b);
		}, p = [t[0]];
		for (let n = 1; n < t.length; n += 1) {
			let i = t[n - 1][0], a = t[n][0];
			for (let n = 1; n < r; n += 1) p.push(A(t, e.MathUtils.lerp(i, a, n / r)));
			p.push(t[n]);
		}
		f(p[0], 0);
		for (let e of p.slice(1, -1)) for (let t of s) f(e, t);
		let m = l.length / 3;
		f(p[p.length - 1], 0);
		for (let e = 0; e < c; e += 1) {
			let t = (e + 1) % c;
			d.push(0, 1 + t, 1 + e);
			for (let n = 0; n < p.length - 3; n += 1) {
				let r = 1 + n * c, i = r + c;
				d.push(r + e, r + t, i + e, r + t, i + t, i + e);
			}
			d.push(m - c + e, m - c + t, m);
		}
		this.pieces.push(P(l, u, d));
	}
	mark(e, t, n) {
		let r = [], i = [], a = [], o = (a, o) => {
			let s = n.z + n.halfDepth * a * Math.cos(o), [c, l] = M(e, s, n.angle + n.halfArc * a * Math.sin(o));
			r.push(t * (c + n.lift), l, s), i.push(n.color.r, n.color.g, n.color.b);
		}, s = (e, n, r) => {
			a.push(e, t === 1 ? r : n, t === 1 ? n : r);
		};
		o(0, 0);
		for (let e of [.52, 1]) for (let t = 0; t < n.sides; t += 1) o(e, t * O / n.sides);
		for (let e = 0; e < n.sides; e += 1) {
			let t = (e + 1) % n.sides, r = 1 + e, i = 1 + t, a = r + n.sides, o = i + n.sides;
			s(0, r, i), s(r, a, i), s(i, a, o);
		}
		this.pieces.push(P(r, i, a));
	}
	ellipsoid(t, n, r, i, a) {
		let o = new e.SphereGeometry(1, i, Math.max(4, i / 2));
		o.scale(...n), a && o.applyQuaternion(new e.Quaternion().setFromUnitVectors(new e.Vector3(0, 0, 1), a)), o.translate(...t), this.solid(o, r);
	}
	taper(t, n, r, i, a, o) {
		let s = new e.Vector3(...t), c = new e.Vector3(...n), l = c.clone().sub(s), u = new e.CylinderGeometry(i, r, l.length(), o);
		u.applyQuaternion(new e.Quaternion().setFromUnitVectors(new e.Vector3(0, 1, 0), l.normalize()));
		let d = s.lerp(c, .5);
		u.translate(d.x, d.y, d.z), this.solid(u, a);
	}
	finish() {
		let e = E(this.pieces);
		for (let e of this.pieces) e.dispose();
		if (this.pieces.length = 0, !e) throw Error("Unable to merge urban bird part");
		return e.computeBoundingBox(), e.computeBoundingSphere(), e;
	}
	solid(t, n) {
		t.deleteAttribute("uv");
		let r = new Float32Array(t.getAttribute("position").count * 3);
		for (let e = 0; e < r.length; e += 3) r[e] = n.r, r[e + 1] = n.g, r[e + 2] = n.b;
		t.setAttribute("color", new e.BufferAttribute(r, 3)), this.pieces.push(t);
	}
}, I = {
	pigeon: {
		body: [
			[
				-.114,
				.126,
				.126,
				0
			],
			[
				-.097,
				.083,
				.167,
				.038
			],
			[
				-.066,
				.058,
				.175,
				.054
			],
			[
				-.02,
				.047,
				.167,
				.059
			],
			[
				.034,
				.052,
				.147,
				.047
			],
			[
				.075,
				.065,
				.119,
				.031
			],
			[
				.104,
				.078,
				.102,
				.016
			],
			[
				.116,
				.086,
				.086,
				0
			]
		],
		neck: [
			[
				-.125,
				.148,
				.148,
				0
			],
			[
				-.118,
				.125,
				.18,
				.02
			],
			[
				-.104,
				.107,
				.2,
				.033
			],
			[
				-.082,
				.102,
				.202,
				.034
			],
			[
				-.056,
				.109,
				.177,
				.028
			],
			[
				-.031,
				.133,
				.133,
				0
			]
		],
		head: [
			[
				-.036,
				.015,
				.015,
				0
			],
			[
				-.03,
				.001,
				.036,
				.016
			],
			[
				-.016,
				-.009,
				.049,
				.026
			],
			[
				.003,
				-.012,
				.054,
				.031
			],
			[
				.021,
				-.007,
				.045,
				.025
			],
			[
				.035,
				.014,
				.014,
				0
			]
		],
		bill: [
			[
				-.064,
				.009,
				.009,
				0
			],
			[
				-.058,
				.006,
				.012,
				.0038
			],
			[
				-.044,
				.003,
				.019,
				.0061
			],
			[
				-.031,
				.002,
				.025,
				.009
			],
			[
				-.025,
				.013,
				.013,
				0
			]
		],
		headAt: [
			0,
			.171,
			-.093
		],
		eyeZ: -.015,
		eyeAngle: .24,
		eyeRadius: .0045,
		wingAt: [
			.034,
			.142,
			-.014
		],
		bodyLengthM: .33,
		wingSpan: .62,
		wingChord: .137,
		airfoil: [
			[
				-.12,
				.04,
				.04,
				0
			],
			[
				-.035,
				-.35,
				.48,
				.115
			],
			[
				.19,
				-.47,
				.49,
				.12
			],
			[
				.41,
				-.43,
				.47,
				.102
			],
			[
				.62,
				-.32,
				.41,
				.072
			],
			[
				.81,
				-.18,
				.32,
				.046
			],
			[
				.91,
				-.04,
				.23,
				.023
			],
			[
				.975,
				.19,
				.19,
				0
			]
		],
		primaryTips: [
			[.5, .94],
			[.61, .91],
			[.72, .83],
			[.82, .72],
			[.91, .59],
			[.97, .47],
			[1, .33],
			[.99, .24],
			[.95, .15]
		],
		tailAt: [
			0,
			.092,
			.093
		],
		tail: {
			length: .08,
			width: .076,
			graduation: .012,
			drop: .019
		},
		footAt: [
			.027,
			.054,
			.01
		],
		foot: {
			radius: .004,
			toeLength: .033,
			spread: .017,
			ankleZ: .007,
			cuffLength: .021
		}
	},
	sparrow: {
		body: [
			[
				-.048,
				.063,
				.063,
				0
			],
			[
				-.038,
				.044,
				.077,
				.016
			],
			[
				-.02,
				.031,
				.083,
				.0225
			],
			[
				.001,
				.028,
				.08,
				.024
			],
			[
				.022,
				.035,
				.068,
				.0185
			],
			[
				.037,
				.041,
				.057,
				.011
			],
			[
				.045,
				.047,
				.047,
				0
			]
		],
		head: [
			[
				-.021,
				.006,
				.006,
				0
			],
			[
				-.016,
				-.007,
				.018,
				.012
			],
			[
				-.007,
				-.01,
				.025,
				.017
			],
			[
				.003,
				-.013,
				.027,
				.018
			],
			[
				.013,
				-.01,
				.021,
				.0155
			],
			[
				.022,
				.002,
				.002,
				0
			]
		],
		bill: [
			[
				-.031,
				.002,
				.002,
				0
			],
			[
				-.027,
				0,
				.007,
				.0034
			],
			[
				-.02,
				-.004,
				.013,
				.0065
			],
			[
				-.014,
				-.005,
				.015,
				.0074
			],
			[
				-.01,
				.005,
				.005,
				0
			]
		],
		headAt: [
			0,
			.079,
			-.033
		],
		eyeZ: -.01,
		eyeAngle: .3,
		eyeRadius: .0026,
		wingAt: [
			.016,
			.068,
			-.007
		],
		bodyLengthM: .14,
		wingSpan: .215,
		wingChord: .048,
		airfoil: [
			[
				-.12,
				.02,
				.02,
				0
			],
			[
				-.035,
				-.33,
				.47,
				.12
			],
			[
				.2,
				-.4,
				.46,
				.13
			],
			[
				.44,
				-.37,
				.39,
				.107
			],
			[
				.65,
				-.26,
				.31,
				.08
			],
			[
				.82,
				-.12,
				.25,
				.05
			],
			[
				.91,
				0,
				.18,
				.026
			],
			[
				.965,
				.15,
				.15,
				0
			]
		],
		primaryTips: [
			[.48, .92],
			[.6, .88],
			[.71, .8],
			[.82, .7],
			[.9, .58],
			[.97, .45],
			[1, .31],
			[.98, .22],
			[.91, .14]
		],
		tailAt: [
			0,
			.046,
			.037
		],
		tail: {
			length: .039,
			width: .03,
			graduation: -.004,
			drop: .01
		},
		footAt: [
			.01,
			.035,
			.002
		],
		foot: {
			radius: .0016,
			toeLength: .016,
			spread: .009,
			ankleZ: .0035,
			cuffLength: .016
		}
	},
	crow: {
		body: [
			[
				-.156,
				.2,
				.2,
				0
			],
			[
				-.138,
				.143,
				.239,
				.049
			],
			[
				-.105,
				.111,
				.262,
				.068
			],
			[
				-.048,
				.084,
				.273,
				.081
			],
			[
				.019,
				.077,
				.247,
				.077
			],
			[
				.082,
				.091,
				.204,
				.057
			],
			[
				.133,
				.115,
				.173,
				.032
			],
			[
				.164,
				.132,
				.132,
				0
			]
		],
		neck: [
			[
				-.179,
				.239,
				.239,
				0
			],
			[
				-.164,
				.198,
				.278,
				.033
			],
			[
				-.144,
				.172,
				.308,
				.05
			],
			[
				-.114,
				.151,
				.303,
				.058
			],
			[
				-.083,
				.149,
				.282,
				.051
			],
			[
				-.056,
				.213,
				.213,
				0
			]
		],
		head: [
			[
				-.088,
				.033,
				.033,
				0
			],
			[
				-.074,
				.008,
				.068,
				.028
			],
			[
				-.046,
				-.007,
				.087,
				.045
			],
			[
				-.012,
				-.015,
				.089,
				.051
			],
			[
				.02,
				-.019,
				.072,
				.044
			],
			[
				.043,
				.016,
				.016,
				0
			]
		],
		bill: [
			[
				-.144,
				.006,
				.006,
				0
			],
			[
				-.131,
				.004,
				.024,
				.009
			],
			[
				-.112,
				.003,
				.042,
				.017
			],
			[
				-.092,
				.001,
				.055,
				.023
			],
			[
				-.069,
				-.004,
				.061,
				.028
			],
			[
				-.055,
				.027,
				.027,
				0
			]
		],
		headAt: [
			0,
			.276,
			-.133
		],
		eyeZ: -.047,
		eyeAngle: .25,
		eyeRadius: .0058,
		wingAt: [
			.043,
			.241,
			-.024
		],
		bodyLengthM: .565,
		wingSpan: 1.02,
		wingChord: .196,
		airfoil: [
			[
				-.1,
				.03,
				.03,
				0
			],
			[
				-.04,
				-.38,
				.53,
				.118
			],
			[
				.2,
				-.45,
				.51,
				.122
			],
			[
				.46,
				-.44,
				.44,
				.091
			],
			[
				.65,
				-.35,
				.32,
				.062
			],
			[
				.81,
				-.27,
				.21,
				.041
			],
			[
				.91,
				-.13,
				.14,
				.021
			],
			[
				.975,
				.06,
				.06,
				0
			]
		],
		primaryTips: [
			[.5, 1.05],
			[.64, 1.1],
			[.76, 1.01],
			[.86, .87],
			[.94, .68],
			[.99, .47],
			[1, .25],
			[.96, .056],
			[.89, -.088]
		],
		tailAt: [
			0,
			.139,
			.142
		],
		tail: {
			length: .146,
			width: .12,
			graduation: .02,
			drop: .038
		},
		footAt: [
			.036,
			.106,
			.01
		],
		foot: {
			radius: .0061,
			toeLength: .059,
			spread: .032,
			ankleZ: .016,
			cuffLength: .043
		}
	},
	magpie: {
		body: [
			[
				-.101,
				.147,
				.147,
				0
			],
			[
				-.086,
				.116,
				.19,
				.026
			],
			[
				-.058,
				.089,
				.201,
				.038
			],
			[
				-.018,
				.067,
				.184,
				.044
			],
			[
				.024,
				.07,
				.155,
				.036
			],
			[
				.058,
				.085,
				.129,
				.024
			],
			[
				.081,
				.091,
				.111,
				.014
			],
			[
				.095,
				.098,
				.098,
				0
			]
		],
		neck: [
			[
				-.108,
				.172,
				.172,
				0
			],
			[
				-.099,
				.145,
				.206,
				.023
			],
			[
				-.082,
				.132,
				.218,
				.027
			],
			[
				-.057,
				.128,
				.204,
				.03
			],
			[
				-.039,
				.158,
				.158,
				0
			]
		],
		head: [
			[
				-.035,
				.019,
				.019,
				0
			],
			[
				-.028,
				.001,
				.039,
				.019
			],
			[
				-.012,
				-.005,
				.053,
				.029
			],
			[
				.008,
				-.01,
				.055,
				.031
			],
			[
				.026,
				-.008,
				.042,
				.023
			],
			[
				.038,
				.01,
				.01,
				0
			]
		],
		bill: [
			[
				-.059,
				.011,
				.011,
				0
			],
			[
				-.051,
				.008,
				.015,
				.004
			],
			[
				-.04,
				.004,
				.024,
				.008
			],
			[
				-.027,
				.002,
				.029,
				.011
			],
			[
				-.02,
				.014,
				.014,
				0
			]
		],
		headAt: [
			0,
			.195,
			-.079
		],
		eyeZ: -.017,
		eyeAngle: .23,
		eyeRadius: .0041,
		wingAt: [
			.026,
			.16,
			-.014
		],
		bodyLengthM: .475,
		wingSpan: .55,
		wingChord: .131,
		airfoil: [
			[
				-.12,
				.04,
				.04,
				0
			],
			[
				-.035,
				-.35,
				.49,
				.118
			],
			[
				.19,
				-.46,
				.53,
				.111
			],
			[
				.43,
				-.42,
				.5,
				.091
			],
			[
				.63,
				-.27,
				.42,
				.068
			],
			[
				.8,
				-.15,
				.31,
				.04
			],
			[
				.9,
				-.028,
				.22,
				.02
			],
			[
				.965,
				.17,
				.17,
				0
			]
		],
		primaryTips: [
			[.49, .99],
			[.61, .96],
			[.72, .87],
			[.82, .75],
			[.9, .62],
			[.97, .49],
			[1, .34],
			[.985, .22],
			[.925, .12]
		],
		tailAt: [
			0,
			.099,
			.077
		],
		tail: {
			length: .26,
			width: .07,
			graduation: .103,
			drop: .039
		},
		footAt: [
			.024,
			.079,
			.008
		],
		foot: {
			radius: .0032,
			toeLength: .038,
			spread: .018,
			ankleZ: .012,
			cuffLength: .027
		}
	}
}, { lerp: L, smoothstep: R } = e.MathUtils, z = (t) => new e.Color(t), B = (t, n, r) => new e.Color().lerpColors(t, n, r), ee = z("#211e1d"), te = z("#eee8dc"), ne = z("#804832"), re = z("#4d765f"), ie = z("#71607c"), ae = z("#141518"), oe = z("#cdd4d6"), se = {
	pigeon: {
		back: "#788591",
		belly: "#aaadb2",
		head: "#68747e",
		coverts: "#939ca4",
		flight: "#535e68",
		tail: "#697681",
		sheen: "#353b43",
		bill: "#424245",
		foot: "#a56264",
		claw: "#56444a",
		iris: "#b57436",
		roughness: .58
	},
	white: {
		back: "#dfdcd3",
		belly: "#eee9de",
		head: "#ebe6dc",
		coverts: "#ebe9e1",
		flight: "#dad9d5",
		tail: "#ebe8df",
		sheen: "#c6c9cc",
		bill: "#a28280",
		foot: "#ad7175",
		claw: "#746168",
		iris: "#66504b",
		roughness: .72
	},
	sparrow: {
		back: "#a37755",
		belly: "#c7b9a5",
		head: "#ad8870",
		coverts: "#8b654d",
		flight: "#67503c",
		tail: "#705642",
		sheen: "#4e382c",
		bill: "#4d4038",
		foot: "#9c766d",
		claw: "#634e48",
		iris: "#4c352c",
		roughness: .78
	},
	crow: {
		back: "#2b3037",
		belly: "#242628",
		head: "#292d32",
		coverts: "#2a313c",
		flight: "#242931",
		tail: "#242a31",
		sheen: "#414e64",
		bill: "#27292c",
		foot: "#393839",
		claw: "#292929",
		iris: "#463a35",
		roughness: .53
	},
	magpie: {
		back: "#252b32",
		belly: "#eeece6",
		head: "#252b32",
		coverts: "#27343f",
		flight: "#263940",
		tail: "#2b4144",
		sheen: "#355d61",
		bill: "#292e31",
		foot: "#383737",
		claw: "#292829",
		iris: "#53433b",
		roughness: .52
	}
};
function ce(e) {
	return {
		back: z(e.back),
		belly: z(e.belly),
		head: z(e.head),
		coverts: z(e.coverts),
		flight: z(e.flight),
		tail: z(e.tail),
		sheen: z(e.sheen),
		bill: z(e.bill),
		foot: z(e.foot),
		claw: z(e.claw),
		iris: z(e.iris)
	};
}
var V = [
	{
		shell: 24,
		subdivisions: 3,
		details: 10,
		blade: 8,
		rows: 6,
		tail: 9
	},
	{
		shell: 16,
		subdivisions: 2,
		details: 8,
		blade: 6,
		rows: 5,
		tail: 7
	},
	{
		shell: 12,
		subdivisions: 1,
		details: 6,
		blade: 4,
		rows: 4,
		tail: 5
	}
], le = [-1, 1];
function ue(e, t, n, r, i) {
	let a = new F(), o = V[r];
	return a.loft(t.body, {
		sides: o.shell,
		subdivisions: o.subdivisions,
		extraAngles: e === "sparrow" ? [Math.PI / 4, 3 * Math.PI / 4] : [],
		paint: (t, r, i) => {
			let a = Math.sin(r);
			if (e === "sparrow") {
				let e = (1 - R(Math.min(...[
					Math.PI / 4,
					Math.PI / 2,
					3 * Math.PI / 4
				].map((e) => Math.abs(r - e - 1.5 * i))), .06, .22)) * R(i, -.035, -.019);
				return B(B(n.belly, n.back, R(a, -.23, .7)), n.sheen, e * .9);
			}
			if (e === "magpie") {
				let e = (1 - R(a, .06, .38)) * R(i, -.073, -.04) * (1 - R(i, .047, .075)), r = R(Math.abs(t[0]), .017, .03) * R(a, .37, .66) * R(i, -.051, -.027) * (1 - R(i, .032, .058));
				return B(n.back, n.belly, Math.max(e, r));
			}
			let o = B(n.belly, n.back, R(a, -.65, .65));
			return e === "crow" ? B(o, n.sheen, .44 * R(a, .1, .85)) : o;
		}
	}), t.neck && a.loft(t.neck, {
		sides: o.shell,
		subdivisions: o.subdivisions,
		paint: ([t, r], a, o) => {
			if (e !== "pigeon" || i) return B(n.head, n.back, .7 * (1 - R(Math.sin(a), -.5, .5)));
			let s = B(re, ie, R(r + .45 * o - .34 * Math.abs(t), .108, .143)), c = R(r, .115, .158) * (1 - R(o, -.067, -.039));
			return B(B(n.belly, n.head, R(r, .126, .161)), s, c * .94);
		}
	}), a.finish();
}
function de(t, n, r, i, a, o) {
	let s = i === 1 ? n.eyeAngle : Math.PI - n.eyeAngle, c = new e.Vector3(...M(n.head, n.eyeZ, s)), l = N(n.head, n.eyeZ, s), u = n.eyeRadius, d = V[a].details, f = (e) => c.clone().addScaledVector(l, e).toArray(), p = B(r.head, r.bill, .52);
	t.ellipsoid(f(0), [
		u * 1.1,
		u,
		u * .35
	], p, d, l), t.ellipsoid(f(u * .19), [
		u * .86,
		u * .84,
		u * .38
	], r.iris, d, l);
	let m = o ? .44 : .68;
	if (t.ellipsoid(f(u * .44), [
		u * m,
		u * m,
		u * .21
	], ae, d, l), a < 2) {
		let e = c.clone().addScaledVector(l, u * .63);
		e.y += u * .21, e.z -= u * .12, t.ellipsoid(e.toArray(), [
			u * .13,
			u * .13,
			u * .07
		], oe, 6, l);
	}
	return c;
}
function fe(t, n, r, i, a) {
	let o = new F(), s = V[i];
	if (o.loft(n.head, {
		sides: s.shell,
		subdivisions: s.subdivisions,
		paint: (e, n, i) => {
			let a = Math.sin(n);
			if (t === "sparrow") {
				let e = R(a, .05, .42), t = R(i, -.016, -.007) * (1 - R(i, .014, .021)) * R(Math.abs(Math.cos(n)), .38, .71) * (1 - R(a, 0, .32)), o = (1 - R(i, -.012, -.004)) * (1 - R(a, -.17, .15));
				return B(B(B(r.head, ne, e), te, t), ee, o);
			}
			return B(r.head, r.back, .34 * R(a, -.5, .75));
		}
	}), o.loft(n.bill, {
		sides: s.details,
		subdivisions: s.subdivisions,
		paint: (e, t) => {
			let n = Math.sin(t), i = z(a ? "#b6988e" : "#4d4d4e");
			return B(B(r.bill, i, .25 * R(n, .12, .9)), ee, .72 * (1 - R(Math.abs(n), 0, .29)));
		}
	}), t === "pigeon") {
		let e = z(a ? "#dfd2c5" : "#c8c3b6");
		o.ellipsoid([
			0,
			.019,
			-.033
		], [
			.0088,
			.0067,
			.0085
		], e, s.details);
	}
	let c = new e.Vector3();
	for (let e of le) {
		if (t === "sparrow" && o.mark(n.head, e, {
			z: .0065,
			angle: -.23,
			halfDepth: .0045,
			halfArc: .235,
			lift: 29e-5,
			sides: s.details,
			color: ee
		}), i < 2 && (t === "pigeon" || t === "crow")) {
			let r = n.bill[0][0], i = n.bill[n.bill.length - 1][0], a = L(r, i, t === "crow" ? .69 : .57), s = e === 1 ? .68 : Math.PI - .68, c = n.eyeRadius * .19;
			o.ellipsoid(M(n.bill, a, s), [
				c * 1.35,
				c * .68,
				c * .4
			], ae, 6, N(n.bill, a, s));
		}
		let l = de(o, n, r, e, i, t === "pigeon" && !a);
		e === 1 && (c = l);
	}
	return {
		geometry: o.finish(),
		eye: c.add(new e.Vector3(...n.headAt)).toArray()
	};
}
function pe(e, t, n, r, i, a, o, s = 0) {
	let c = n[0] - t[0], l = n[2] - t[2], u = Math.hypot(c, l), d = a === 0 ? [
		[
			u * .21,
			-i * .57,
			i * .85,
			r * .49
		],
		[
			u * .49,
			-i * .68,
			i,
			r
		],
		[
			u * .77,
			-i * .45,
			i * .72,
			r * .94
		],
		[
			u * .94,
			-i * .21,
			i * .35,
			r * .68
		]
	] : [
		[
			u * .24,
			-i * .57,
			i * .85,
			r * .61
		],
		[
			u * .63,
			-i * .58,
			i * .84,
			r
		],
		[
			u * .9,
			-i * .24,
			i * .39,
			r * .65
		]
	], f = Math.cos(s), p = Math.sin(s);
	e.loft([
		[
			0,
			0,
			0,
			0
		],
		...d,
		[
			u,
			0,
			0,
			0
		]
	], {
		sides: V[a].blade,
		paint: (e, t, n) => o(n / u, t),
		transform: ([e, r, i]) => {
			let a = e * f - r * p;
			return [
				t[0] + (l * a + c * i) / u,
				L(t[1], n[1], i / u) + e * p + r * f,
				t[2] + (-c * a + l * i) / u
			];
		}
	});
}
var me = (e, t, n, r) => R(e, t - r, t) * (1 - R(e, n, n + r));
function he(e, t, n, r, i) {
	let a = new F(), o = V[r], s = t.wingSpan / 2 - t.wingAt[0], c = t.wingChord, l = (e) => -.066 * e * e, u = e === "crow" || e === "magpie" ? .45 : .55, d = {
		pigeon: .62,
		sparrow: .68,
		crow: .59,
		magpie: .63
	}[e], f = (e) => c * (.088 + (e - .2) * (e < .2 ? u : d)), p = (e, t, n) => [
		s * e,
		c * t,
		f(n)
	], m = t.airfoil.map(([e, t, n, r]) => [
		e * s,
		(l(e) - r * .64) * c,
		(l(e) + r * .64) * c,
		(n - t) * c / 2,
		-(t + n) * c / 2
	]), h = [
		.39,
		.43,
		.51,
		.55,
		.665,
		.7,
		.78,
		.825
	].map((e) => Math.acos(1 - 2 * e)), g = [.47, .74].map((e) => 2 * Math.PI - Math.acos(1 - 2 * e));
	a.loft(m, {
		sides: o.shell,
		subdivisions: o.subdivisions,
		extraAngles: e === "pigeon" ? [...h, ...g] : [],
		transform: ([e, t, n]) => [
			n,
			t,
			f(-e / c)
		],
		paint: (t, r, a) => {
			let o = a / s, c = Math.sin(r), l = (1 - Math.cos(r)) / 2, u = B(n.flight, n.coverts, R(c, -.65, .7));
			if (e === "pigeon") {
				let e = Math.max(me(l, .43, .51, .04), me(l, .7, .78, .04)), t = B(u, n.coverts, .53), r = R(c, 0, .38) + .31 * R(-c, .08, .55);
				return B(t, n.sheen, e * r * (1 - R(o, .56, .8)) * (i ? .22 : .94));
			}
			if (e === "magpie") {
				let e = (1 - R(Math.hypot((o - .12) / .26, (l - .62) / .48), .7, 1)) * R(Math.abs(c), .1, .45) * (c < 0 ? .86 : 1);
				return B(B(u, n.sheen, .62 * R(c, -.25, .88)), n.belly, e);
			}
			if (e === "sparrow") {
				let e = me(l, .71, .83, .12) * (1 - R(o, .35, .66));
				return B(u, n.belly, e * .7 * R(c, 0, .8));
			}
			return B(u, n.sheen, .59 * R(c, .04, .9));
		}
	});
	let _ = (t, r, i, a) => {
		let o = (Math.sin(r) + 1) / 2, s = B(n.flight, n.coverts, .34 * (1 - t) + .18 * o).multiplyScalar(.91 + i % 3 * .045);
		if (e === "magpie") {
			let e = me(t, .24, .66, .17) * R(-Math.cos(r), -.06, .7);
			return B(B(s, n.sheen, .51 * o), n.belly, a ? e * .97 : 0);
		}
		return e === "crow" ? B(s, n.sheen, o * (.4 - .26 * t)) : B(s, n.sheen, R(t, .68, .98) * .52);
	};
	for (let e = 0; e < o.rows; e += 1) {
		let t = e / (o.rows - 1);
		pe(a, p(L(-.035, .42, t), -.022 - e % 3 * .003, L(.23, .29, t)), p(L(.02, .5, t), L(-.075, -.112, t), L(.83, .96, t)), s * .4 / o.rows, c * .016, r, (t, n) => _(t, n, e, !1));
	}
	let v = r === 0 ? [
		0,
		1,
		2,
		3,
		4,
		5,
		6,
		7,
		8
	] : r === 1 ? [
		0,
		1,
		3,
		4,
		5,
		6,
		8
	] : [
		0,
		2,
		4,
		6,
		8
	];
	for (let n of v) {
		let i = n / (t.primaryTips.length - 1), [o, s] = t.primaryTips[n], u = p(L(.36, .85, i), l(i) - n % 3 * .003, L(.29, .065, i)), d = p(o, L(-.117, -.087, i), s), f = e === "crow" ? .091 : .11, m = e === "crow" ? .17 : .25;
		pe(a, u, d, c * f * (1 + r * m) * (1 - .21 * i), c * .017, r, (e, t) => _(e, t, n, !0));
	}
	return a.finish();
}
function ge(e, t, n, r, i) {
	let a = new F(), { tail: o } = t, s = e === "magpie", c = V[r].tail + Number(s), l = s ? 1 / (c - 1) : 0;
	for (let t = 0; t < c; t += 1) {
		let u = 2 * t / (c - 1) - 1, d = Math.max(0, Math.abs(u) - l) / (1 - l), f = o.graduation < 0 ? 1 - d ** 2 : d ** 2, p = o.length - f * Math.abs(o.graduation), m = o.width * (s ? .99 : .83) / c, h = s ? -Math.sign(u) * L(.17, .41, d) : 0, g = s ? .0055 * (1 - d) : 0;
		pe(a, [
			u * o.width * .16,
			g,
			-.009
		], [
			u * o.width * .46,
			g - o.drop * (p / o.length) - .002 * d ** 2,
			p
		], m, o.width * (s ? .046 : .029), r, (t, r) => {
			let a = (Math.sin(r) + 1) / 2;
			return e === "pigeon" ? B(n.tail, n.sheen, R(t, .67, .83) * (i ? .34 : .91)) : B(n.tail, n.sheen, .56 * a * (1 - R(t, .72, .99)));
		}, h);
	}
	return a.finish();
}
function _e(e, t, n, r) {
	let i = new F(), { radius: a, toeLength: o, spread: s, ankleZ: c, cuffLength: l } = t.foot, u = -t.footAt[1], d = V[r].details, f = [
		0,
		u + a * 1.12,
		c
	], p = B(n.belly, n.back, e === "magpie" ? .92 : .35);
	i.ellipsoid([
		0,
		-.22 * l,
		.12 * c
	], [
		a * 1.84,
		.78 * l,
		a * 2.1
	], p, d), i.taper([
		0,
		a * 1.4,
		0
	], f, a * 1.03, a * .78, n.foot, d), i.ellipsoid([
		0,
		u + a * .93,
		c
	], [
		a * 1.38,
		a * .93,
		a * 1.75
	], n.foot, d);
	for (let e of [
		-1,
		0,
		1,
		2
	]) {
		let t = e === 2, r = e === 0 ? o : o * (t ? -.55 : .74), l = e === 0 ? 0 : s * (t ? -.35 : e), p = [
			l * .49,
			u + a * 1.02,
			c - r * .42
		], m = [
			l,
			u + a * .66,
			c - r * .84
		], h = [
			l * 1.07,
			u + a * .22,
			c - r
		];
		i.taper(f, p, a * .66, a * .55, n.foot, d), i.taper(p, m, a * .55, a * .33, n.foot, d), i.taper(m, h, a * .38, a * .08, n.claw, d);
	}
	return i.finish();
}
function ve({ species: t, lod: n, morph: r }) {
	if (t !== "pigeon" && t !== "sparrow" && t !== "crow" && t !== "magpie") throw RangeError("Unsupported urban bird species: " + String(t));
	if (n !== 0 && n !== 1 && n !== 2) throw RangeError("Unsupported urban bird LOD: " + String(n));
	let i = r === void 0 ? "default" : r;
	if (i !== "default" && (t !== "pigeon" || i !== "gray" && i !== "white")) throw RangeError("Unsupported morph for " + t + ": " + String(i));
	let a = t === "pigeon" && i === "default" ? "gray" : i, o = a === "white", s = I[t], c = se[o ? "white" : t], l = ce(c), u = new e.MeshStandardMaterial({
		vertexColors: !0,
		roughness: c.roughness
	});
	u.name = t + "-" + a + "-plumage";
	let d = new e.Group();
	d.name = t + "-" + a;
	let f = {
		geometries: [],
		materials: [u]
	}, p = !1;
	function m() {
		if (!p) {
			p = !0;
			for (let e of f.geometries) e.dispose();
			u.dispose();
		}
	}
	function h(t, n, r = 1) {
		let i = new e.Group();
		return i.name = t, i.position.set(r * n[0], n[1], n[2]), d.add(i), i;
	}
	function g(t, r, i, a = !1) {
		let o = new e.Mesh(r, u);
		o.name = i, o.scale.x = a ? -1 : 1, o.castShadow = n < 2 && (i === "body" || i === "leftWing" || i === "rightWing"), o.receiveShadow = !0, t.add(o);
	}
	function _(e) {
		return f.geometries.push(e), e;
	}
	try {
		let r = {
			head: h("head", s.headAt),
			leftWing: h("leftWing", s.wingAt, -1),
			rightWing: h("rightWing", s.wingAt),
			tail: h("tail", s.tailAt),
			leftFoot: h("leftFoot", s.footAt, -1),
			rightFoot: h("rightFoot", s.footAt)
		};
		g(d, _(ue(t, s, l, n, o)), "body");
		let i = fe(t, s, l, n, o);
		g(r.head, _(i.geometry), "head");
		let c = _(he(t, s, l, n, o));
		g(r.leftWing, c, "leftWing", !0), g(r.rightWing, c, "rightWing"), g(r.tail, _(ge(t, s, l, n, o)), "tail");
		let u = _(_e(t, s, l, n));
		g(r.leftFoot, u, "leftFoot", !0), g(r.rightFoot, u, "rightFoot");
		let p = new e.Box3().setFromObject(d, !0).getSize(new e.Vector3());
		return {
			species: t,
			lod: n,
			morph: a,
			root: d,
			pivots: r,
			metrics: {
				bodyLengthM: s.bodyLengthM,
				wingspanM: s.wingSpan,
				standingHeightM: p.y,
				footY: 0,
				eye: i.eye
			},
			resources: f,
			dispose: m
		};
	} catch (e) {
		throw m(), e;
	}
}
// ../../../src/native/ported/birds/raptors/mesh.ts
var H = 2 * Math.PI, U = (e, t, n) => e + (t - e) * n, ye = (e) => Math.max(0, Math.min(1, e)), W = (e, t, n) => {
	let r = ye((n - e) / (t - e));
	return r * r * (3 - 2 * r);
};
function G(e) {
	let { r: t, g: n, b: i } = new r(e);
	return [
		t,
		n,
		i
	];
}
function K(e, t, n) {
	return [
		U(e[0], t[0], n),
		U(e[1], t[1], n),
		U(e[2], t[2], n)
	];
}
function q(e, t) {
	return [
		ye(e[0] * t),
		ye(e[1] * t),
		ye(e[2] * t)
	];
}
function be(e, t) {
	return [
		e[0] + t[0],
		e[1] + t[1],
		e[2] + t[2]
	];
}
function xe(e, t) {
	return [
		e[0] - t[0],
		e[1] - t[1],
		e[2] - t[2]
	];
}
function Se(e, t) {
	return [
		e[0] * t,
		e[1] * t,
		e[2] * t
	];
}
function Ce(e, t) {
	return [
		e[1] * t[2] - e[2] * t[1],
		e[2] * t[0] - e[0] * t[2],
		e[0] * t[1] - e[1] * t[0]
	];
}
function we(e) {
	return Se(e, 1 / Math.hypot(...e));
}
var Te = class {
	positions = [];
	colors = [];
	indices = [];
	vertex(e, t) {
		let n = this.positions.length / 3;
		return this.positions.push(...e), this.colors.push(...t), n;
	}
	triangle(e, t, n, r = !1) {
		this.indices.push(e, r ? n : t, r ? t : n);
	}
	bridge(e, t, n = !1) {
		let r = Math.max(e.length, t.length);
		for (let i = 0; i < r; i += 1) {
			let a = (i + 1) % r;
			e.length > 1 && this.triangle(e[i], e[a], t[t.length === 1 ? 0 : a], n), t.length > 1 && this.triangle(e[e.length === 1 ? 0 : i], t[a], t[i], n);
		}
	}
	geometry(e = 1) {
		let t = new n(), r = new Float32Array(this.positions), a = this.indices.slice();
		if (e === -1) {
			for (let e = 0; e < r.length; e += 3) r[e] *= -1;
			for (let e = 0; e < a.length; e += 3) [a[e + 1], a[e + 2]] = [a[e + 2], a[e + 1]];
		}
		return t.setAttribute("position", new i(r, 3)), t.setAttribute("color", new i(this.colors, 3)), t.setIndex(a), t.computeVertexNormals(), t.computeBoundingBox(), t.computeBoundingSphere(), t;
	}
};
function Ee(e, t, n = 0, r = 1) {
	let i = Math.sin(n), a = Math.cos(n);
	return (n, o, s = 0) => {
		let c = Math.abs(o) >= Math.PI / 2 ? 0 : Math.cos(o), l = (t[0] + s) * c ** r * Math.sin(n), u = (t[1] + s) * Math.sin(o), d = -(t[2] + s) * c * Math.cos(n);
		return [
			e[0] + l,
			e[1] + u * a - d * i,
			e[2] + u * i + d * a
		];
	};
}
function De(e, t, n, r, i) {
	let a = [e.vertex(t(0, -Math.PI / 2), i(0, -Math.PI / 2))];
	for (let o = 1; o <= r; o += 1) {
		let s = Math.PI * (o / r - .5), c = o === r ? 1 : n, l = Array.from({ length: c }, (n, r) => {
			let a = H * r / c;
			return e.vertex(t(a, s), i(a, s));
		});
		e.bridge(a, l, !0), a = l;
	}
}
function Oe(e, t, n, r, i) {
	let a = [e.vertex(r(0, 0), i(0, 0))];
	for (let o of n) {
		let n = Array.from({ length: t }, (n, a) => {
			let s = H * a / t;
			return e.vertex(r(o, s), i(o, s));
		});
		e.bridge(a, n), a = n;
	}
}
function J(e, t, n, r = [
	1,
	0,
	0
], i = (e) => e, a = -Infinity) {
	let o;
	for (let s = 0; s < t.length; s += 1) {
		let [c, l, u, d] = t[s], f = t[Math.max(0, s - 1)][0], p = t[Math.min(s + 1, t.length - 1)][0], m = we(xe(p, f)), h = we(Ce(m, r)), g = Ce(h, m), _ = l === 0 && u === 0 ? 1 : n, v = Array.from({ length: _ }, (t, n) => {
			let r = H * n / _, o = be(c, be(Se(g, l * Math.cos(r)), Se(h, u * Math.sin(r))));
			return e.vertex([
				o[0],
				Math.max(a, o[1]),
				o[2]
			], i(d, r));
		});
		o ? e.bridge(o, v) : _ > 1 && e.bridge([e.vertex(c, d)], v), o = v, s === t.length - 1 && _ > 1 && e.bridge(v, [e.vertex(c, d)]);
	}
}
// ../../../src/native/ported/birds/raptors/anatomy.ts
var ke = (e) => Object.fromEntries(Object.entries(e.plumage).map(([e, t]) => [e, G(t)])), Ae = [
	[32, 20],
	[22, 14],
	[14, 9]
], je = G("#161314"), Me = G("#dacfc0"), Ne = G("#d7a34c");
function Pe(e, t, n) {
	return q(e, 1 + .075 * (Math.sin(7 * t + 3 * Math.sin(n * 8)) * Math.cos(12 * n) + .38 * Math.cos(22 * t - 19 * n)));
}
var Fe = (e, t) => {
	let n = Math.sin((e + 3) * 13.263 + (t + 8) * 21.53) * 43758.5453;
	return n - Math.floor(n);
};
function Ie(e, t, n, r, i, a, o, s, c, l, u, d = 0) {
	let f = (e, t) => {
		let n = e * Math.sin(t), r = e * Math.cos(t);
		return [a + (1 + d * .16 * Math.sin(5 * t + 8 * d)) * s * r * (.88 + .33 * n) + l * n + d * .024 * Math.sin(4 * n), o + c * n];
	};
	Oe(e, n, [.63, 1], (e, n) => t(...f(e, n), u), (e, t) => K(q(i, 1 + d * e * (.13 * Math.sin(6 * t + 2 * d) - .08 * Math.cos(3 * t))), r(...f(e, t)), W(.48 + d * .17, 1, e)));
}
function Le(e, t, n, r) {
	let i = new Te(), { center: a, radii: o, pitch: s } = t.body, c = Ee(a, o, s), l = e === "kestrel", u = e === "eagle-owl", d = (e, t, n) => {
		let [r, i, a] = c(e, t, n), s = W(.39, 1.48, t), u = l ? 1 - .13 * W(-.26, -1.4, t) : 1, d = l ? 0 : W(-.43, -1.49, t) * (.8 + .2 * Math.sin(e) ** 2);
		return [
			r * u * (1 + .12 * d) * (1 - (l ? .11 : .05) * s),
			i + s * (l ? .009 : o[1] * .037) - o[1] * .134 * d,
			a - s * (l ? .026 : o[2] * .075) - o[2] * .128 * d
		];
	}, f = (e, t) => {
		let r = -Math.cos(e) + .25 * Math.sin(t), i = K(K(n.breast, n.flank, W(-.91, .04, r)), n.back, W(-.14, .71, r)), a = W(.2, .92, Math.abs(Math.sin(e))) * W(-1.03, .2, t), o = (1 - W(.05, .69, t)) * W(.1, .84, Math.cos(e)), s = W(.18, .89, Math.cos((u ? 32 : 36) * t + 1.02 * Math.sin(8 * e) + .63 * Math.cos(21 * e))), c = l ? 0 : (.23 * a + .14 * o) * s, d = l ? 1 : 1 + .125 * Math.cos(16 * e + 2.2 * Math.sin(9 * t)) * Math.cos(21 * t - .6 * e);
		return Pe(q(K(i, n.ink, c), d), e, t);
	};
	De(i, d, Ae[r][0], Ae[r][1], f);
	let p = o[0] * .027, m = [
		10,
		7,
		5
	][r], h = u ? [
		4,
		4,
		3
	][r] : [
		5,
		4,
		3
	][r], g = r === 0 ? 7 : 5;
	for (let e = 0; e < h; e += 1) {
		let t = 1.38 / (h - 1), a = .66 - e * t;
		for (let o = 0; o < g; o += 1) {
			let s = Fe(e, o), c = Fe(o + 4, e + 1), h = Fe(e + 10, o + 6);
			if (!l && r === 0 && s < .14 && Math.abs(o - 3) > 1) continue;
			let _ = (o - (g - 1) * .5) * 2.36 / g + (e % 2 ? .12 : -.072), v = _ + (s - .5) * (l ? .071 : .132), y = a + (c - .5) * t * (l ? .09 : .13), b = l ? .74 + .15 * h : (u ? .59 : .42) + .34 * h, x = Math.min(.425 * t, (u ? .221 : l ? .114 : .143) * (.6 + .64 * c)), S = (u ? .073 : l ? .092 : .046) * (.67 + .75 * s);
			Ie(i, d, m, f, K(f(v, y), n.ink, b), v, y, S, x, .081 * _ + (h - .5) * (l ? .052 : .091), p, l ? 0 : .37 + .58 * c);
		}
	}
	let _ = r === 0 ? 3 : 2, v = r === 2 ? 3 : 5;
	for (let e = 0; e < _; e += 1) for (let t = 0; t < v; t += 1) {
		let a = Math.PI + (t - (v - 1) * .5) * 2.27 / v + (e % 2 ? .23 : -.11), o = -.54 + e * (1.09 / (_ - 1)) + .11 * Math.cos(t * 4.4 + e), s = K(n.ink, n.back, l ? .06 : .33), c = Fe(t + 5, e + 7);
		Ie(i, d, r === 2 ? 4 : m, f, s, a, o, l ? .128 : .094 + .039 * c, l ? .15 : .16 + .1 * c, .067 * Math.sin(a * 6 + o), p, l ? 0 : .24 + .61 * c);
	}
	return i;
}
function Re(e, t, n, r, i) {
	let a = (e, t) => {
		let n = e * (1 + W(.65, 1, e) * (.018 * Math.sin(11 * t) + .01 * Math.cos(23 * t))), r = n * Math.cos(t), i = n * Math.sin(t), a = Math.max(0, i) * .19 * Math.exp(-10 * r * r);
		return [1.17 * r * (.94 + i * .08), -.09 + .96 * i - a];
	};
	Oe(e, [
		40,
		32,
		22
	][r], [
		.24,
		.48,
		.69,
		.79,
		.88,
		.95,
		1
	], (e, n) => t(...a(e, n), .0018), (e, t) => {
		let [r, o] = a(e, t), s = Math.atan2(o - .1, Math.abs(r) - .51), c = .105 * Math.cos(19 * s + .78 * Math.sin(6 * s)) * W(.2, .84, e), l = K(n.face, n.breast, .29 + .17 * Math.sin(t)), u = W(.64, .9, e) * (1 - W(.88, 1, e));
		return K(q(K(l, n.rim, u * (.57 + .2 * Math.cos(6 * t))), 1 + c), i(r, o), W(.88, 1, e));
	});
}
function ze(e, t, n, r, i) {
	for (let a of [-1, 1]) Oe(e, [
		22,
		16,
		10
	][r], [
		.36,
		.72,
		.9,
		1
	], (e, n) => {
		let r = e * Math.cos(n), i = e * Math.sin(n);
		return t(a * .52 + .47 * r, -.095 + .65 * i + .22 * a * r, .0022);
	}, (e, t) => {
		let r = e * Math.cos(t), o = e * Math.sin(t);
		return K(q(n.face, 1 + .1 * o + .092 * Math.cos(13 * t + .55 * a)), i(a * .52 + .47 * r, -.095 + .65 * o + .22 * a * r), W(.6, 1, e));
	}), Ie(e, t, [
		16,
		12,
		8
	][r], i, K(n.breast, n.face, .46), a * .52, .37, .39, .065, a * .31, .0036);
}
function Be(e, t, n, r, i) {
	for (let a of [-1, 1]) Ie(e, t, [
		20,
		16,
		12
	][r], i, K(n.face, n.breast, .28), 1.11 * a, -.36, .71, .62, -.16 * a, .0011), Ie(e, t, [
		13,
		10,
		8
	][r], i, n.rim, .92 * a, -.3, .215, .5, -.12 * a, .0019);
}
function Ve(e, t, n, r, i) {
	let a = n === "kestrel", o = n === "eagle-owl", s = a ? 1.06 : o ? .5 : .52, c = a ? .075 : o ? .1 : .12, l = a ? .233 : o ? .206 : .196, u = a ? .191 : o ? .189 : .195, d = a ? .0021 : o ? .0042 : .0035, f = a ? .0014 : o ? .0039 : .0023, p = G(o ? "#d97724" : a ? "#443123" : "#30211e"), m = G(o ? "#a24514" : a ? "#2e221e" : "#221815");
	for (let n of [-1, 1]) {
		let h = n * s;
		Oe(e, [
			24,
			16,
			10
		][i], [
			.43,
			.51,
			.67,
			.82,
			.94,
			1
		], (e, n) => t(h + l * e * Math.cos(n), c + u * e * Math.sin(n), d + f * (1 - e * e)), (e, t) => {
			let n = K(p, m, W(.66, .89, e)), i = 1 + .13 * Math.sin(t - .4) + (o ? .09 * Math.cos(17 * t) : 0);
			if (e >= .94) return a ? q(Ne, 1.04 - (e === 1 ? .23 : 0)) : K(m, r.rim, e === 1 ? .95 : .5);
			let s = o ? .47 : .56;
			return K(je, q(n, i), W(s - .035, s + .048, e));
		}), Oe(e, [
			10,
			8,
			6
		][i], [1], (e, n) => t(h - l * .22 + l * .13 * e * Math.cos(n), c + u * .28 + u * .115 * e * Math.sin(n), d + f * 1.04), () => q(Me, .88));
	}
	let h = t(s, c, d + f);
	return [
		0,
		h[1],
		h[2]
	];
}
function He(e, t, n, r) {
	let i = [
		12,
		8,
		6
	][r], a = (e, t) => q(e, .94 - .17 * Math.sin(t) + .085 * Math.cos(2 * t));
	if (t === "kestrel") {
		J(e, [
			[
				[
					0,
					-.001,
					-.039
				],
				.011,
				.009,
				q(Ne, .78)
			],
			[
				[
					0,
					0,
					-.048
				],
				.01,
				.008,
				Ne
			],
			[
				[
					0,
					-.004,
					-.056
				],
				.0084,
				.006,
				n.horn
			],
			[
				[
					0,
					-.01,
					-.062
				],
				.005,
				.004,
				q(n.horn, .9)
			],
			[
				[
					0,
					-.017,
					-.064
				],
				.0025,
				.0023,
				q(n.horn, .76)
			],
			[
				[
					0,
					-.024,
					-.061
				],
				0,
				0,
				q(n.horn, .69)
			]
		], i, [
			1,
			0,
			0
		], a);
		return;
	}
	let o = t === "eagle-owl", s = o ? 1.52 : 1, c = o ? -.084 : -.063;
	J(e, [
		[
			[
				0,
				-.018 * s,
				c + .009
			],
			.013 * s,
			.013 * s,
			n.rim
		],
		[
			[
				0,
				-.021 * s,
				c - .005
			],
			.011 * s,
			.01 * s,
			n.horn
		],
		[
			[
				0,
				-.029 * s,
				c - .016 * s
			],
			.007 * s,
			.007 * s,
			n.horn
		],
		[
			[
				0,
				-.039 * s,
				c - .021 * s
			],
			.004 * s,
			.0035 * s,
			q(n.horn, .86)
		],
		[
			[
				0,
				-.049 * s,
				c - .019 * s
			],
			0,
			0,
			q(n.horn, .74)
		]
	], i, [
		1,
		0,
		0
	], a);
}
function Ue(e, t, n) {
	let r = [
		10,
		7,
		5
	][n];
	for (let i of [-1, 1]) J(e, [
		[
			[
				i * .07,
				.076,
				-.005
			],
			.029,
			.02,
			t.crown
		],
		[
			[
				i * .081,
				.114,
				-.006
			],
			.025,
			.013,
			K(t.ink, t.crown, .47)
		],
		[
			[
				i * .1,
				.153,
				.002
			],
			.014,
			.006,
			K(t.ink, t.crown, .34)
		],
		[
			[
				i * .125,
				.187,
				.015
			],
			0,
			0,
			t.ink
		]
	], r, [
		1,
		0,
		0
	], (e, n) => K(e, t.face, .47 * W(-.13, .94, -Math.sin(n) - .22 * i * Math.cos(n)))), n < 2 && J(e, [
		[
			[
				i * .066,
				.083,
				-.016
			],
			.017,
			.011,
			t.crown
		],
		[
			[
				i * .073,
				.122,
				-.018
			],
			.011,
			.006,
			K(t.crown, t.face, .33)
		],
		[
			[
				i * .087,
				.155,
				-.009
			],
			0,
			0,
			t.ink
		]
	], r, [
		1,
		0,
		0
	], (e, n) => K(e, t.face, .22 * W(-.24, .85, -Math.sin(n))));
}
function We(e, t, n, r) {
	let i = new Te(), { center: a, radii: o, pitch: s, crown: c } = t.head, l = Ee(a, o, s, c), u = (t, r) => {
		let i = W(-.1, -.73, r) * W(-.5, .47, Math.cos(t)), a = W(-.13, .66, r) * W(-.43, .85, Math.cos(t)), o = e === "kestrel" ? .14 : .42, s = W(.32, .95, Math.cos(18 * t + 1.2 * Math.sin(15 * r)) * Math.cos(19 * r + 3 * t));
		return Pe(K(K(n.crown, n.flank, o * s * (.6 + .4 * a)), n.face, i * .61), t + .14, r);
	};
	De(i, l, Ae[r][0], Ae[r][1], u), e === "tawny-owl" ? Re(i, l, n, r, u) : e === "eagle-owl" ? (ze(i, l, n, r, u), Ue(i, n, r)) : Be(i, l, n, r, u);
	let d = Ve(i, l, e, n, r);
	return He(i, e, n, r), {
		part: i,
		eye: d
	};
}
// ../../../src/native/ported/birds/raptors/flight.ts
var Ge = G("#333039"), Ke = G("#758692"), qe = G("#2b2932");
function Je(e) {
	let { stations: t, pivot: n, scallop: r } = e.wing, i = e.wingspan * .5 - n[0];
	return (e, n, a, o = 0) => {
		let s = t.findIndex((t) => t[0] >= e), c = t[Math.max(0, s - 1)], l = t[Math.max(0, s)], u = c === l ? 0 : (e - c[0]) / (l[0] - c[0]), d = (e) => U(c[e], l[e], u), f = .28 + .72 * W(.5, .84, e), p = Math.sin(H * (e * 4.8 + .08 * Math.sin(7 * e))) ** 2, m = d(2) - r * p * f * W(.09, .34, e) * (1 - W(.9, .99, e)), h = Math.max(0, Math.sin(Math.PI * n)), g = d(4) * (1 - .54 * n) * h ** .86, _ = d(3) + a * (g * (a === 1 ? 1 : .63) + o);
		return [
			i * e,
			_,
			U(d(1), m, n)
		];
	};
}
function Ye(e, t) {
	return (n, r, i) => {
		let a = e === "kestrel", o = K(i === 1 ? K(t.back, t.flank, .2) : K(t.breast, t.flank, .22), i === 1 ? t.flight : t.breast, W(.24, .66, r) * .53), s = W(.13, .74, Math.sin(H * (r * (a ? 2.6 : 3.8) - n * .83))), c = K(o, t.ink, s * (a ? .22 : .36) * W(.19, .82, r)), l = W(.48, .95, n + .22 * r), u = W(.72, 1, r);
		return q(K(c, a ? Ge : t.flight, ye(a ? .92 * l + .46 * u : l * .26 + u * .48)), .98 + .065 * Math.sin(17 * n + 11 * r));
	};
}
function Xe(e, t, n, r, i, a, o, s, c, l, u, d, f, p, m) {
	let h = a === 0 ? [
		0,
		.18,
		.33,
		.46,
		.58,
		.71,
		.82,
		.92,
		1
	] : a === 1 ? [
		0,
		.3,
		.49,
		.64,
		.79,
		.91,
		1
	] : [
		0,
		.49,
		.78,
		1
	], g = m === "kestrel", _;
	for (let m of h) {
		let h = U(o, s, m) + .013 * Math.sin(Math.PI * m), v = U(c, l, m), y = u * (.18 + .82 * Math.sin(Math.PI * m ** 1.29) ** .58), b = [
			-1,
			0,
			1
		].map((o) => {
			let s = h + y * o, c = v - .043 * m * Math.abs(o), l = n(s, c, i), u = W(.12, .87, Math.cos(H * (m * (f ? 1.08 : 3.1) + p))), _ = g && f ? .8 * W(.44, .8, m) * (1 - W(.84, 1, m)) : (g ? .17 : .41) * u * W(.14, .55, m), b = a === 2 ? .039 : .095, x = q(K(l, r.ink, _ * (a === 2 ? .51 : 1)), 1 + b * (o === 0 ? 1 : o < 0 ? -1.35 : -.35));
			return e.vertex(t(s, c, i, d * (o === 0 ? 1.3 : .76)), x);
		});
		if (_) for (let t = 0; t < 2; t += 1) e.triangle(_[t], b[t], b[t + 1], i === -1), e.triangle(_[t], b[t + 1], _[t + 1], i === -1);
		_ = b;
	}
}
function Ze(e, t, n, r) {
	let i = new Te(), a = Je(t), o = Ye(e, n), s = [
		44,
		24,
		12
	][r], c = [
		24,
		16,
		10
	][r], l = t.wing.stations[0], u = [i.vertex([
		-t.wingspan * .018,
		0,
		(l[1] + l[2]) * .5
	], n.back)];
	for (let e = 0; e <= s; e += 1) {
		let t = e / s, n = e === s ? 1 : c, r = Array.from({ length: n }, (e, r) => {
			let s = H * r / n, c = (1 - Math.cos(s)) * .5, l = s <= Math.PI ? 1 : -1;
			return i.vertex(a(t, c, l), o(t, c, l));
		});
		i.bridge(u, r), u = r;
	}
	let d = e === "kestrel", f = t.wingspan * [
		9e-4,
		.0018,
		.0024
	][r], p = [
		18,
		11,
		5
	][r];
	for (let t = 0; t < p; t += 1) {
		let s = .098 + .852 * t / (p - 1), c = s * (d ? .73 : .79), l = (d ? .36 : .41) / p * (1 - .25 * s), u = t * .031 + .067 * Math.sin(t * 1.73);
		Xe(i, a, o, n, 1, r, c, s, .36 - .11 * s, .985, l, f, !1, u, e), r < 2 && Xe(i, a, o, n, -1, r, c, s, .36 - .11 * s, .985, l, f * 1.09, !1, u + .12, e);
	}
	if (r < 2) {
		let t = r === 0 ? 11 : 8;
		for (let s = 0; s < t; s += 1) {
			let c = .085 + s / (t - 1) * (d ? .59 : .79);
			Xe(i, a, o, n, 1, r, c * .87, c, .1, .51, (d ? .3 : .35) / t, f * 1.38, !0, s * .076, e);
		}
	}
	return i;
}
function Qe(e, t, n, r) {
	let i = new Te(), { lengthZ: a, endY: o, halfWidth: s, edgeShortening: c } = t.tail, l = e === "kestrel", u = [
		9,
		7,
		5
	][r], d = l ? [
		0,
		.33,
		.63,
		.758,
		.793,
		.93,
		.968,
		1
	] : r === 2 ? [
		0,
		.38,
		.49,
		.66,
		.8,
		1
	] : [
		0,
		.23,
		.34,
		.46,
		.54,
		.67,
		.75,
		.89,
		.96,
		1
	];
	for (let e = 0; e < u; e += 1) {
		let t = 2 * e / (u - 1) - 1, f = Math.abs(t), p = 1 - c * f ** (l ? 1.4 : 2.2);
		J(i, d.map((e) => {
			let i = s * t * U(.31, .78, e ** .74), c = o * e - s * .082 * f * e, d = a * p * e, m = 1.13 / u * s * (e === 1 ? .75 : U(.8, 1.22, Math.sin(Math.PI * e ** 1.12))), h = s * (e === 1 ? .011 : U(.071, .019, e)), g;
			if (l) g = K(Ke, qe, W(.758, .793, e) * (1 - W(.93, .968, e))), e >= .968 && (g = K(g, n.face, W(.968, 1, e) * .64));
			else {
				let t = r === 2 ? e === .49 || e === .8 ? 1 : .2 : W(-.17, .79, Math.cos(H * (3.8 * e - .285 + .055 * f)));
				g = K(K(n.flight, n.flank, .41), n.ink, t * .79);
			}
			return [
				[
					i,
					c,
					d
				],
				m,
				h,
				q(g, 1.04 - .16 * f)
			];
		}), [
			8,
			6,
			4
		][r], [
			1,
			0,
			0
		], (e, t) => q(e, .89 + .14 * Math.sin(t)));
	}
	return i;
}
function $e(e, t, n, r) {
	let i = new Te(), { pivot: a, reach: o, spread: s, thickness: c } = t.foot, l = -a[1], u = e === "kestrel", d = u ? n.feet : K(n.feet, n.horn, .29), f = [
		8,
		6,
		4
	][r], p = K(n.flank, n.breast, u ? .35 : .46), m = [
		[
			[
				u ? 0 : -.44 * c,
				a[1] * .28,
				.007
			],
			c * (u ? 3.03 : 2.77),
			c * (u ? 2.16 : 2.58),
			p
		],
		[
			[
				u ? 0 : -.2 * c,
				-a[1] * (u ? .46 : .34),
				.005
			],
			c * (u ? 1.23 : 2.11),
			c * (u ? 1.19 : 1.88),
			p
		],
		[
			[
				u ? 0 : .08 * c,
				l + c * (u ? 1.3 : 1.57),
				-c * .11
			],
			c * (u ? 1.34 : 1.43),
			c * (u ? 1.39 : 1.51),
			u ? n.feet : K(p, n.feet, .27)
		],
		[
			[
				0,
				l + c * .7,
				-c * .69
			],
			c * 1.23,
			c * .93,
			d
		]
	];
	u && m.splice(2, 0, [
		[
			0,
			-a[1] * .51,
			.003
		],
		c * .96,
		c * .94,
		n.feet
	]), J(i, m, [
		10,
		7,
		5
	][r], [
		1,
		0,
		0
	], (e, t) => q(e, .94 + .065 * Math.cos(t) + (u ? 0 : .068 * Math.sin(4 * t) - .055 * Math.cos(2 * t))), l);
	let h = u ? [
		[-.72, -.74],
		[.02, -1],
		[.78, -.67],
		[.21, .7]
	] : [
		[-.77, -.74],
		[.52, -1],
		[.94, .47],
		[-.59, .64]
	], g = q(n.horn, .82);
	for (let e = 0; e < h.length; e += 1) {
		let [t, a] = h[e], u = (e, n) => [
			t * s * e,
			l + n,
			a * o * e - c * .36
		], p = c * (e === 1 ? .81 : .68), m = [
			[
				u(.04, c * 1.16),
				p,
				c * .77,
				d
			],
			[
				u(.44, c * .59),
				p * .96,
				c * .85,
				n.feet
			],
			[
				u(.72, c * .71),
				p * .77,
				c * .56,
				d
			],
			[
				u(.94, c * .87),
				p * .51,
				c * .5,
				g
			],
			[
				u(1.15, c * .14),
				0,
				0,
				g
			]
		];
		r === 0 && (m.splice(3, 0, [
			u(.83, c * .76),
			p * .64,
			c * .52,
			d
		]), m.splice(-1, 0, [
			u(1.055, c * .57),
			p * .32,
			c * .3,
			g
		])), J(i, m, f, [
			1,
			0,
			0
		], (e, t) => q(e, .92 + .13 * Math.sin(t)), l);
	}
	return i;
}
// ../../../src/native/ported/birds/raptors/profiles.ts
var et = {
	"tawny-owl": {
		bodyLength: .38,
		wingspan: .99,
		height: .347,
		body: {
			center: [
				0,
				.168,
				.022
			],
			radii: [
				.084,
				.132,
				.102
			],
			pitch: -.38
		},
		head: {
			pivot: [
				0,
				.267,
				-.062
			],
			center: [
				0,
				.006,
				-.006
			],
			radii: [
				.079,
				.074,
				.069
			],
			pitch: -.02
		},
		wing: {
			pivot: [
				.065,
				.213,
				.003
			],
			scallop: .007,
			stations: [
				[
					0,
					-.043,
					.09,
					0,
					.019
				],
				[
					.16,
					-.075,
					.13,
					.012,
					.024
				],
				[
					.36,
					-.088,
					.155,
					.015,
					.024
				],
				[
					.58,
					-.078,
					.158,
					.01,
					.02
				],
				[
					.76,
					-.054,
					.138,
					.002,
					.014
				],
				[
					.89,
					-.02,
					.11,
					-.009,
					.01
				],
				[
					.96,
					.012,
					.081,
					-.02,
					.005
				],
				[
					1,
					.048,
					.048,
					-.027,
					0
				]
			]
		},
		tail: {
			pivot: [
				0,
				.117,
				.061
			],
			lengthZ: .116,
			endY: -.056,
			halfWidth: .06,
			edgeShortening: .12
		},
		foot: {
			pivot: [
				.039,
				.071,
				.015
			],
			reach: .046,
			spread: .026,
			thickness: .0066
		},
		plumage: {
			back: "#635347",
			flank: "#a18b77",
			breast: "#c1ae96",
			ink: "#533c31",
			crown: "#69564a",
			face: "#b39a7f",
			rim: "#503b33",
			flight: "#6a5348",
			feet: "#a48c76",
			horn: "#515456"
		}
	},
	"eagle-owl": {
		bodyLength: .66,
		wingspan: 1.66,
		height: .661,
		body: {
			center: [
				0,
				.303,
				.026
			],
			radii: [
				.137,
				.228,
				.167
			],
			pitch: -.32
		},
		head: {
			pivot: [
				0,
				.474,
				-.108
			],
			center: [
				0,
				.011,
				.001
			],
			radii: [
				.12,
				.11,
				.092
			],
			pitch: -.04,
			crown: .78
		},
		wing: {
			pivot: [
				.115,
				.362,
				.008
			],
			scallop: .015,
			stations: [
				[
					0,
					-.084,
					.154,
					0,
					.034
				],
				[
					.14,
					-.128,
					.227,
					.018,
					.042
				],
				[
					.34,
					-.149,
					.267,
					.023,
					.038
				],
				[
					.59,
					-.132,
					.276,
					.01,
					.029
				],
				[
					.77,
					-.092,
					.241,
					-.005,
					.021
				],
				[
					.88,
					-.052,
					.191,
					-.019,
					.015
				],
				[
					.96,
					-.002,
					.119,
					-.034,
					.008
				],
				[
					1,
					.052,
					.052,
					-.039,
					0
				]
			]
		},
		tail: {
			pivot: [
				0,
				.235,
				.112
			],
			lengthZ: .194,
			endY: -.155,
			halfWidth: .103,
			edgeShortening: .08
		},
		foot: {
			pivot: [
				.067,
				.112,
				.027
			],
			reach: .077,
			spread: .043,
			thickness: .013
		},
		plumage: {
			back: "#735039",
			flank: "#a6805c",
			breast: "#ccaa81",
			ink: "#472d24",
			crown: "#67462f",
			face: "#ba946d",
			rim: "#624936",
			flight: "#795439",
			feet: "#b3956e",
			horn: "#3c3934"
		}
	},
	kestrel: {
		bodyLength: .33,
		wingspan: .75,
		height: .24,
		body: {
			center: [
				0,
				.128,
				.005
			],
			radii: [
				.043,
				.08,
				.076
			],
			pitch: -.62
		},
		head: {
			pivot: [
				0,
				.194,
				-.074
			],
			center: [
				0,
				.007,
				-.009
			],
			radii: [
				.033,
				.039,
				.041
			],
			pitch: -.14
		},
		wing: {
			pivot: [
				.037,
				.137,
				-.007
			],
			scallop: .004,
			stations: [
				[
					0,
					-.044,
					.063,
					0,
					.01
				],
				[
					.16,
					-.073,
					.093,
					.007,
					.012
				],
				[
					.34,
					-.082,
					.098,
					.01,
					.011
				],
				[
					.55,
					-.07,
					.079,
					.007,
					.008
				],
				[
					.74,
					-.049,
					.053,
					.002,
					.006
				],
				[
					.88,
					-.026,
					.028,
					-.006,
					.004
				],
				[
					.95,
					-.011,
					.013,
					-.011,
					.002
				],
				[
					1,
					.002,
					.002,
					-.015,
					0
				]
			]
		},
		tail: {
			pivot: [
				0,
				.115,
				.046
			],
			lengthZ: .15,
			endY: -.056,
			halfWidth: .044,
			edgeShortening: .07
		},
		foot: {
			pivot: [
				.024,
				.071,
				.006
			],
			reach: .047,
			spread: .018,
			thickness: .0042
		},
		plumage: {
			back: "#a45d38",
			flank: "#b68157",
			breast: "#e7cdaa",
			ink: "#40332d",
			crown: "#647889",
			face: "#c5bba9",
			rim: "#353841",
			flight: "#483c37",
			feet: "#d39b48",
			horn: "#343c48"
		}
	}
};
// ../../../src/native/ported/birds/raptors/models.ts
function tt(e) {
	if (typeof e != "object" || !e) throw TypeError("Raptor build options must be an object.");
	let { species: t, lod: n } = e, r = e.morph === void 0 ? "default" : e.morph;
	if (t !== "tawny-owl" && t !== "eagle-owl" && t !== "kestrel") throw RangeError("Unsupported raptor species: " + String(t));
	if (r !== "default") throw RangeError("Unsupported raptor morph: " + String(r));
	if (n !== 0 && n !== 1 && n !== 2) throw RangeError("Unsupported raptor LOD: " + String(n));
	let i = et[t], c = ke(i), l = new a();
	l.name = t;
	let u = (e, t, n = 1) => {
		let r = new a();
		return r.name = e, r.position.set(n * t[0], t[1], t[2]), l.add(r), r;
	}, d = {
		head: u("head", i.head.pivot),
		leftWing: u("leftWing", i.wing.pivot, -1),
		rightWing: u("rightWing", i.wing.pivot),
		tail: u("tail", i.tail.pivot),
		leftFoot: u("leftFoot", i.foot.pivot, -1),
		rightFoot: u("rightFoot", i.foot.pivot)
	}, f = new s({
		vertexColors: !0,
		roughness: .86,
		metalness: 0
	});
	f.name = t + "-plumage";
	let p = [], m = (e, t, n, r = !1) => {
		p.push(n);
		let i = new o(n, f);
		i.name = t, i.castShadow = r, i.receiveShadow = !0, e.add(i);
	}, h = We(t, i, c, n), g = Ze(t, i, c, n), _ = $e(t, i, c, n);
	m(l, "body-mesh", Le(t, i, c, n).geometry(), !0), m(d.head, "head-mesh", h.part.geometry()), m(d.leftWing, "left-wing-mesh", g.geometry(-1), !0), m(d.rightWing, "right-wing-mesh", g.geometry(), !0), m(d.tail, "tail-mesh", Qe(t, i, c, n).geometry()), m(d.leftFoot, "left-foot-mesh", _.geometry(-1)), m(d.rightFoot, "right-foot-mesh", _.geometry());
	let v = {
		geometries: p,
		materials: [f]
	}, y = !1;
	return {
		species: t,
		morph: r,
		lod: n,
		root: l,
		pivots: d,
		resources: v,
		metrics: {
			bodyLengthM: i.bodyLength,
			wingspanM: i.wingspan,
			standingHeightM: i.height,
			eye: be(i.head.pivot, h.eye),
			footY: 0
		},
		dispose() {
			if (!y) {
				y = !0;
				for (let e of p) e.dispose();
				f.dispose();
			}
		}
	};
}
// ../../../src/native/ported/motion/controls/camera-resolver.ts
function nt({ near: e, verticalFovDegrees: t, aspect: n }) {
	let r = e * Math.tan(t * Math.PI / 360);
	return Math.hypot(e, r, r * n);
}
// ../../../src/native/body-profile.ts
function rt(e, t, n) {
	let r = nt({
		near: 1,
		verticalFovDegrees: t,
		aspect: n
	}), i = Math.min(.12, e.heightM * .1, (e.eyeFromSoleM.y - .006) / r);
	if (!Number.isFinite(i) || i <= .001) throw Error("Native eye cannot support this projection");
	return i;
}
function it(t) {
	t.root.updateMatrixWorld(!0);
	let n = new e.Box3().setFromObject(t.model.pivots.leftFoot, !0).union(new e.Box3().setFromObject(t.model.pivots.rightFoot, !0)), r = new e.Box3();
	for (let n of [
		"body",
		"body-mesh",
		"head"
	]) {
		let i = t.model.root.getObjectByName(n);
		i && r.union(new e.Box3().setFromObject(i, !0));
	}
	r.isEmpty() && r.setFromObject(t.model.root, !0);
	let i = (e) => Math.max(...[e.min.x, e.max.x].flatMap((t) => [e.min.z, e.max.z].map((e) => Math.hypot(t, e)))), a = t.model.metrics.standingHeightM, o = t.getEyeWorldPosition(new e.Vector3());
	return Object.freeze({
		horizontalRadiusM: t.model.species === "pigeon" ? .173 : i(r),
		heightM: a,
		centreToSoleM: a / 2,
		footSupportRadiusM: i(n),
		eyeFromSoleM: Object.freeze({
			x: o.x,
			y: o.y,
			z: o.z
		})
	});
}
Object.freeze(Object.keys({
	"pigeon-gray": {
		species: "pigeon",
		morph: "gray"
	},
	"pigeon-white": {
		species: "pigeon",
		morph: "white"
	},
	sparrow: {
		species: "sparrow",
		morph: "default"
	},
	crow: {
		species: "crow",
		morph: "default"
	},
	magpie: {
		species: "magpie",
		morph: "default"
	},
	"tawny-owl": {
		species: "tawny-owl",
		morph: "default"
	},
	"eagle-owl": {
		species: "eagle-owl",
		morph: "default"
	},
	kestrel: {
		species: "kestrel",
		morph: "default"
	}
}));
function at(e, t) {
	let { speciesId: n, skinId: r } = e;
	return {
		species: n,
		morph: n === "pigeon" && r === "default" ? "gray" : r,
		lod: t
	};
}
function ot(e, t) {
	return (n) => {
		switch (n.species) {
			case "pigeon":
			case "sparrow":
			case "crow":
			case "magpie": return e(n);
			case "tawny-owl":
			case "eagle-owl":
			case "kestrel": return t(n);
			default: throw RangeError("Unsupported bird species");
		}
	};
}
// assets.ts
var st = ot(ve, tt), ct = Object.freeze({
	mode: "rest",
	time: 0,
	flapAge: 10,
	steps: 0,
	reducedMotion: !0
}), lt = (e) => T(e, st, {
	origin: "sole",
	visualScale: 1
}), ut = (e) => Object.freeze({
	min: Object.freeze(e.min.toArray()),
	max: Object.freeze(e.max.toArray())
});
function dt(t, n = t.model.root) {
	t.root.updateWorldMatrix(!0, !0);
	let r = t.root.matrixWorld.clone().invert(), i = new e.Box3(), a = new e.Vector3();
	if (n.traverse((t) => {
		if (!(t instanceof e.Mesh)) return;
		let n = t.geometry.getAttribute("position");
		for (let e = 0; e < n.count; e++) i.expandByPoint(a.fromBufferAttribute(n, e).applyMatrix4(t.matrixWorld).applyMatrix4(r));
	}), i.isEmpty() || ![...i.min, ...i.max].every(Number.isFinite)) throw Error("Invalid local vertex bounds");
	return ut(i);
}
function ft(t) {
	if (t.root.parent || t.root.position.lengthSq() !== 0 || t.root.quaternion.angleTo(new e.Quaternion()) > 1e-12 || !t.root.scale.equals(new e.Vector3(1, 1, 1)) || !t.root.matrixAutoUpdate) throw Error("Origin measurement requires a detached identity rig");
	t.pose(ct), t.root.updateMatrixWorld(!0);
	let n = it(t);
	if (![
		n.heightM,
		n.horizontalRadiusM,
		n.footSupportRadiusM,
		n.centreToSoleM,
		...Object.values(n.eyeFromSoleM)
	].every(Number.isFinite) || n.heightM <= n.centreToSoleM || n.centreToSoleM <= 0 || n.horizontalRadiusM <= 0 || n.footSupportRadiusM <= 0) throw Error("Invalid measured bird body");
	let r = new e.Box3().setFromObject(t.model.pivots.leftFoot, !0).union(new e.Box3().setFromObject(t.model.pivots.rightFoot, !0));
	if (Math.abs(r.min.y) > 1e-6) throw Error("Measured soles are not at zero");
	return Object.freeze({
		body: n,
		bounds: dt(t),
		feet: ut(r),
		eye: Object.freeze(t.getEyeWorldPosition(new e.Vector3()).toArray()),
		rootScale: Object.freeze(t.root.scale.toArray())
	});
}
function pt(e, t = 0, n = {}) {
	let r = d(e), i = f(t), a = n.buildRig ?? lt, o = n.measure ?? ft, s = /* @__PURE__ */ new Set();
	function c(e) {
		let t = a(at(r, e));
		if (t.root.parent) throw Error("Factory returned a borrowed/parented rig");
		s.add(t);
		let n = at(r, e);
		if (t.model.species !== n.species || t.model.lod !== e || t.model.morph !== n.morph) throw Error("Factory identity mismatch");
		return t;
	}
	try {
		let e = c(i), t = o(e), n = t.body;
		if (i !== 0) {
			let e = c(0);
			n = o(e).body, e.dispose(), s.delete(e);
		}
		let a = !1;
		return {
			appearance: r,
			lod: i,
			rig: e,
			body: n,
			measurement: t,
			dispose() {
				a || (a = !0, s.delete(e), e.dispose());
			}
		};
	} catch (e) {
		for (let e of s) e.dispose();
		throw e;
	}
}
// ../../../src/native/ported/motion/locomotion/motion.ts
var mt = .65, ht = .24, Y = Object.freeze({
	minX: -590,
	maxX: 650,
	minZ: -665,
	maxZ: 560
}), gt = .1, _t = 1 / 240, vt = Object.freeze({
	radius: mt,
	height: 2 * mt,
	centreToSoleM: mt,
	eyeHeight: 1.31,
	walkSpeed: 6.2,
	flightSpeed: 17,
	glideSpeed: 22
});
Y.minX, Y.minZ, Y.maxX, Y.maxZ;
// ../../../src/native/ported/motion/locomotion/b2/native-motion.ts
var yt = Object.freeze({
	horizontalRadiusM: .173,
	heightM: .225,
	centreToSoleM: .1125,
	footSupportRadiusM: .06,
	eyeFromSoleM: Object.freeze({
		x: .025639,
		y: .198057,
		z: -.108
	})
}), bt = Object.freeze({
	walkSpeed: vt.walkSpeed,
	flightSpeed: vt.flightSpeed,
	glideSpeed: vt.glideSpeed
}), xt = 9.4, St = 16, Ct = 21, wt = 1e-9, X = 2e-6, Tt = 3, Et = 4, Dt = 13, Z = class extends Error {
	reason;
	constructor(e) {
		super(e), this.reason = e;
	}
};
function Ot(e) {
	return !!e && [
		e.x,
		e.y,
		e.z
	].every(Number.isFinite);
}
function kt(e) {
	return Ot(e) && Math.abs(Math.hypot(e.x, e.y, e.z) - 1) < .001;
}
function At(e) {
	return !!e && [
		e.horizontalRadiusM,
		e.heightM,
		e.centreToSoleM,
		e.footSupportRadiusM
	].every(Number.isFinite) && e.horizontalRadiusM > 0 && e.centreToSoleM > 0 && e.heightM > e.centreToSoleM && e.footSupportRadiusM >= 0 && Ot(e.eyeFromSoleM);
}
function jt(e) {
	return Ot(e) && [
		e.heading,
		e.vx,
		e.vy,
		e.vz,
		e.heldSeconds,
		e.flapAge,
		e.steps,
		e.flaps,
		e.time
	].every(Number.isFinite) && e.x >= Y.minX && e.x <= Y.maxX && e.z >= Y.minZ && e.z <= Y.maxZ && e.y <= 180 && e.time >= 0 && e.heldSeconds >= 0 && e.steps >= 0 && e.flapAge >= 0 && e.flaps >= 0 && typeof e.sourceId == "string" && e.sourceId.length > 0 && Number.isSafeInteger(e.nextEventSequence) && e.nextEventSequence > 0 && At(e.body) && !!e.tuning && [
		e.tuning.walkSpeed,
		e.tuning.flightSpeed,
		e.tuning.glideSpeed
	].every((e) => Number.isFinite(e) && e > 0);
}
function Mt(e = {}) {
	let t = e.body ?? yt, n = e.feet ?? {
		x: -37,
		y: 0,
		z: 8
	};
	if (!At(t) || !Ot(n)) throw RangeError("Invalid native bird geometry");
	let r = {
		...e.bird ?? {
			x: n.x,
			y: n.y + t.centreToSoleM,
			z: n.z,
			heading: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			grounded: !0,
			mode: "rest",
			heldSeconds: 0,
			flapAge: 10,
			steps: 0,
			flaps: 0
		},
		body: Object.freeze({
			...t,
			eyeFromSoleM: Object.freeze({ ...t.eyeFromSoleM })
		}),
		tuning: Object.freeze({
			...bt,
			...e.tuning
		}),
		sourceId: e.sourceId ?? "player",
		time: e.time ?? 0,
		nextEventSequence: e.nextEventSequence ?? 1,
		support: null
	};
	if (!jt(r)) throw RangeError("Invalid native motion state");
	return r;
}
function Nt(e) {
	return {
		x: e.x,
		y: e.y - e.body.centreToSoleM,
		z: e.z
	};
}
function Pt(e) {
	return {
		x: e.x,
		y: e.y,
		z: e.z
	};
}
function Ft(e, t, n) {
	return {
		x: e.x + (t.x - e.x) * n,
		y: e.y + (t.y - e.y) * n,
		z: e.z + (t.z - e.z) * n
	};
}
function It(e, t) {
	e.x = t.x, e.y = t.y, e.z = t.z;
}
function Lt(e) {
	let t;
	try {
		t = e();
	} catch {
		throw new Z("world-unavailable");
	}
	if (t === void 0) throw new Z("world-unavailable");
	return t;
}
function Rt(e, t, n, r, i, a, o) {
	let s = {
		at: n,
		previousFeetY: r,
		maxRiseM: i,
		maxDropM: a,
		layerId: o,
		footRadiusM: t.footSupportRadiusM,
		heightM: t.heightM
	}, c = Lt(() => e.supportAt(s));
	if (c === null) return null;
	if (typeof c.id != "string" || !c.id || typeof c.layerId != "string" || !c.layerId || typeof c.surface != "string" || !c.surface || typeof c.walkable != "boolean" || typeof c.landable != "boolean" || !kt(c.normal) || c.normal.y <= 0 || !Number.isFinite(c.height) || c.height < Math.min(r, n.y) - a - X || c.height > r + i + X) throw new Z("malformed-query");
	return {
		...c,
		normal: { ...c.normal }
	};
}
function zt(e, t, n, r) {
	let i = Lt(() => e.sweepBody(t, n, r));
	if (i === null) return null;
	if (!Number.isFinite(i.fraction) || i.fraction < 0 || i.fraction > 1 || !Ot(i.point) || !kt(i.normal) || typeof i.colliderId != "string" || !i.colliderId || i.layerId !== void 0 && typeof i.layerId != "string") throw new Z("malformed-query");
	let a = Ft(t, n, i.fraction);
	if (Math.hypot(i.point.x - a.x, i.point.y - a.y, i.point.z - a.z) > X) throw new Z("malformed-query");
	return {
		...i,
		point: a,
		normal: { ...i.normal }
	};
}
function Bt(e, t, n, r) {
	t.push({
		id: e.sourceId + ":" + e.nextEventSequence,
		sourceId: e.sourceId,
		time: e.time,
		position: n.type === "flap" ? Pt(e) : Nt(e),
		intensity: Math.min(1, Math.max(0, r)),
		...n
	}), e.nextEventSequence += 1;
}
function Vt(e) {
	return Math.hypot(e.vx, e.vz) / e.tuning.walkSpeed;
}
function Ht(e, t) {
	let n = Nt(e), r = Rt(t, e.body, n, n.y, X, X, e.support?.layerId);
	return r?.landable && Math.abs(r.height - n.y) <= X ? r : null;
}
function Ut(e, t, n) {
	let r = Math.min(St, Math.max(0, e.vy) + xt);
	if (r <= e.vy || e.y >= 180) return;
	let i = Pt(e);
	if (zt(t, i, {
		...i,
		y: Math.min(180, i.y + .001)
	}, e.body)) return;
	let a = r - e.vy;
	e.vy = r, e.grounded = !1, e.support = null, e.flapAge = 0, e.flaps += 1, Bt(e, n, { type: "flap" }, a / xt);
}
function Wt(e, t) {
	return !e.grounded && t.flapHeld && !t.descend && e.heldSeconds >= .24 - wt;
}
function Gt(e) {
	return Number.isFinite(e) ? Math.max(-1, Math.min(1, e)) : 0;
}
function Kt(e, t, n, r) {
	let i = {
		state: { ...e },
		acceptedSeconds: 0,
		events: []
	};
	if (!Number.isFinite(n) || n <= 0) return {
		...i,
		status: "idle"
	};
	if (!jt(e)) return {
		...i,
		status: "blocked",
		reason: "invalid-state"
	};
	if (!r || typeof r.supportAt != "function" || typeof r.sweepBody != "function") return {
		...i,
		status: "blocked",
		reason: "world-unavailable"
	};
	let a = { ...e }, o = [], s = Math.min(n, gt), c = {
		...t,
		forward: Gt(t.forward),
		turn: Gt(t.turn)
	};
	try {
		let t = Pt(a);
		if (zt(r, t, t, a.body)) throw new Z("initial-overlap");
		a.grounded && (a.support = Ht(a, r), a.support || (a.grounded = !1, Bt(a, o, { type: "support-lost" }, Vt(a)))), (!c.flapHeld || c.flapPressed) && (a.heldSeconds = 0), c.flapPressed && Ut(a, r, o);
		let n = Math.ceil(s / _t), i = s / n, l = e.time + s;
		for (let t = 0; t < n; t += 1) {
			let s = t === n - 1 ? l : e.time + (t + 1) * i, u = ht - a.heldSeconds;
			!a.grounded && c.flapHeld && !c.descend && u > wt && u < i - wt ? (Xt(a, c, u, a.time + u, r, o), Xt(a, c, i - u, s, r, o)) : Xt(a, c, i, s, r, o);
		}
	} catch (e) {
		if (e instanceof Z) return {
			...i,
			status: "blocked",
			reason: e.reason
		};
		throw e;
	}
	return {
		state: a,
		acceptedSeconds: s,
		events: o,
		status: "advanced"
	};
}
function qt(e, t, n, r, i) {
	if (r.y > n.y) return null;
	let a = n.y - t.centreToSoleM, o = (i) => {
		let o = Ft(n, r, i), s = {
			...o,
			y: o.y - t.centreToSoleM
		}, c = Rt(e, t, s, a, X, X);
		return c?.landable && c.height >= s.y - X ? {
			position: {
				...o,
				y: c.height + t.centreToSoleM
			},
			support: c
		} : null;
	}, s = 0;
	for (let e = 0; e <= Et; e += 1) {
		let t = i * e / Et, n = o(t);
		if (n) {
			let e = s;
			for (let r = 0; r < Dt && t > e; r += 1) {
				let r = (e + t) / 2, i = o(r);
				i ? (t = r, n = i) : e = r;
			}
			return n;
		}
		s = t;
	}
	return null;
}
function Jt(e, t, n, r) {
	let i = {
		x: Math.min(Y.maxX, Math.max(Y.minX, t.x + e.vx * n)),
		y: Math.min(180, t.y + (e.grounded ? 0 : e.vy * n)),
		z: Math.min(Y.maxZ, Math.max(Y.minZ, t.z + e.vz * n))
	};
	if (!e.grounded) return i;
	let a = Math.hypot(i.x - t.x, i.z - t.z);
	if (a <= X) return i;
	let o = t.y - e.body.centreToSoleM, s = Math.min(.045, .006 + 1.25 * a), c = Rt(r, e.body, {
		...i,
		y: o
	}, o, s, s, e.support?.layerId);
	return c?.walkable && c.landable && (i.y = c.height + e.body.centreToSoleM), i;
}
function Yt(e, t, n) {
	let r = t;
	for (let t = 0; t < Tt && r > wt; t += 1) {
		let t = Pt(e), i = Jt(e, t, r, n), a = zt(n, t, i, e.body), o = e.grounded ? null : qt(n, e.body, t, i, a?.fraction ?? 1);
		if (o && !zt(n, o.position, o.position, e.body)) {
			let t = Math.max(0, -e.vy);
			return It(e, o.position), e.vy = 0, e.grounded = !0, e.support = o.support, t;
		}
		if (!a) {
			It(e, i);
			break;
		}
		It(e, a.point);
		let s = a.normal, c = e.vx * s.x + e.vy * s.y + e.vz * s.z;
		if (c >= -1e-9) break;
		e.vx -= c * s.x, e.vy -= c * s.y, e.vz -= c * s.z, r *= 1 - a.fraction;
	}
	return (e.x === Y.minX && e.vx < 0 || e.x === Y.maxX && e.vx > 0) && (e.vx = 0), (e.z === Y.minZ && e.vz < 0 || e.z === Y.maxZ && e.vz > 0) && (e.vz = 0), e.y === 180 && e.vy > 0 && (e.vy = 0), e.grounded && (e.support = Ht(e, n), e.grounded = e.support !== null, e.vy = 0), null;
}
function Xt(e, t, n, r, i, a) {
	let o = e.grounded, s = Pt(e), c = Wt(e, t);
	e.heading += t.turn * (o ? 2.35 : 1.35) * n;
	let { walkSpeed: l, flightSpeed: u, glideSpeed: d } = e.tuning, f = o ? e.support?.walkable ? t.forward * l : 0 : (c ? d : u) * (1 + t.forward * .25), p = 1 - Math.exp(-(o ? 14 : 3.5) * n);
	e.vx += (Math.sin(e.heading) * f - e.vx) * p, e.vz += (-Math.cos(e.heading) * f - e.vz) * p, c ? e.vy += (-1.7 - e.vy) * (1 - Math.exp(-3.5 * n)) : o || (e.vy = Math.max(t.descend ? -21 : -16, e.vy - (t.descend ? 25 : 16) * n));
	let m = Yt(e, n, i);
	e.time = r, e.flapAge += n, t.flapHeld && (e.heldSeconds += n);
	let h = o ? Math.hypot(e.x - s.x, e.z - s.z) : 0, g = e.steps;
	e.steps += h, Math.floor(e.steps / .8) > Math.floor(g / .8) && Bt(e, a, { type: "step" }, h / n / l), m !== null && Bt(e, a, {
		type: "land",
		impactSpeed: m
	}, m / Ct), o && !e.grounded && Bt(e, a, { type: "support-lost" }, Vt(e)), e.mode = e.grounded ? h / n > .045 ? "walk" : "rest" : Wt(e, t) ? "glide" : e.flapAge < .42 ? "flap" : "fall";
}
// ../../../src/native/ported/motion/controls/b2/native-camera.ts
var Zt = Object.freeze([
	0,
	1,
	0
]), Qt = .001, $t = (e, t) => [
	e[0] + t[0],
	e[1] + t[1],
	e[2] + t[2]
], en = (e, t, n) => [
	e[0] + (t[0] - e[0]) * n,
	e[1] + (t[1] - e[1]) * n,
	e[2] + (t[2] - e[2]) * n
], Q = (e, t) => Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]);
function tn(e) {
	return Array.isArray(e) && e.length === 3 && [
		e[0],
		e[1],
		e[2]
	].every(Number.isFinite);
}
function nn(e) {
	if (!e || typeof e != "object") return !1;
	let { x: t, y: n, z: r } = e;
	return [
		t,
		n,
		r
	].every(Number.isFinite);
}
var rn = ([e, t, n]) => ({
	x: e,
	y: t,
	z: n
}), an = ({ x: e, y: t, z: n }) => [
	e,
	t,
	n
];
function on(e, t, n) {
	if (!e || typeof e != "object") return !1;
	let { fraction: r, point: i, normal: a, colliderId: o, layerId: s } = e;
	return typeof r != "number" || !Number.isFinite(r) || r < 0 || r > 1 || !nn(i) || !nn(a) || typeof o != "string" || !o || s !== void 0 && typeof s != "string" ? !1 : Math.abs(Math.hypot(a.x, a.y, a.z) - 1) <= .001 && Q(an(i), en(t, n, r)) <= 1e-6;
}
function sn(e, t) {
	function n(n) {
		let r = e.sphereClear(rn(n), t);
		if (r !== !0 && r !== !1) throw TypeError("Unverified camera sphere overlap");
		return r;
	}
	function r(n, r) {
		if (Q(n, r) === 0) return null;
		let i = e.sweepSphere(rn(n), rn(r), t);
		if (i === null || on(i, n, r)) return i;
		throw TypeError("Unverified camera sphere sweep");
	}
	function i(e, t) {
		let i = r(e, t), a = i ? en(e, t, Math.max(0, i.fraction - Qt / Q(e, t))) : t;
		if (!n(a)) throw TypeError("Sweep did not yield a clear camera sphere");
		return {
			position: a,
			hit: i
		};
	}
	return {
		clear: n,
		sweep: r,
		clip: i
	};
}
function cn({ bird: e, mode: t, world: n, metrics: r, projection: i, acceptedSeconds: a, previousPosition: o, posedEyeWorld: s, reducedMotion: c }) {
	if (!e || !r?.body || !i) return {
		kind: "blocked",
		reason: "invalid-view"
	};
	let l = [
		e.x,
		e.y,
		e.z
	], { body: u, chaseTargetOffset: d, chaseGroundOffset: f, chaseAirOffset: p } = r, m = nt(i);
	if (!tn(l) || ![
		e.heading,
		e.vy,
		u.centreToSoleM,
		a,
		m
	].every(Number.isFinite) || u.centreToSoleM <= 0 || a < 0 || a > .1 || !(i.near > 0 && i.aspect > 0 && i.verticalFovDegrees > 0 && i.verticalFovDegrees < 180) || t !== "first" && t !== "third" || ![
		d,
		f,
		p
	].every(tn) || !nn(u.eyeFromSoleM) || o !== void 0 && !tn(o) || s !== void 0 && !nn(s)) return {
		kind: "blocked",
		reason: "invalid-view"
	};
	if (!n || typeof n.sphereClear != "function" || typeof n.sweepSphere != "function") return {
		kind: "blocked",
		reason: "invalid-query"
	};
	let h = t === "first", g = Math.sin(e.heading), _ = Math.cos(e.heading), v = ([e, t, n]) => [
		_ * e - g * n,
		t,
		g * e + _ * n
	], y = u.eyeFromSoleM, b = [
		y.x,
		y.y - u.centreToSoleM,
		y.z
	], x = h ? l : $t(l, v(d)), S = h ? b : e.grounded ? f : p, C = h && s ? an(s) : $t(l, v(S));
	if (!tn(x) || !tn(C) || !Number.isFinite(Q(l, x) + Q(x, C) + (o ? Q(o, l) + Q(o, C) : 0))) return {
		kind: "blocked",
		reason: "invalid-view"
	};
	let { clear: w, sweep: T, clip: E } = sn(n, m + Qt), D, O, k = !1;
	try {
		let e = l;
		if (!w(e)) {
			let t = h ? C : x, r = sn(n, Qt);
			if (!w(t) || !r.clear(l) || r.sweep(l, t) !== null) return {
				kind: "blocked",
				reason: "no-clear-anchor"
			};
			e = t;
		}
		if (o && !w(o)) return {
			kind: "blocked",
			reason: "no-clear-previous"
		};
		O = h ? e : E(e, x).position;
		let t = E(O, C).position;
		if (D = t, o) {
			let e = a === 0 ? 0 : h || c ? 1 : -Math.expm1(-6 * a), n = E(o, en(o, t, e));
			if (D = n.position, k = T(O, D) !== null, !h && e > 0 && n.hit && k) {
				let r = en(o, t, e), i = [n.hit.normal];
				for (let e = 0; e < 4; e++) {
					let e = [
						r[0] - o[0],
						r[1] - o[1],
						r[2] - o[2]
					];
					for (let t of i) {
						let n = Math.min(0, e[0] * t.x + e[1] * t.y + e[2] * t.z);
						e = [
							e[0] - n * t.x,
							e[1] - n * t.y,
							e[2] - n * t.z
						];
					}
					let n = E(o, [
						o[0] + e[0],
						o[1] + e[1],
						o[2] + e[2]
					]);
					if (Q(n.position, t) + Qt < Q(D, t) && (D = n.position, k = T(O, D) !== null), !n.hit) break;
					i.push(n.hit.normal);
				}
			}
			let r = n.hit && Q(o, D) < 2 * Qt;
			if (e > 0 && (r || k) && T(o, O) === null) {
				let t = en(o, O, e);
				if (!w(t)) throw TypeError("Retraction did not yield a clear camera sphere");
				D = t, k = !1;
			}
			if (!w(D) || T(o, D) !== null) throw TypeError("Final displayed camera chord is not verified clear");
		}
	} catch {
		return {
			kind: "blocked",
			reason: "invalid-query"
		};
	}
	let A = Math.hypot(D[0] - O[0], D[2] - O[2]) < Math.max(1e-6, .01 * Math.abs(D[1] - O[1])), j = h ? Math.max(-3, Math.min(4, e.vy * .28)) : 0, M = h || A ? $t(D, [
		g * 40,
		j,
		-_ * 40
	]) : O;
	return !tn(M) || M[0] === D[0] && M[2] === D[2] ? {
		kind: "blocked",
		reason: "invalid-view"
	} : {
		kind: "resolved",
		position: D,
		lookAt: M,
		up: Zt,
		cut: o === void 0,
		occluded: k
	};
}
// upstream/pose-input.ts
var ln = .24;
function un(e, t) {
	let { simTime: n, calledAt: r, landedAt: i, reducedMotion: a } = t, o = i === void 0 ? Infinity : n - i, s = Math.min(1, Math.max(0, o / ln)), c = e.grounded && o >= 0 ? 1 - s * s * (3 - 2 * s) : 0;
	return {
		mode: e.mode,
		time: n,
		flapAge: e.flapAge,
		steps: e.steps,
		landing: c,
		...r !== void 0 && Number.isFinite(r) && r <= n ? { callAge: n - r } : {},
		...a === void 0 ? {} : { reducedMotion: a }
	};
}
function dn(e, t) {
	return {
		position: {
			x: e.x,
			y: e.y - t.centreToSoleM,
			z: e.z
		},
		yaw: -e.heading
	};
}
// actor.ts
var fn = Object.freeze({
	walkSpeed: .9,
	flightSpeed: 12,
	glideSpeed: 15
}), pn = /* @__PURE__ */ new Set([
	"stone",
	"granite",
	"asphalt",
	"wood",
	"metal",
	"roof-tile",
	"water",
	"glass",
	"soil",
	"paving",
	"grass"
]), mn = ([e, t, n]) => ({
	x: e,
	y: t,
	z: n
}), hn = (e, t) => e.speciesId === t.speciesId && e.skinId === t.skinId, gn = (e) => ({
	...e,
	support: e.support ? {
		...e.support,
		normal: { ...e.support.normal }
	} : null
});
function $(e) {
	throw Error(e);
}
function _n(t) {
	t.updateWorldMatrix(!0, !1), t.matrixWorld.equals(new e.Matrix4()) || $("non-identity-parent");
}
function vn(e) {
	return !!e && typeof e.id == "string" && !!e.id && typeof e.layerId == "string" && !!e.layerId && Number.isFinite(e.height) && !!e.normal && Object.values(e.normal).every(Number.isFinite) && Math.abs(Math.hypot(e.normal.x, e.normal.y, e.normal.z) - 1) < .001 && pn.has(e.surface) && typeof e.walkable == "boolean" && typeof e.landable == "boolean";
}
function yn(t, n) {
	_n(t), n.appearance && n.legacyLook && $("ambiguous-initial-identity");
	let r = n.dependencies ?? {}, i = n.world, a = n.sessionId ?? crypto.randomUUID(), o = n.actorId ?? "player-bird", s = pt(n.appearance ?? p(n.legacyLook ?? "pigeon"), n.lod ?? 0, r), c, l = { ...n.view ?? {
		mode: "third",
		verticalFovDegrees: 59,
		aspect: 16 / 9
	} }, u, m, h, g, _ = n.lastLandedAt, v = n.calledAt, y = 0, b = -1, x = 0, S = 0, C = !1, w = Object.freeze([]), T = /* @__PURE__ */ new Set(), E = () => {
		for (let e of [...T]) e();
	}, D = (e) => e instanceof Error ? e.message : String(e);
	function O(e) {
		let t = Nt(e), n = i.supportAt({
			at: t,
			previousFeetY: t.y,
			footRadiusM: e.body.footSupportRadiusM,
			heightM: e.body.heightM,
			maxRiseM: 2e-6,
			maxDropM: 2e-6,
			layerId: e.support?.layerId
		});
		return n === void 0 && $("unverified-support"), n !== null && !vn(n) && $("malformed-support"), n;
	}
	function k(e) {
		let t = i.sweepBody(e, e, e.body);
		t !== null && $(t === void 0 ? "unverified-body" : "body-overlap");
		let n = O(e);
		e.grounded && (!n?.landable || Math.abs(n.height - Nt(e).y) > 2e-6) && $("grounded-support-required"), e.support = e.grounded ? n : null;
	}
	function A(t, n, r) {
		let i = dn(n, n.body);
		t.rig.root.position.set(i.position.x, i.position.y, i.position.z), t.rig.root.rotation.set(0, i.yaw, 0), t.rig.pose(r), t.rig.root.updateMatrixWorld(!0);
		let a = t.rig.getEyeWorldPosition(new e.Vector3());
		return [
			a.x,
			a.y,
			a.z
		].every(Number.isFinite) || $("invalid-posed-eye"), {
			x: a.x,
			y: a.y,
			z: a.z
		};
	}
	function j(e, t) {
		let n = (r.near ?? rt)(e, t.verticalFovDegrees, t.aspect);
		return (!Number.isFinite(n) || n <= .001) && $("invalid-near"), {
			near: n,
			verticalFovDegrees: t.verticalFovDegrees,
			aspect: t.aspect
		};
	}
	function M(e, t, n, a, o, s, c) {
		let l = e.body, u = (r.camera ?? cn)({
			bird: e,
			mode: t.mode,
			world: i,
			projection: n,
			acceptedSeconds: a,
			previousPosition: c,
			posedEyeWorld: o,
			reducedMotion: s,
			metrics: {
				body: l,
				chaseTargetOffset: [
					0,
					l.eyeFromSoleM.y - l.centreToSoleM,
					0
				],
				chaseGroundOffset: [
					0,
					l.heightM * 3.2 - l.centreToSoleM,
					l.heightM * 10
				],
				chaseAirOffset: [
					0,
					l.heightM * 5.2 - l.centreToSoleM,
					l.heightM * 14.5
				]
			}
		});
		return u.kind === "blocked" && $("camera:" + u.reason), t.mode === "first" && Math.hypot(u.position[0] - o.x, u.position[1] - o.y, u.position[2] - o.z) > 1e-6 && $(a === 0 ? "zero-time-first-person-swap-policy" : "first-person-eye-unreachable"), u;
	}
	function N(e, t, n) {
		let r = S, s = 0, c = [];
		for (let l of e) {
			let e = Object.freeze({
				...l,
				position: Object.freeze({ ...l.position })
			}), u = null;
			if (l.type === "step" || l.type === "land") {
				let e = i.supportAt({
					at: l.position,
					previousFeetY: l.position.y,
					footRadiusM: t.body.footSupportRadiusM,
					heightM: t.body.heightM,
					maxRiseM: 2e-6,
					maxDropM: 2e-6,
					layerId: t.support?.layerId
				});
				(e === void 0 || e !== null && !vn(e)) && $("unverified-event-contact"), u = e, l.type === "land" && !u?.landable && $("unverified-land-contact");
			}
			let d, f = () => ({
				id: a + ":" + (x + 1) + ":" + s++,
				sessionId: a,
				batchSequence: x + 1,
				itemIndex: s - 1,
				seq: ++r,
				simTime: l.time,
				sourceId: "motion-stream",
				actorId: o,
				position: e.position
			});
			l.type === "flap" ? d = {
				...f(),
				type: "flap",
				speciesId: n.speciesId
			} : l.type === "land" && u ? d = {
				...f(),
				type: "land",
				surface: u.surface,
				supportId: u.id,
				impactSpeed: l.impactSpeed
			} : l.type === "step" && u && (d = {
				...f(),
				type: "footstep",
				surface: u.surface,
				strength: l.intensity
			}), c.push(Object.freeze({
				raw: e,
				appearance: n,
				speciesId: n.speciesId,
				anchor: l.type === "flap" ? "body" : "sole",
				sourceTime: l.time,
				...d ? { canonical: Object.freeze(d) } : {}
			}));
		}
		return {
			events: Object.freeze(c),
			nextSequence: r
		};
	}
	try {
		let e = n.initialState;
		c = Mt(e ? {
			bird: {
				...e,
				y: Nt(e).y + s.body.centreToSoleM
			},
			body: s.body,
			tuning: e.tuning,
			sourceId: e.sourceId,
			time: e.time,
			nextEventSequence: e.nextEventSequence
		} : {
			body: s.body,
			tuning: fn,
			feet: n.feet ?? {
				x: 0,
				y: 0,
				z: 0
			},
			sourceId: o
		}), _ !== void 0 && (!Number.isFinite(_) || _ > c.time || _ < 0) && $("invalid-landing-time"), k(c), g = un(c, {
			simTime: c.time,
			landedAt: _,
			calledAt: v
		}), h = A(s, c, g), u = j(c.body, l), m = M(c, l, u, 0, h, !1), t.add(s.rig.root);
	} catch (e) {
		throw s.dispose(), e;
	}
	function P(e, n = s.lod) {
		if (C) return {
			kind: "blocked",
			reason: "disposed"
		};
		let a = y, o = c, p = g, _ = l, v = m, b = s.appearance, x;
		try {
			_n(t);
			let l = d(e), g = f(n);
			if (hn(l, s.appearance) && g === s.lod) return { kind: "unchanged" };
			x = pt(l, g, r);
			let S = hn(l, b) ? o.body : x.body, w = Mt({
				bird: {
					...o,
					y: Nt(o).y + S.centreToSoleM
				},
				body: S,
				tuning: o.tuning,
				sourceId: o.sourceId,
				time: o.time,
				nextEventSequence: o.nextEventSequence
			});
			w.support = o.support, k(w);
			let D = A(x, w, p), O = j(S, _), N = M(w, _, O, 0, D, p.reducedMotion ?? !1, v.position), P = i.sweepSphere(mn(N.position), D, .001);
			P !== null && $(P === void 0 ? "unverified-swap-eye-sight" : "occluded-swap-eye"), (C || y !== a) && $("stale-appearance-during-preview");
			let F = x, I = !1, L = () => !I && !C && y === a, R = () => {
				I || (I = !0, T.delete(R), F.dispose());
			};
			return T.add(R), {
				kind: "ready",
				appearance: l,
				lod: g,
				isCurrent: L,
				cancel: R,
				commit() {
					L() || (R(), $("stale-appearance-proposal")), I = !0, T.delete(R), E();
					let e = s;
					s = F, c = w, u = O, m = N, h = D, y++, t.add(s.rig.root), e.rig.root.removeFromParent(), e.dispose();
				}
			};
		} catch (e) {
			return x?.dispose(), {
				kind: "blocked",
				reason: D(e)
			};
		}
	}
	return {
		get root() {
			return s.rig.root;
		},
		get state() {
			return Object.freeze(gn(c));
		},
		get appearance() {
			return s.appearance;
		},
		get events() {
			return w;
		},
		prepareAppearance: P,
		prepareLegacy(e, t = s.lod) {
			try {
				return P(p(e), t);
			} catch (e) {
				return {
					kind: "blocked",
					reason: D(e)
				};
			}
		},
		prepareLod(e) {
			return P(s.appearance, e);
		},
		prepareFrame(e, n, r = l) {
			if (C) return {
				kind: "blocked",
				reason: "disposed"
			};
			let a = y, o = s, d = c, f = Object.freeze({ ...r });
			e = Object.freeze({ ...e });
			let p = e.acceptedSeconds;
			if (e.contractVersion !== 1 || !e.playing || typeof e.reducedMotion != "boolean" || e.quality !== "desktop" && e.quality !== "mobile" || !Number.isInteger(e.frame) || e.frame < 0 || e.frame <= b || !Number.isFinite(p) || p <= 0 || p > .1 || !Number.isFinite(e.rawSeconds) || e.rawSeconds < p || e.rawSeconds > .25 || !Number.isFinite(e.simTime) || Math.abs(e.simTime - d.time - p) > 1e-8) return {
				kind: "blocked",
				reason: "invalid-or-inactive-frame"
			};
			try {
				_n(t);
				let r = Kt(d, n, p, i);
				(r.status !== "advanced" || r.acceptedSeconds !== p) && $("motion:" + (r.status === "blocked" ? r.reason : r.status));
				let T = _;
				for (let e of r.events) e.type === "land" && (T = e.time);
				let D = un(r.state, {
					simTime: r.state.time,
					landedAt: T,
					calledAt: v,
					reducedMotion: e.reducedMotion
				}), O = N(r.events, r.state, s.appearance), k = j(r.state.body, f), P, F, I = [];
				try {
					P = A(o, r.state, D), F = M(r.state, f, k, p, P, e.reducedMotion, m.position), o.rig.root.traverse((e) => I.push({
						object: e,
						position: e.position.clone(),
						quaternion: e.quaternion.clone(),
						scale: e.scale.clone(),
						matrix: e.matrix.clone()
					}));
				} finally {
					!C && s === o && A(o, c, g);
				}
				(C || y !== a) && $("stale-species-during-preview");
				let L = e.frame, R = !1, z = () => !R && !C && y === a;
				return {
					kind: "ready",
					pose: Object.freeze({ ...D }),
					landedAt: T,
					previewEmissions: O.events,
					isCurrent: z,
					cancel() {
						R = !0;
					},
					commit() {
						z() || $("stale-species-frame"), R = !0, E();
						for (let e of I) e.object.position.copy(e.position), e.object.quaternion.copy(e.quaternion), e.object.scale.copy(e.scale), e.object.matrix.copy(e.matrix), e.object.matrixWorldNeedsUpdate = !0;
						s.rig.root.updateMatrixWorld(!0), c = r.state, g = D, h = P, m = F, u = k, l = { ...f }, _ = T, b = L, w = O.events, S = O.nextSequence, x++, y++;
					}
				};
			} catch (e) {
				return {
					kind: "blocked",
					reason: D(e)
				};
			}
		},
		snapshot() {
			return {
				appearance: s.appearance,
				lod: s.lod,
				state: gn(c),
				body: c.body,
				measurement: s.measurement,
				rootPosition: s.rig.root.position.toArray(),
				rootScale: s.rig.root.scale.toArray(),
				eye: { ...h },
				pose: { ...g },
				landedAt: _,
				camera: {
					...m,
					position: [...m.position],
					lookAt: [...m.lookAt]
				},
				projection: { ...u },
				view: { ...l },
				version: y,
				lastFrame: b,
				batch: x,
				sequence: S,
				events: w,
				disposed: C
			};
		},
		localBounds() {
			return C && $("disposed"), dt(s.rig);
		},
		dispose() {
			C || (C = !0, E(), s.rig.root.removeFromParent(), s.dispose());
		}
	};
}
export { u as APPEARANCES, ln as LANDING_BLEND_SECONDS, ct as NEUTRAL_POSE, fn as SHARED_GAME_TUNING, c as SPECIES, p as appearanceForLegacy, pt as buildNativeAppearance, yn as createSpeciesActor, lt as defaultBuildRig, dt as localGeometryBounds, ft as measureOriginRig, d as normalizeAppearance, un as toBirdPoseInput, f as validateLod };
