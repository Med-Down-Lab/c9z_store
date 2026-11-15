/* ==========================================================================
   C9Z Web v2.3 — 3D WebGL Cyber-Tactical Order Confirmation Ceremony
   Architecture:
   - True Three.js ExtrudeGeometry + EdgesGeometry built 1:1 from c9zwolf logo
   - Phase 1: Crimson Laser Wireframe Sweep (custom GLSL edge draw shader + spark)
   - Phase 2: Bottom-up Metallic Solidification with glowing molten laser frontier
   - Phase 3: Crimson Eye & Ear Ignition + 3D Shockwave Ring + Cyber Chime
   - Phase 4: Smooth reveal into the Invoice Confirmation screen + Replay support
   - Graceful SVG 3D perspective fallback when WebGL or reduced-motion applies
   ========================================================================== */
(function (global) {
  'use strict';

  // Normalized 2D polygon coordinates extracted directly from official c9zwolf emblem
  // Coordinate space: centered around (0, 0), Y-up, approx [-3.0..+2.9] x [-2.7..+3.22]
  const LOGO_SHAPES = {
    whiteCrescent: [
      [0.208, 2.444], [0.806, 2.431], [0.194, 1.958], [-0.361, 1.431], [-0.861, 1.264],
      [-1.25, 1.014], [-1.486, 0.778], [-1.625, 0.583], [-1.736, 0.389], [-1.889, -0.028],
      [-1.875, -0.056], [-1.389, 0.319], [-1.167, 0.431], [-0.861, 0.528], [-0.833, 0.514],
      [-1.097, 0.25], [-1.347, -0.139], [-1.458, -0.5], [-1.472, -0.736], [-1.458, -0.972],
      [-1.403, -1.194], [-1.306, -1.361], [-1.181, -0.944], [-1.125, -0.861], [-0.931, -1.25],
      [-0.639, -1.542], [-0.333, -1.708], [-0.139, -1.764], [0.917, -1.778], [1.972, -1.792],
      [2.694, -2.667], [1.014, -2.694], [-0.667, -2.681], [-1.167, -2.597], [-1.778, -2.347],
      [-2.167, -2.069], [-2.403, -1.833], [-2.597, -1.583], [-2.847, -1.111], [-2.986, -0.556],
      [-3.0, -0.264], [-2.958, 0.194], [-2.819, 0.667], [-2.625, 1.056], [-2.319, 1.472],
      [-1.917, 1.847], [-1.472, 2.125], [-1.222, 2.236], [-0.639, 2.403]
    ],
    whiteWolfHead: [
      [1.236, 2.167], [1.444, 1.278], [1.778, 1.069], [1.986, 0.861], [2.153, 0.583],
      [2.25, 0.25], [2.875, -0.306], [2.889, -0.347], [2.875, -0.389], [2.417, -0.875],
      [2.167, -1.014], [2.014, -1.056], [1.5, -0.875], [1.139, -0.833], [0.667, -0.903],
      [0.444, -0.986], [0.139, -1.167], [0.111, -1.153], [0.417, -0.847], [0.806, -0.653],
      [1.222, -0.583], [1.556, -0.625], [1.944, -0.736], [2.083, -0.75], [2.222, -0.736],
      [2.333, -0.681], [2.514, -0.5], [2.569, -0.389], [2.583, -0.347], [2.569, -0.306],
      [1.986, 0.222], [1.903, 0.472], [1.736, 0.778], [1.472, 1.014], [0.958, 1.306],
      [1.042, 1.667]
    ],
    redEarBlade: [
      [2.389, 3.222], [2.417, 3.208], [2.069, 2.833], [1.792, 2.472], [1.375, 1.806],
      [1.264, 2.139], [1.25, 2.153], [1.194, 2.167], [0.458, 1.75], [0.361, 1.694],
      [0.333, 1.708], [0.75, 2.097], [1.361, 2.597], [1.944, 2.986]
    ],
    redEye: [
      [1.014, 0.639], [1.556, 0.458], [1.75, 0.194], [1.681, 0.167],
      [1.611, 0.181], [1.306, 0.236], [0.972, 0.625]
    ]
  };

  const DURATION_SEC = 3.35;
  const MUTE_STORAGE_KEY = 'c9z_ceremony_muted';

  let activeCleanup = null;
  let audioCtx = null;
  let masterGain = null;

  function isMuted() {
    try {
      return global.localStorage && global.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setMuted(muted) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
      }
    } catch (_) {}
    if (masterGain && audioCtx) {
      masterGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.03);
    }
  }

  function isReducedMotion() {
    return Boolean(
      global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function svgPathFromPts(pts) {
    if (!pts || !pts.length) return '';
    return 'M' + pts.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join(' L') + ' Z';
  }

  function getLogoSvgMarkup(cls = 'c9z-wolf-vector') {
    const whiteD = `${svgPathFromPts(LOGO_SHAPES.whiteCrescent)} ${svgPathFromPts(LOGO_SHAPES.whiteWolfHead)}`;
    const redD = `${svgPathFromPts(LOGO_SHAPES.redEarBlade)} ${svgPathFromPts(LOGO_SHAPES.redEye)}`;
    return `
      <svg class="${cls}" viewBox="-3.35 -3.5 6.65 6.65" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path class="c9z-svg-white" d="${whiteD}" fill="#f3f4f6" stroke="#ffffff" stroke-width="0.06" stroke-linejoin="round" />
        <path class="c9z-svg-red" d="${redD}" fill="#ff0022" stroke="#ff334b" stroke-width="0.05" stroke-linejoin="round" />
      </svg>
    `;
  }

  // =========================================================================
  // Web Audio API Synthesized Cyber Forge & Ignition Cues (Zero External Files)
  // =========================================================================
  function unlockAudio() {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) {
        audioCtx = new Ctx();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = isMuted() ? 0 : 1;
        masterGain.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function scheduleCeremonyAudio() {
    const ctx = unlockAudio();
    if (!ctx || !masterGain || ctx.state !== 'running') return () => {};

    const nodes = [];
    const now = ctx.currentTime + 0.04;

    try {
      // 1. Cyber Laser Sweep (0.04s -> 1.35s)
      const oscSweep = ctx.createOscillator();
      const filterSweep = ctx.createBiquadFilter();
      const gainSweep = ctx.createGain();
      oscSweep.type = 'sawtooth';
      oscSweep.frequency.setValueAtTime(115, now);
      oscSweep.frequency.exponentialRampToValueAtTime(340, now + 1.25);
      filterSweep.type = 'bandpass';
      filterSweep.frequency.setValueAtTime(520, now);
      filterSweep.frequency.exponentialRampToValueAtTime(1950, now + 1.2);
      filterSweep.Q.value = 3.2;
      gainSweep.gain.setValueAtTime(0.0001, now);
      gainSweep.gain.exponentialRampToValueAtTime(0.042, now + 0.2);
      gainSweep.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
      oscSweep.connect(filterSweep);
      filterSweep.connect(gainSweep);
      gainSweep.connect(masterGain);
      oscSweep.start(now);
      oscSweep.stop(now + 1.4);
      nodes.push(oscSweep);

      // 2. Metallic Forge Solidification Pulse (~1.18s)
      const tForge = now + 1.18;
      const oscSub = ctx.createOscillator();
      const gainSub = ctx.createGain();
      oscSub.type = 'sine';
      oscSub.frequency.setValueAtTime(125, tForge);
      oscSub.frequency.exponentialRampToValueAtTime(42, tForge + 0.38);
      gainSub.gain.setValueAtTime(0.0001, tForge);
      gainSub.gain.linearRampToValueAtTime(0.11, tForge + 0.03);
      gainSub.gain.exponentialRampToValueAtTime(0.0001, tForge + 0.44);
      oscSub.connect(gainSub);
      gainSub.connect(masterGain);
      oscSub.start(tForge);
      oscSub.stop(tForge + 0.48);
      nodes.push(oscSub);

      // 3. Crimson Eye Ignition Harmonic Chime (~2.15s)
      const tChime = now + 2.15;
      const freqs = [523.25, 783.99, 1046.5];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const start = tChime + idx * 0.055;
        osc.type = idx === 2 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f, start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(idx === 0 ? 0.075 : 0.055, start + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.95);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(start);
        osc.stop(start + 1.0);
        nodes.push(osc);
      });
    } catch (_) {}

    return () => {
      nodes.forEach((n) => {
        try { n.stop(0); } catch (_) {}
      });
    };
  }

  // =========================================================================
  // Three.js Geometry & Custom Shader Builders
  // =========================================================================
  function buildShapeFromPts(THREE, pts) {
    const vecs = pts.map(([x, y]) => new THREE.Vector2(x, y));
    // Ensure counter-clockwise winding so extruded normals & bevels face outward
    if (THREE.ShapeUtils.isClockWise(vecs)) {
      vecs.reverse();
    }
    const shape = new THREE.Shape(vecs);
    shape.closePath();
    return shape;
  }

  function createParticleTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.28, 'rgba(255, 120, 140, 0.85)');
    grad.addColorStop(0.65, 'rgba(255, 0, 34, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Computes a smooth progressive draw-order value [0..1] along each edge vertex
   * so the laser tracer sweeps organically along the C-arc into the wolf head.
   */
  function attachDrawOrderAttribute(THREE, edgeGeom) {
    const pos = edgeGeom.attributes.position;
    const count = pos.count;
    const order = new Float32Array(count);

    // Branch cut placed at angle = -0.55 rad (empty space between bottom C tip & wolf snout)
    const SEAM_ANGLE = -0.55;
    const TWO_PI = Math.PI * 2;
    const getAngleOrder = (x, y) => {
      let a = Math.atan2(y, x) - SEAM_ANGLE;
      while (a < 0) a += TWO_PI;
      while (a >= TWO_PI) a -= TWO_PI;
      // Normalize counter-clockwise from bottom jaw gap up through C & ear, ending on muzzle
      return a / TWO_PI;
    };

    for (let i = 0; i < count; i += 2) {
      const x0 = pos.getX(i), y0 = pos.getY(i);
      const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1);
      let o0 = getAngleOrder(x0, y0);
      let o1 = getAngleOrder(x1, y1);
      // Guard any remaining segment crossing wrap boundary
      if (Math.abs(o0 - o1) > 0.5) {
        const avg = Math.min(o0, o1);
        o0 = avg;
        o1 = avg;
      }
      order[i] = Math.min(1.0, Math.max(0.0, o0));
      order[i + 1] = Math.min(1.0, Math.max(0.0, o1));
    }

    edgeGeom.setAttribute('aDrawOrder', new THREE.BufferAttribute(order, 1));
    return edgeGeom;
  }

  function createLaserEdgeMaterial(THREE, isCrimsonAccent) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDrawProgress: { value: 0.0 },
        uGlowFade: { value: 1.0 },
        uColorBase: {
          value: isCrimsonAccent
            ? new THREE.Color(0xff0022)
            : new THREE.Color(0xdbe2f0)
        },
        uColorLaser: { value: new THREE.Color(0xff1a3c) },
        uColorSpark: { value: new THREE.Color(0xffffff) }
      },
      vertexShader: `
        attribute float aDrawOrder;
        varying float vOrder;
        void main() {
          vOrder = aDrawOrder;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uDrawProgress;
        uniform float uGlowFade;
        uniform vec3 uColorBase;
        uniform vec3 uColorLaser;
        uniform vec3 uColorSpark;
        varying float vOrder;

        void main() {
          if (vOrder > uDrawProgress) discard;
          float distFromHead = clamp(uDrawProgress - vOrder, 0.0, 1.0);
          float headPulse = 1.0 - smoothstep(0.0, 0.11, distFromHead);
          vec3 col = mix(uColorBase, uColorLaser, 0.55 * (1.0 - smoothstep(0.08, 0.5, distFromHead)));
          col = mix(col, uColorSpark, headPulse * 0.92);
          float alpha = (0.68 + headPulse * 0.32) * uGlowFade;
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
  }

  function applyForgeSolidShader(THREE, material, uniformRef, laserColorHex) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uForgeReveal = uniformRef;
      shader.uniforms.uLaserCol = { value: new THREE.Color(laserColorHex) };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vForgeLocalPos;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvForgeLocalPos = position;'
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uForgeReveal;\nuniform vec3 uLaserCol;\nvarying vec3 vForgeLocalPos;'
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          float forgeCoord = vForgeLocalPos.y * 0.85 + vForgeLocalPos.x * 0.25;
          if (forgeCoord > uForgeReveal) discard;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float fCoord = vForgeLocalPos.y * 0.85 + vForgeLocalPos.x * 0.25;
          float edgeBand = 1.0 - smoothstep(0.0, 0.34, uForgeReveal - fCoord);
          totalEmissiveRadiance += uLaserCol * edgeBand * 2.4;`
        );
    };
    material.customProgramCacheKey = () => `c9z-forge-${laserColorHex}`;
    return material;
  }

  function createEmblemScene(THREE, canvas, onPointerUpdate) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020204, 0.042);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0, 8.8);

    // Tactical Cyber Lighting Rig
    const ambient = new THREE.AmbientLight(0x1f222a, 1.45);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
    keyLight.position.set(4.5, 6.0, 7.5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x9fb8dc, 0.95);
    fillLight.position.set(-6.0, -2.5, 4.5);
    scene.add(fillLight);

    const crimsonSweepLight = new THREE.PointLight(0xff0022, 1.05, 16, 1.5);
    crimsonSweepLight.position.set(-3.5, 2.2, 3.6);
    scene.add(crimsonSweepLight);

    const eyePulseLight = new THREE.PointLight(0xff0022, 0.0, 5.2, 1.8);
    eyePulseLight.position.set(1.4, 0.4, 2.0);
    scene.add(eyePulseLight);

    // Receding Cyber Grid Floor
    const grid = new THREE.GridHelper(28, 36, 0xff0022, 0x1a1a22);
    grid.position.set(0, -3.55, -2.0);
    grid.material.opacity = 0.24;
    grid.material.transparent = true;
    scene.add(grid);

    // Master Group centered slightly right for optical balance
    const logoPivot = new THREE.Group();
    scene.add(logoPivot);

    // Backdrop Orbital HUD Rings behind logo
    const ringGeo1 = new THREE.RingGeometry(3.55, 3.61, 72);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xff0022,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const hudRing1 = new THREE.Mesh(ringGeo1, ringMat1);
    hudRing1.position.z = -1.1;
    logoPivot.add(hudRing1);

    const ringGeo2 = new THREE.RingGeometry(4.05, 4.08, 6); // Hexagonal tactical perimeter
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const hudHexRing = new THREE.Mesh(ringGeo2, ringMat2);
    hudHexRing.position.z = -1.35;
    logoPivot.add(hudHexRing);

    // Expanding Climax Shockwave Ring
    const shockGeo = new THREE.RingGeometry(0.45, 0.65, 64);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xff0022,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const shockwave = new THREE.Mesh(shockGeo, shockMat);
    shockwave.position.set(1.38, 0.38, 0.55); // Centered directly over Wolf Crimson Eye!
    logoPivot.add(shockwave);

    // Shared Forge Reveal Uniform
    const forgeRevealUniform = { value: -4.4 };

    // Extrusion configs (shallow sharp bevels prevent acute corner clipping)
    const whiteExtrudeOpts = {
      depth: 0.42,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.022,
      bevelSegments: 2,
      curveSegments: 4
    };
    const redExtrudeOpts = {
      depth: 0.48,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.018,
      bevelSegments: 2,
      curveSegments: 4
    };

    const whiteSolidMat = applyForgeSolidShader(
      THREE,
      new THREE.MeshStandardMaterial({
        color: 0xf4f5f8,
        metalness: 0.62,
        roughness: 0.24,
        emissive: new THREE.Color(0x111216),
        emissiveIntensity: 0.35
      }),
      forgeRevealUniform,
      0xff0022
    );

    const redSolidMat = applyForgeSolidShader(
      THREE,
      new THREE.MeshStandardMaterial({
        color: 0xe6001f,
        metalness: 0.32,
        roughness: 0.25,
        emissive: new THREE.Color(0xc80018),
        emissiveIntensity: 0.38
      }),
      forgeRevealUniform,
      0xffffff
    );

    const whiteEdgeMat = createLaserEdgeMaterial(THREE, false);
    const redEdgeMat = createLaserEdgeMaterial(THREE, true);

    const disposableGeoms = [];
    const disposableMats = [ringMat1, ringMat2, shockMat, whiteSolidMat, redSolidMat, whiteEdgeMat, redEdgeMat];

    function addLogoPart(pts, extrudeOpts, solidMat, edgeMat, zOffset) {
      const shape = buildShapeFromPts(THREE, pts);
      const solidGeo = new THREE.ExtrudeGeometry(shape, extrudeOpts);
      solidGeo.translate(0, 0, -extrudeOpts.depth * 0.5 + zOffset);
      const edgeGeo = attachDrawOrderAttribute(THREE, new THREE.EdgesGeometry(solidGeo, 18));

      const solidMesh = new THREE.Mesh(solidGeo, solidMat);
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      logoPivot.add(solidMesh);
      logoPivot.add(edgeLines);
      disposableGeoms.push(solidGeo, edgeGeo);
      return { solidMesh, edgeLines };
    }

    addLogoPart(LOGO_SHAPES.whiteCrescent, whiteExtrudeOpts, whiteSolidMat, whiteEdgeMat, 0);
    addLogoPart(LOGO_SHAPES.whiteWolfHead, whiteExtrudeOpts, whiteSolidMat, whiteEdgeMat, 0.01);
    addLogoPart(LOGO_SHAPES.redEarBlade, redExtrudeOpts, redSolidMat, redEdgeMat, 0.04);
    addLogoPart(LOGO_SHAPES.redEye, redExtrudeOpts, redSolidMat, redEdgeMat, 0.06);

    // 3D Orbiting Laser Spark Head Particle
    const particleTex = createParticleTexture(THREE);
    const sparkMat = new THREE.PointsMaterial({
      size: 0.58,
      map: particleTex,
      color: 0xff3355,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.35]), 3));
    const sparkPoint = new THREE.Points(sparkGeo, sparkMat);
    logoPivot.add(sparkPoint);
    disposableGeoms.push(sparkGeo, ringGeo1, ringGeo2, shockGeo);
    disposableMats.push(sparkMat);

    // Ambient 3D Spatial Particles
    const P_COUNT = 220;
    const pPositions = new Float32Array(P_COUNT * 3);
    const pColors = new Float32Array(P_COUNT * 3);
    const pSpeeds = new Float32Array(P_COUNT);
    const colRed = new THREE.Color(0xff0022);
    const colWhite = new THREE.Color(0xd8dde8);

    for (let i = 0; i < P_COUNT; i++) {
      const r = 2.6 + Math.random() * 6.8;
      const theta = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * 7.5;
      pPositions[i * 3] = Math.cos(theta) * r;
      pPositions[i * 3 + 1] = Math.sin(theta) * r * 0.85;
      pPositions[i * 3 + 2] = z;
      pSpeeds[i] = 0.25 + Math.random() * 0.75;

      const c = Math.random() > 0.42 ? colRed : colWhite;
      pColors[i * 3] = c.r;
      pColors[i * 3 + 1] = c.g;
      pColors[i * 3 + 2] = c.b;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.16,
      map: particleTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);
    disposableGeoms.push(dustGeo);
    disposableMats.push(dustMat);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    if (onPointerUpdate) {
      onPointerUpdate(pointer);
    }

    function resize(width, height) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Scale distance gently on narrow mobile portraits so full logo + aura always fits
      camera.fov = w < 600 ? 50 : 40;
      camera.updateProjectionMatrix();
    }

    function update(tNorm, elapsedSec) {
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;

      // Phase 1 (0.00 -> 0.44): Progressive Wireframe Laser Trace
      const drawT = Math.min(1.0, tNorm / 0.46);
      const drawEased = 1 - Math.pow(1 - drawT, 2.15);
      whiteEdgeMat.uniforms.uDrawProgress.value = drawEased;
      redEdgeMat.uniforms.uDrawProgress.value = Math.max(0, (drawT - 0.12) / 0.88);

      // Keep crisp edge highlights visible, soften slightly after ignition
      const edgeFade = tNorm < 0.72 ? 1.0 : Math.max(0.38, 1.0 - (tNorm - 0.72) * 2.1);
      whiteEdgeMat.uniforms.uGlowFade.value = edgeFade;
      redEdgeMat.uniforms.uGlowFade.value = Math.max(0.65, edgeFade);

      // Orbiting laser spark along primary contour arc
      if (drawT > 0.02 && drawT < 0.96) {
        const angle = -0.55 + drawEased * Math.PI * 2;
        const rad = 2.65;
        sparkPoint.position.set(Math.cos(angle) * rad, Math.sin(angle) * rad, 0.38);
        sparkMat.opacity = 0.95 * (1 - Math.abs(drawT - 0.5) * 0.5);
      } else {
        sparkMat.opacity = 0.0;
      }

      // Phase 2 (0.34 -> 0.72): Bottom-to-Top Metallic Extrusion Solidification
      const forgeT = Math.min(1.0, Math.max(0.0, (tNorm - 0.34) / 0.38));
      const forgeEased = forgeT < 0.5
        ? 2 * forgeT * forgeT
        : 1 - Math.pow(-2 * forgeT + 2, 2) / 2;
      forgeRevealUniform.value = -4.2 + forgeEased * 8.6;

      // Phase 3 (0.68 -> 0.92): Crimson Eye & Ear Ignition + Shockwave
      const igniteT = Math.min(1.0, Math.max(0.0, (tNorm - 0.68) / 0.24));
      const igniteSpike = igniteT > 0 ? Math.sin(Math.min(1, igniteT) * Math.PI) : 0;
      redSolidMat.emissiveIntensity = 0.38 + igniteT * 0.55 + igniteSpike * 0.85;
      eyePulseLight.intensity = igniteSpike * 2.8 + (tNorm > 0.76 ? 0.65 : 0);

      if (igniteT > 0 && igniteT < 1.0) {
        const sScale = 1.0 + igniteT * 10.5;
        shockwave.scale.set(sScale, sScale, 1);
        shockMat.opacity = (1.0 - igniteT) * 0.78;
      } else {
        shockMat.opacity = 0.0;
      }

      // HUD rings & crimson rim light sweep
      const ringAlpha = Math.min(1.0, tNorm * 2.2);
      ringMat1.opacity = ringAlpha * 0.32;
      ringMat2.opacity = ringAlpha * 0.14;
      hudRing1.rotation.z = elapsedSec * 0.35;
      hudHexRing.rotation.z = -elapsedSec * 0.22;

      crimsonSweepLight.position.x = Math.sin(elapsedSec * 2.1) * 4.5;
      crimsonSweepLight.position.y = Math.cos(elapsedSec * 1.6) * 2.6;

      // Charismatic Camera Choreography + Responsive Portrait Framing + Hero 3D Parallax
      const camPull = Math.min(1.0, tNorm / 0.75);
      const camSmooth = 1 - Math.pow(1 - camPull, 3);
      const portraitExtraZ = camera.aspect < 1.0 ? (1.0 / Math.max(0.42, camera.aspect) - 1.0) * 3.8 : 0;
      const baseZ = 5.4 + camSmooth * 3.85 + portraitExtraZ;
      camera.position.x = -2.2 * (1 - camSmooth) + pointer.x * 0.65;
      camera.position.y = -1.15 * (1 - camSmooth) + pointer.y * 0.45;
      camera.position.z = baseZ;
      const focusY = camera.aspect < 1.0 ? 0.35 : 0.15;
      camera.lookAt(0, focusY, 0);

      // Dramatic charismatic 3D banking twist settling toward hero pose
      const bankRotY = -0.62 * (1 - camSmooth) + Math.sin(elapsedSec * 1.15) * 0.07 + pointer.x * 0.22;
      const bankRotX = 0.24 * (1 - camSmooth) - pointer.y * 0.16;
      logoPivot.rotation.set(bankRotX, bankRotY, 0);
      logoPivot.position.y = Math.sin(elapsedSec * 2.0) * 0.08 + (camera.aspect < 1.0 ? 0.48 : 0.15);

      // Gentle upward ember drift + burst acceleration during ignition
      const posAttr = dustGeo.attributes.position;
      const burst = igniteSpike * 0.04;
      for (let i = 0; i < P_COUNT; i++) {
        let py = posAttr.getY(i) + (0.008 * pSpeeds[i] + burst);
        if (py > 5.2) py = -5.2;
        posAttr.setY(i, py);
      }
      posAttr.needsUpdate = true;
      dustPoints.rotation.y = elapsedSec * 0.06;

      renderer.render(scene, camera);
    }

    function dispose() {
      disposableGeoms.forEach((g) => { try { g.dispose(); } catch (_) {} });
      disposableMats.forEach((m) => { try { m.dispose(); } catch (_) {} });
      try { particleTex.dispose(); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    }

    return { resize, update, dispose };
  }

  // =========================================================================
  // Ceremony Overlay Controller & SVG Fallback
  // =========================================================================
  function playCeremony(invoice, options = {}) {
    if (typeof activeCleanup === 'function') {
      activeCleanup(true);
    }

    const onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
    const orderCode = (invoice && invoice.orderCode) ? String(invoice.orderCode) : 'C9Z-VERIFIED';
    const isReplay = Boolean(options.isReplay);

    // Respect user reduced-motion preference on first checkout unless explicit Replay
    if (isReducedMotion() && !isReplay) {
      onComplete();
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'c9z-ceremony-overlay';
    overlay.className = 'c9z-ceremony-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'تأكيد طلب c9zwolf ثلاثي الأبعاد');

    const mutedInit = isMuted();
    overlay.innerHTML = `
      <canvas class="c9z-ceremony-canvas" id="c9z-ceremony-canvas"></canvas>
      <div class="c9z-ceremony-fallback" id="c9z-ceremony-fallback" aria-hidden="true">
        <div class="c9z-fallback-3d-wrap">
          <div class="c9z-fallback-ring"></div>
          ${getLogoSvgMarkup('c9z-wolf-vector c9z-fallback-svg')}
        </div>
      </div>

      <div class="c9z-ceremony-hud-top">
        <div class="c9z-ceremony-chip mono">
          <span class="c9z-hud-dot"></span>
          <span>C9Z SECURE PROTOCOL // ${escHtml(orderCode)}</span>
        </div>
        <div class="c9z-ceremony-controls">
          <button type="button" class="btn btn-secondary btn-sm c9z-ceremony-btn" id="c9z-ceremony-mute" aria-pressed="${mutedInit ? 'true' : 'false'}">
            <span>${mutedInit ? 'تشغيل الصوت' : 'كتم الصوت'}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm c9z-ceremony-btn" id="c9z-ceremony-skip">
            <span>تخطي العرض ←</span>
          </button>
        </div>
      </div>

      <div class="c9z-ceremony-hud-bottom">
        <div class="c9z-ceremony-phase-tag mono" id="c9z-ceremony-tag">TRACING BRAND VECTOR // C9Z_3D</div>
        <div class="c9z-ceremony-status" id="c9z-ceremony-status">جارٍ رسم وتشكيل شعار c9zwolf بالليزر ثلاثي الأبعاد...</div>
        <div class="c9z-ceremony-bar-track">
          <div class="c9z-ceremony-bar-fill" id="c9z-ceremony-bar"></div>
        </div>
      </div>
    `;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);

    // Force reflow before fade-in
    void overlay.offsetWidth;
    overlay.classList.add('active');

    const canvas = document.getElementById('c9z-ceremony-canvas');
    const fallbackEl = document.getElementById('c9z-ceremony-fallback');
    const tagEl = document.getElementById('c9z-ceremony-tag');
    const statusEl = document.getElementById('c9z-ceremony-status');
    const barEl = document.getElementById('c9z-ceremony-bar');
    const muteBtn = document.getElementById('c9z-ceremony-mute');
    const skipBtn = document.getElementById('c9z-ceremony-skip');

    let stopAudio = () => {};
    let sceneCtrl = null;
    let rafId = 0;
    let pointerState = null;
    let finished = false;
    let phaseIndex = 0;

    try {
      if (global.THREE && canvas) {
        sceneCtrl = createEmblemScene(global.THREE, canvas, (ptr) => {
          pointerState = ptr;
        });
        sceneCtrl.resize(overlay.clientWidth || global.innerWidth, overlay.clientHeight || global.innerHeight);
      }
    } catch (_) {
      sceneCtrl = null;
    }

    if (!sceneCtrl && fallbackEl) {
      fallbackEl.classList.add('active');
    }

    stopAudio = scheduleCeremonyAudio();

    const handleResize = () => {
      if (sceneCtrl) {
        sceneCtrl.resize(overlay.clientWidth || global.innerWidth, overlay.clientHeight || global.innerHeight);
      }
    };

    const handlePointerMove = (e) => {
      if (!pointerState) return;
      const w = global.innerWidth || 1;
      const h = global.innerHeight || 1;
      pointerState.tx = ((e.clientX / w) - 0.5) * 2;
      pointerState.ty = ((e.clientY / h) - 0.5) * -2;
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        finish(true);
      }
    };

    global.addEventListener('resize', handleResize);
    global.addEventListener('pointermove', handlePointerMove, { passive: true });
    global.addEventListener('keydown', handleKeyDown);

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const nextMuted = !isMuted();
        setMuted(nextMuted);
        muteBtn.setAttribute('aria-pressed', nextMuted ? 'true' : 'false');
        muteBtn.querySelector('span').textContent = nextMuted ? 'تشغيل الصوت' : 'كتم الصوت';
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', () => finish(true));
    }

    function updateTelemetry(tNorm) {
      if (barEl) {
        barEl.style.transform = `scaleX(${Math.min(1, tNorm).toFixed(4)})`;
      }
      if (tNorm >= 0.68 && phaseIndex < 2) {
        phaseIndex = 2;
        if (tagEl) tagEl.textContent = `CRIMSON CORE IGNITION // ${orderCode}`;
        if (statusEl) {
          statusEl.textContent = 'تم تأكيد طلبك بنجاح — جارٍ عرض تفاصيل الفاتورة...';
          statusEl.classList.add('confirmed');
        }
      } else if (tNorm >= 0.34 && phaseIndex < 1) {
        phaseIndex = 1;
        if (tagEl) tagEl.textContent = 'FORGING METALLIC EXTRUSION // 3D MESH';
        if (statusEl) statusEl.textContent = 'تجسيد الشعار المعدني وتفعيل الإضاءة القرمزية...';
      }
    }

    function finish(immediate = false) {
      if (finished) return;
      finished = true;

      if (rafId) cancelAnimationFrame(rafId);
      global.removeEventListener('resize', handleResize);
      global.removeEventListener('pointermove', handlePointerMove);
      global.removeEventListener('keydown', handleKeyDown);

      if (immediate) stopAudio();

      if (immediate) {
        if (sceneCtrl) sceneCtrl.dispose();
        overlay.remove();
        document.body.style.overflow = prevOverflow;
        activeCleanup = null;
        onComplete();
        return;
      }

      overlay.classList.add('closing');
      onComplete();
      global.setTimeout(() => {
        if (sceneCtrl) sceneCtrl.dispose();
        overlay.remove();
        document.body.style.overflow = prevOverflow;
        activeCleanup = null;
      }, 440);
    }

    activeCleanup = (forceImmediate) => finish(Boolean(forceImmediate));

    const tStart = performance.now();
    function frame(now) {
      if (finished) return;
      const elapsedSec = (now - tStart) / 1000;
      const tNorm = Math.min(1.0, elapsedSec / DURATION_SEC);

      updateTelemetry(tNorm);
      if (sceneCtrl) {
        sceneCtrl.update(tNorm, elapsedSec);
      }

      if (tNorm >= 1.0) {
        finish(false);
        return;
      }
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
  }

  global.C9ZOrderCeremony = {
    play: playCeremony,
    unlockAudio,
    getLogoSvgMarkup
  };
})(window);
