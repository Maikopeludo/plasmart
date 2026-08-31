import React, { useState, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// ---------- Geometría ----------
function computeGeometry(segments) {
  let angleDeg = 0;
  let x = 0, y = 0;
  const pts = [{ x, y }];
  const dirs = [];
  segments.forEach((seg, i) => {
    const rad = (angleDeg * Math.PI) / 180;
    x += (parseFloat(seg.length) || 0) * Math.cos(rad);
    y += (parseFloat(seg.length) || 0) * Math.sin(rad);
    pts.push({ x, y });
    dirs.push(angleDeg);
    if (i < segments.length - 1) {
      angleDeg += parseFloat(seg.angle) || 0;
    }
  });
  return { pts, dirs };
}

function bbox(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => -p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// genera una versión "redondeada" del perfil: reemplaza cada vértice por un
// arco tangente del radio de plegado indicado (si es 0, queda el vértice a filo)
function computeRoundedPoints(segments, pts, dirs) {
  const ARC_SEGMENTS = 14;
  const out = [pts[0]];
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const radius = isLast ? 0 : parseFloat(segments[i].radius) || 0;
    const turnDeg = isLast ? 0 : parseFloat(segments[i].angle) || 0;

    if (radius > 0 && turnDeg !== 0 && !isLast) {
      const turnRad = (Math.abs(turnDeg) * Math.PI) / 180;
      const L = radius * Math.tan(turnRad / 2);
      const segLenCur = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const p3 = pts[i + 2];
      const segLenNext = Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const Lc = Math.min(L, segLenCur * 0.49, segLenNext * 0.49);

      const dirRad = (dirs[i] * Math.PI) / 180;
      const tBefore = {
        x: p2.x - Lc * Math.cos(dirRad),
        y: p2.y - Lc * Math.sin(dirRad),
      };
      const turnSign = turnDeg > 0 ? 1 : -1;
      const normalAngle = dirRad + turnSign * (Math.PI / 2);
      const center = {
        x: tBefore.x + radius * Math.cos(normalAngle),
        y: tBefore.y + radius * Math.sin(normalAngle),
      };
      const a0 = Math.atan2(tBefore.y - center.y, tBefore.x - center.x);
      const sweep = turnSign * turnRad;

      out.push(tBefore);
      for (let k = 1; k <= ARC_SEGMENTS; k++) {
        const a = a0 + (sweep * k) / ARC_SEGMENTS;
        out.push({
          x: center.x + radius * Math.cos(a),
          y: center.y + radius * Math.sin(a),
        });
      }
    } else {
      out.push(p2);
    }
  }
  return out;
}

const PRESETS = {
  L: [
    { length: 50, angle: 90, radius: 3 },
    { length: 50, angle: 0, radius: 0 },
  ],
  U: [
    { length: 30, angle: 90, radius: 3 },
    { length: 60, angle: 90, radius: 3 },
    { length: 30, angle: 0, radius: 0 },
  ],
  Z: [
    { length: 40, angle: 135, radius: 3 },
    { length: 25, angle: 135, radius: 3 },
    { length: 40, angle: 0, radius: 0 },
  ],
  Sombrero: [
    { length: 20, angle: 90, radius: 3 },
    { length: 25, angle: -90, radius: 3 },
    { length: 50, angle: -90, radius: 3 },
    { length: 25, angle: 90, radius: 3 },
    { length: 20, angle: 0, radius: 0 },
  ],
};

let uid = 100;
const nid = () => uid++;

// ---------- Vista 3D (extrusión del perfil) ----------
function ThreeDProfile({ pts, depth }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 400;
    const h = 460;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e2337);

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ("outputEncoding" in renderer) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dir1.position.set(1, 1, 1);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xbcd4de, 0.7);
    dir2.position.set(-1, -0.5, -1);
    scene.add(dir2);
    const dir3 = new THREE.DirectionalLight(0xffffff, 0.5);
    dir3.position.set(0, 1, -1);
    scene.add(dir3);

    const group = new THREE.Group();
    scene.add(group);

    const rig = { group, camera, renderer, scene, raf: null };
    stateRef.current = rig;

    let dragging = false;
    let lastX = 0,
      lastY = 0;
    let rotX = -0.35,
      rotY = 0.6;

    function applyRot() {
      group.rotation.x = rotX;
      group.rotation.y = rotY;
    }

    function onDown(e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      rotY += dx * 0.008;
      rotX += dy * 0.008;
      rotX = Math.max(-1.4, Math.min(1.4, rotX));
      applyRot();
    }
    function onUp() {
      dragging = false;
    }
    function onWheel(e) {
      e.preventDefault();
      const factor = 1 + (e.deltaY > 0 ? 0.08 : -0.08);
      camera.position.multiplyScalar(factor);
    }

    const dom = renderer.domElement;
    dom.style.cursor = "grab";
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    applyRot();

    function animate() {
      rig.raf = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(rig.raf);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      renderer.dispose();
      if (mount.contains(dom)) mount.removeChild(dom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (re)construir la geometría cuando cambian los puntos o la profundidad
  useEffect(() => {
    const rig = stateRef.current;
    if (!rig || !rig.group) return;
    const { group, camera } = rig;

    while (group.children.length) {
      const c = group.children.pop();
      c.geometry && c.geometry.dispose();
      c.material && c.material.dispose();
    }

    if (!pts || pts.length < 2 || !depth) return;

    // centrar el perfil en X/Y y la profundidad en Z
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cz = depth / 2;

    const positions = [];
    const indices = [];
    let vi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const x1 = p1.x - cx,
        y1 = p1.y - cy;
      const x2 = p2.x - cx,
        y2 = p2.y - cy;
      // front (z=0) y back (z=depth)
      positions.push(x1, y1, 0 - cz);
      positions.push(x2, y2, 0 - cz);
      positions.push(x2, y2, depth - cz);
      positions.push(x1, y1, depth - cz);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2); // doble cara
      vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xd7dce1,
      metalness: 0,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const edgeGeo = new THREE.EdgesGeometry(geo, 20);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0c1b2a });
    group.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // encuadrar cámara según el tamaño del perfil
    const width = Math.max(...xs) - Math.min(...xs) || 1;
    const height = Math.max(...ys) - Math.min(...ys) || 1;
    const diag = Math.sqrt(width * width + height * height + depth * depth);
    const distance = diag * 1.4 + 20;
    camera.position.set(distance * 0.6, distance * 0.45, distance * 0.8);
    camera.lookAt(0, 0, 0);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
  }, [pts, depth]);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        height: 460,
        borderRadius: 8,
        overflow: "hidden",
      }}
    />
  );
}

export default function App() {
  const [segments, setSegments] = useState(
    PRESETS.U.map((s) => ({ ...s, id: nid() }))
  );
  const [depth, setDepth] = useState(400);
  const [viewMode, setViewMode] = useState("2d");

  const { pts, dirs } = useMemo(() => computeGeometry(segments), [segments]);
  const box = useMemo(() => bbox(pts), [pts]);

  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const diag = Math.sqrt(width * width + height * height);
  const pad = Math.max(diag * 0.28, 25);
  const viewBox = `${box.minX - pad} ${box.minY - pad} ${width + 2 * pad} ${
    height + 2 * pad
  }`;
  const fontSize = Math.max(diag * 0.035, 3.2);
  const labelOffset = Math.max(diag * 0.09, 6);
  const arcR = Math.max(diag * 0.06, 4);

  const totalLength = segments.reduce(
    (a, s) => a + (parseFloat(s.length) || 0),
    0
  );

  function updateSegment(id, field, value) {
    setSegments((segs) =>
      segs.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  }

  function addSegment() {
    setSegments((segs) => [
      ...segs,
      { length: 30, angle: 90, radius: 3, id: nid() },
    ]);
  }

  function removeSegment(id) {
    setSegments((segs) =>
      segs.length > 2 ? segs.filter((s) => s.id !== id) : segs
    );
  }

  function loadPreset(name) {
    setSegments(PRESETS[name].map((s) => ({ ...s, id: nid() })));
  }

  // puntos en coordenadas SVG (y invertido)
  const roundedPts = useMemo(
    () => computeRoundedPoints(segments, pts, dirs),
    [segments, pts, dirs]
  );
  const svgPts = pts.map((p) => ({ x: p.x, y: -p.y }));
  const roundedSvgPts = roundedPts.map((p) => ({ x: p.x, y: -p.y }));
  const polylineStr = roundedSvgPts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        fontFamily:
          "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
        background: "#0c1b2a",
        color: "#dce8f2",
        padding: 24,
        minHeight: 560,
        boxSizing: "border-box",
        borderRadius: 12,
      }}
    >
      {/* Panel de datos */}
      <div style={{ flex: "1 1 320px", minWidth: "min(300px, 100%)" }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: 2,
            color: "#5fd0e0",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Perfil de plegado · datos de tramos
        </div>
        <h1
          style={{
            fontSize: 20,
            margin: "0 0 14px 0",
            fontWeight: 600,
            color: "#f2f7fb",
          }}
        >
          Ingresá largos y ángulos
        </h1>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              onClick={() => loadPreset(name)}
              style={{
                background: "#12283d",
                border: "1px solid #21415c",
                color: "#a9c6d8",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {segments.map((seg, i) => (
            <div
              key={seg.id}
              style={{
                background: "#0f2437",
                border: "1px solid #1c3a52",
                borderRadius: 8,
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: "#5fd0e0",
                  width: 46,
                }}
              >
                Tramo {i + 1}
              </div>

              <label style={{ fontSize: 11, color: "#8fb0c4" }}>
                Largo (mm)
                <input
                  type="number"
                  value={seg.length}
                  onChange={(e) =>
                    updateSegment(seg.id, "length", e.target.value)
                  }
                  style={inputStyle}
                />
              </label>

              {i < segments.length - 1 ? (
                <>
                  <label style={{ fontSize: 11, color: "#8fb0c4" }}>
                    Ángulo de giro (°)
                    <input
                      type="number"
                      value={seg.angle}
                      onChange={(e) =>
                        updateSegment(seg.id, "angle", e.target.value)
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ fontSize: 11, color: "#8fb0c4" }}>
                    Radio de plegado (mm)
                    <input
                      type="number"
                      min="0"
                      value={seg.radius ?? 0}
                      onChange={(e) =>
                        updateSegment(seg.id, "radius", e.target.value)
                      }
                      style={inputStyle}
                    />
                  </label>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "#4c6478", flex: 1 }}>
                  (tramo final, sin giro)
                </div>
              )}

              <button
                onClick={() => removeSegment(seg.id)}
                title="Quitar tramo"
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "1px solid #3a5b74",
                  color: "#96b3c4",
                  borderRadius: 6,
                  width: 26,
                  height: 26,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addSegment}
          style={{
            marginTop: 10,
            background: "#123b52",
            border: "1px solid #1f5978",
            color: "#8fe0ee",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          + Agregar tramo
        </button>

        <div
          style={{
            marginTop: 16,
            background: "#0f2437",
            border: "1px solid #1c3a52",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <label style={{ fontSize: 11, color: "#8fb0c4" }}>
            Longitud de la pieza (profundidad del perfil, mm)
            <input
              type="number"
              value={depth}
              onChange={(e) => setDepth(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, width: 100 }}
            />
          </label>
          <div style={{ fontSize: 10.5, color: "#5a7789", marginTop: 6 }}>
            Es cuánto mide la pieza a lo largo del pliegue (ej: un caño de
            2000 mm de largo). Se usa solo para la vista 3D.
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: "#8fb0c4",
            borderTop: "1px solid #1c3a52",
            paddingTop: 12,
          }}
        >
          Desarrollo (suma de tramos):{" "}
          <span style={{ color: "#f2f7fb" }}>
            {totalLength.toFixed(1)} mm
          </span>
          <div style={{ fontSize: 10.5, color: "#5a7789", marginTop: 6 }}>
            * Suma simple de largos ingresados. No incluye deducción de
            plegado (bend allowance/K-factor) — para desarrollo real de
            fabricación conviene validar con una calculadora de bend
            deduction o el software de tu plegadora.
          </div>
        </div>
      </div>

      {/* Dibujo */}
      <div
        style={{
          flex: "2 1 420px",
          minWidth: "min(340px, 100%)",
          background:
            "radial-gradient(circle at 20px 20px, #16324a 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          backgroundColor: "#0e2337",
          border: "1px solid #1c3a52",
          borderRadius: 10,
          padding: 10,
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {[
            ["2d", "Vista 2D"],
            ["3d", "Vista 3D"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              style={{
                background: viewMode === key ? "#1f5978" : "#12283d",
                border: "1px solid #21415c",
                color: viewMode === key ? "#f2f7fb" : "#a9c6d8",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
          {viewMode === "3d" && (
            <div
              style={{
                marginLeft: "auto",
                fontSize: 10.5,
                color: "#5a7789",
                alignSelf: "center",
              }}
            >
              arrastrá para rotar · rueda para zoom
            </div>
          )}
        </div>

        {viewMode === "3d" ? (
          <ThreeDProfile pts={roundedPts} depth={depth} />
        ) : (
        <svg
          viewBox={viewBox}
          width="100%"
          height="460"
          style={{ overflow: "visible" }}
        >
          {/* perfil */}
          <polyline
            points={polylineStr}
            fill="none"
            stroke="#5fd0e0"
            strokeWidth={Math.max(diag * 0.012, 0.8)}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* vértices */}
          {svgPts.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={Math.max(diag * 0.012, 1)}
              fill="#f2f7fb"
            />
          ))}

          {/* cotas de largo */}
          {segments.map((seg, i) => {
            const p1 = svgPts[i];
            const p2 = svgPts[i + 1];
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            // perpendicular unit vector
            const nx = -dy / len;
            const ny = dx / len;
            const lx = mx + nx * labelOffset;
            const ly = my + ny * labelOffset;
            return (
              <text
                key={i}
                x={lx}
                y={ly}
                fontSize={fontSize}
                fill="#c9e3ee"
                fontFamily="'IBM Plex Mono', monospace"
                textAnchor="middle"
              >
                {parseFloat(seg.length || 0).toFixed(0)} mm
              </text>
            );
          })}

          {/* ángulos en vértices intermedios */}
          {segments.slice(0, -1).map((seg, i) => {
            const vertex = svgPts[i + 1];
            const dirIn = dirs[i]; // dirección del tramo entrante (grados, coord matemáticas)
            const turn = parseFloat(seg.angle) || 0;
            const dirOut = dirIn + turn;

            // vectores en coord SVG (y invertida)
            const a1 = ((dirIn + 180) * Math.PI) / 180; // apunta hacia atrás por el tramo entrante
            const a2 = (dirOut * Math.PI) / 180;

            const p1 = {
              x: vertex.x + arcR * Math.cos(a1),
              y: vertex.y - arcR * Math.sin(a1),
            };
            const p2 = {
              x: vertex.x + arcR * Math.cos(a2),
              y: vertex.y - arcR * Math.sin(a2),
            };
            const largeArc = Math.abs(turn) > 180 ? 1 : 0;
            const sweep = turn > 0 ? 1 : 0;

            const bisectorAngle = ((dirIn + 180 + dirOut) / 2) * Math.PI / 180;
            const labelR = arcR * 1.9;
            const lx = vertex.x + labelR * Math.cos(bisectorAngle);
            const ly = vertex.y - labelR * Math.sin(bisectorAngle);

            const interior = (180 - Math.abs(turn)).toFixed(0);

            return (
              <g key={i}>
                <path
                  d={`M ${p1.x} ${p1.y} A ${arcR} ${arcR} 0 ${largeArc} ${sweep} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke="#e0a55f"
                  strokeWidth={Math.max(diag * 0.006, 0.5)}
                />
                <text
                  x={lx}
                  y={ly}
                  fontSize={fontSize * 0.92}
                  fill="#e0a55f"
                  fontFamily="'IBM Plex Mono', monospace"
                  textAnchor="middle"
                >
                  giro {turn}° (int. {interior}°)
                </text>
              </g>
            );
          })}
        </svg>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  display: "block",
  marginTop: 2,
  width: 68,
  background: "#0a1826",
  border: "1px solid #274a63",
  color: "#eef6fb",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 12,
  fontFamily: "'IBM Plex Mono', monospace",
};
