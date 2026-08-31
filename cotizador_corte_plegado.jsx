import React, { useState, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { Plus, Trash2, MessageCircle, Layers, Scissors, X, FileDown } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "./src/assets/plasmart-logo.png";
import { parseDxfToShape } from "./dxf-utils.js";
// Requiere agregar las dependencias al proyecto: npm install jspdf jspdf-autotable

/* =========================================================================
   PALETA / TIPOGRAFÍA — misma identidad industrial de las calculadoras
   previas (fondo azul acero oscuro, acentos cian + naranja, IBM Plex).
   ========================================================================= */
const BG = "#0c1b2a";
const PANEL = "#0f2437";
const PANEL2 = "#12283d";
const INPUT_BG = "#0a1826";
const BORDER = "#1c3a52";
const BORDER2 = "#21415c";
const TEXT = "#f2f7fb";
const TEXT_MUT = "#8fb0c4";
const TEXT_DIM = "#5a7789";
const CYAN = "#5fd0e0";
const CYAN_DIM = "#1f5978";
const ORANGE = "#e8871e";
const ORANGE_DIM = "#c76f13";
const GREEN = "#4caf7d";
const RED = "#e2596b";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans','Segoe UI',system-ui,sans-serif";

/* =========================================================================
   DATOS BASE
   ========================================================================= */
const MATERIALES = [
  { key: "carbono", label: "Acero al carbono", densidad: 7850 },
  { key: "inox", label: "Acero inoxidable", densidad: 8000 },
  { key: "aluminio", label: "Aluminio", densidad: 2700 },
  { key: "cobre", label: "Cobre", densidad: 8960 },
  { key: "bronce", label: "Bronce", densidad: 8800 },
];

// Espesores comerciales estándar (mm) — por ahora solo para acero al carbono.
// El resto de los materiales sigue con espesor libre; sumarles su propia lista
// de espesores comerciales queda como mejora futura.
const ESPESORES_CARBONO = [
  0.7, 0.9, 1.25, 1.6, 2, 2.5, 3.2, 4.7, 6.35, 7.9, 9.5, 12.7, 15.8, 19.1,
  22.22, 25.4, 31.8,
];

/* =========================================================================
   PRECIOS — único lugar que hay que tocar para actualizar tarifas.
   Todo en pesos argentinos, SIN IVA (el IVA se suma aparte en el total).
   Cuando OroCommerce/panel de admin exista, esto pasa a leerse de ahí;
   por ahora es la fuente de verdad a mano.
   ========================================================================= */
const IVA_PCT = 21;

// Precio por kilo (material + corte láser + plegado, todo incluido salvo
// IVA), según tramo de espesor (mm). "hasta" es inclusive y los tramos se
// evalúan en orden — se usa el primer tramo cuyo límite alcance el
// espesor del ítem.
const PRECIOS_CHAPA_POR_ESPESOR = [
  { hasta: 12.7, precioKgSinIva: 4100 },
  { hasta: Infinity, precioKgSinIva: 4300 },
];

function precioChapaPorKg(espesor) {
  const e = parseFloat(espesor) || 0;
  const tramo = PRECIOS_CHAPA_POR_ESPESOR.find((t) => e <= t.hasta);
  return tramo
    ? tramo.precioKgSinIva
    : PRECIOS_CHAPA_POR_ESPESOR[PRECIOS_CHAPA_POR_ESPESOR.length - 1].precioKgSinIva;
}

// Paleta para diferenciar ítems en el dibujo de la chapa compartida
const PALETA_ITEMS = [
  ORANGE,
  CYAN,
  "#a875e0",
  GREEN,
  "#e2596b",
  "#e0c15f",
  "#5fa3e0",
  "#e07fc0",
  "#7fe0a8",
  "#e0955f",
];

const CHAPAS_ESTANDAR = [
  { key: "1200x2400", label: "1200 × 2400 mm", largo: 2400, ancho: 1200 },
  { key: "1250x2500", label: "1250 × 2500 mm", largo: 2500, ancho: 1250 },
  { key: "1000x2000", label: "1000 × 2000 mm", largo: 2000, ancho: 1000 },
  { key: "1500x3000", label: "1500 × 3000 mm", largo: 3000, ancho: 1500 },
  { key: "custom", label: "Personalizada…", largo: 0, ancho: 0 },
];

const PRESETS_PLEGADO = {
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

// TODO: reemplazar por el número de WhatsApp real de la empresa (con código de país, sin +)
const NUMERO_WHATSAPP = "5493511234567";

let _segUid = 100;
const nextSegId = () => _segUid++;
let _itemUid = 1;
const nextItemId = () => _itemUid++;

/* =========================================================================
   GEOMETRÍA DEL PERFIL DE PLEGADO (adaptado del editor de tramos)
   ========================================================================= */
function computeGeometry(segments) {
  let angleDeg = 0;
  let x = 0,
    y = 0;
  const pts = [{ x, y }];
  const dirs = [];
  segments.forEach((seg, i) => {
    const rad = (angleDeg * Math.PI) / 180;
    x += (parseFloat(seg.length) || 0) * Math.cos(rad);
    y += (parseFloat(seg.length) || 0) * Math.sin(rad);
    pts.push({ x, y });
    dirs.push(angleDeg);
    if (i < segments.length - 1) angleDeg += parseFloat(seg.angle) || 0;
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

function computeRoundedPoints(segments, pts, dirs) {
  const ARC = 14;
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
      for (let k = 1; k <= ARC; k++) {
        const a = a0 + (sweep * k) / ARC;
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

/* =========================================================================
   VISTA 3D DEL PERFIL PLEGADO (extrusión a lo largo de "profundidad")
   ========================================================================= */
function ThreeDProfile({ pts, depth }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 400;
    const h = 380;

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
      positions.push(x1, y1, 0 - cz);
      positions.push(x2, y2, 0 - cz);
      positions.push(x2, y2, depth - cz);
      positions.push(x1, y1, depth - cz);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
      style={{ width: "100%", height: 380, borderRadius: 8, overflow: "hidden" }}
    />
  );
}

/* =========================================================================
   LOGO — se carga una sola vez y se cachea como dataURL (PNG) para poder
   insertarlo en el PDF con doc.addImage, que necesita base64 y no una URL.
   ========================================================================= */
let _logoDataUrlPromise = null;
function getLogoDataUrl() {
  if (!_logoDataUrlPromise) {
    _logoDataUrlPromise = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // el logo original suele venir a resolución de pantalla (miles de px);
        // en el PDF se imprime a ~20mm, así que lo reducimos antes de
        // insertarlo o jsPDF lo embebe casi sin comprimir y el archivo pesa
        // decenas de MB.
        const MAX_PX = 400;
        const scale = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL("image/png"), w, h });
      };
      img.onerror = () => resolve(null);
      img.src = logoUrl;
    });
  }
  return _logoDataUrlPromise;
}

/* =========================================================================
   MINIATURA DE PIEZA (para el listado de ítems)
   ========================================================================= */
/* =========================================================================
   DIBUJO DE CHAPA EN CANVAS (para exportar como imagen dentro del PDF)
   ========================================================================= */
function dibujarChapaCanvas(sheet, placements, margen, gap, pxW = 340, pxH) {
  const alto = pxH || Math.round(pxW * (sheet.ancho / Math.max(sheet.largo, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pxW, alto);

  const pad = 6;
  const scale = Math.min((pxW - pad * 2) / Math.max(sheet.largo, 1), (alto - pad * 2) / Math.max(sheet.ancho, 1));
  const drawW = sheet.largo * scale;
  const drawH = sheet.ancho * scale;
  const ox = (pxW - drawW) / 2;
  const oy = (alto - drawH) / 2;

  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, drawW, drawH);

  placements.forEach((pl) => {
    let dibujadas = 0;
    outer: for (let r = 0; r < pl.ny; r++) {
      for (let c = 0; c < pl.nx; c++) {
        if (dibujadas >= pl.count) break outer;
        const px = margen + pl.x + c * (pl.pw + gap);
        const py = margen + pl.y + r * (pl.ph + gap);
        const rx = ox + px * scale;
        const ry = oy + py * scale;
        const rw = Math.max(pl.pw * scale, 0.4);
        const rh = Math.max(pl.ph * scale, 0.4);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = pl.color;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pl.color;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(rx, ry, rw, rh);
        dibujadas++;
      }
    }
  });

  return canvas.toDataURL("image/png");
}

// Arma el atributo "d" de un <path> a partir de los loops leídos del DXF
// (contorno + agujeros). fill-rule="evenodd" hace que los loops interiores
// se dibujen como huecos automáticamente, sin importar el orden en que
// vinieron las entidades en el archivo.
function dxfPathD(shape) {
  return shape.loops
    .map((loop) => "M " + loop.map((p) => `${p.x} ${-p.y}`).join(" L ") + " Z")
    .join(" ");
}

function DxfShapeSvg({ shape, size, strokeWidth, dashed = true }) {
  const w = Math.max(shape.width, 1);
  const h = Math.max(shape.height, 1);
  const diag = Math.sqrt(w * w + h * h);
  const pad = Math.max(diag * 0.14, 4);
  const viewBox = `${shape.minX - pad} ${-shape.maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  return (
    <svg viewBox={viewBox} width={size} height={size} style={{ flexShrink: 0, overflow: "visible" }}>
      {dashed && (
        <rect
          x={shape.minX}
          y={-shape.maxY}
          width={w}
          height={h}
          fill="none"
          stroke={TEXT_DIM}
          strokeWidth={Math.max(diag * 0.01, 0.6)}
          strokeDasharray={`${Math.max(diag * 0.03, 1.4)} ${Math.max(diag * 0.02, 1)}`}
        />
      )}
      <path
        d={dxfPathD(shape)}
        fill={CYAN}
        fillOpacity={0.18}
        fillRule="evenodd"
        stroke={CYAN}
        strokeWidth={strokeWidth ?? Math.max(diag * 0.018, 1)}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Versión en SVG (string) de la miniatura de pieza, pensada para rasterizar
// e incrustar en el PDF — misma geometría que ItemThumb pero sobre fondo
// blanco y con el color propio del ítem, en vez de los tonos del tema oscuro.
function itemThumbSvgMarkup(item, size, color) {
  if (item.dxfShape) {
    const s = item.dxfShape;
    const w = Math.max(s.width, 1);
    const h = Math.max(s.height, 1);
    const diag = Math.sqrt(w * w + h * h);
    const pad = Math.max(diag * 0.14, 4);
    const minX = s.minX - pad;
    const minY = -s.maxY - pad;
    const vw = w + 2 * pad;
    const vh = h + 2 * pad;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${minX} ${minY} ${vw} ${vh}">
      <rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="#ffffff"/>
      <rect x="${s.minX}" y="${-s.maxY}" width="${w}" height="${h}" fill="none" stroke="#94a3b8" stroke-width="${Math.max(diag * 0.01, 0.6)}" stroke-dasharray="${Math.max(diag * 0.03, 1.4)} ${Math.max(diag * 0.02, 1)}"/>
      <path d="${dxfPathD(s)}" fill="${color}" fill-opacity="0.25" fill-rule="evenodd" stroke="${color}" stroke-width="${Math.max(diag * 0.02, 1)}" stroke-linejoin="round"/>
    </svg>`;
  }
  if (item.plegadoActivo) {
    const g = computeGeometry(item.segments);
    const rounded = computeRoundedPoints(item.segments, g.pts, g.dirs);
    const pts = rounded.map((p) => ({ x: p.x, y: -p.y }));
    const box = bbox(g.pts);
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const diag = Math.sqrt(w * w + h * h);
    const pad = Math.max(diag * 0.3, 10);
    const minX = box.minX - pad;
    const minY = box.minY - pad;
    const vw = w + 2 * pad;
    const vh = h + 2 * pad;
    const polylineStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${minX} ${minY} ${vw} ${vh}">
      <rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="#ffffff"/>
      <polyline points="${polylineStr}" fill="none" stroke="${color}" stroke-width="${Math.max(diag * 0.032, 1.1)}" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }
  const ancho = parseFloat(item.anchoManual) || 1;
  const largo = parseFloat(item.largoManual) || 1;
  const pad = 6;
  const scale = Math.min((size - pad * 2) / ancho, (size - pad * 2) / largo);
  const w = ancho * scale;
  const h = largo * scale;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#ffffff"/>
    <rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.4"/>
  </svg>`;
}

function svgToPngDataUrl(svgMarkup, px) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);
  });
}

function ItemThumb({ item, size = 56 }) {
  if (item.dxfShape) {
    return <DxfShapeSvg shape={item.dxfShape} size={size} strokeWidth={Math.max(size * 0.02, 1)} />;
  }
  if (item.plegadoActivo) {
    const g = computeGeometry(item.segments);
    const rounded = computeRoundedPoints(item.segments, g.pts, g.dirs);
    const pts = rounded.map((p) => ({ x: p.x, y: -p.y }));
    const box = bbox(g.pts);
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const diag = Math.sqrt(w * w + h * h);
    const pad = Math.max(diag * 0.3, 10);
    const viewBox = `${box.minX - pad} ${box.minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
    const polylineStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
    return (
      <svg viewBox={viewBox} width={size} height={size} style={{ flexShrink: 0 }}>
        <polyline
          points={polylineStr}
          fill="none"
          stroke={CYAN}
          strokeWidth={Math.max(diag * 0.032, 1.1)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const ancho = parseFloat(item.anchoManual) || 1;
  const largo = parseFloat(item.largoManual) || 1;
  const pad = 6;
  const scale = Math.min((size - pad * 2) / ancho, (size - pad * 2) / largo);
  const w = ancho * scale;
  const h = largo * scale;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <rect x={ox} y={oy} width={w} height={h} fill={CYAN} fillOpacity={0.16} stroke={CYAN} strokeWidth={1.4} />
    </svg>
  );
}

/* =========================================================================
   ÍTEM POR DEFECTO
   ========================================================================= */
function crearItem(n) {
  return {
    id: nextItemId(),
    nombre: `Ítem ${n}`,
    proceso: "laser", // "laser" | "plasma" (plasma deshabilitado por ahora)
    material: "carbono",
    espesor: 3.2,
    cantidad: 10,
    anchoManual: 100,
    largoManual: 100,
    dxfShape: null,
    dxfFileName: null,
    dxfError: null,
    plegadoActivo: false,
    profundidad: 400, // largo de la pieza a lo largo del pliegue (si hay plegado)
    segments: PRESETS_PLEGADO.L.map((s) => ({ ...s, id: nextSegId() })),
    sheetKey: "1200x2400",
    sheetCustomLargo: 2400,
    sheetCustomAncho: 1200,
    margenChapa: 10,
    separacionChapa: 5,
  };
}

/* =========================================================================
   CÁLCULO DE MÉTRICAS DE UN ÍTEM (superficie, peso, nesting en chapa)
   ========================================================================= */
function computeItemMetrics(item) {
  const segLenSum = item.segments.reduce(
    (a, s) => a + (parseFloat(s.length) || 0),
    0
  );
  const anchoPieza = item.plegadoActivo
    ? segLenSum
    : item.dxfShape
    ? item.dxfShape.width
    : parseFloat(item.anchoManual) || 0;
  const largoPieza = item.plegadoActivo
    ? parseFloat(item.profundidad) || 0
    : item.dxfShape
    ? item.dxfShape.height
    : parseFloat(item.largoManual) || 0;
  const espesor = parseFloat(item.espesor) || 0;
  const cantidad = Math.max(0, Math.floor(parseFloat(item.cantidad) || 0));
  const densidad =
    MATERIALES.find((m) => m.key === item.material)?.densidad || 7850;

  const areaPiezaM2 = (anchoPieza * largoPieza) / 1e6;
  const areaTotalM2 = areaPiezaM2 * cantidad;
  const perimetroPiezaM = (2 * (anchoPieza + largoPieza)) / 1000;
  const perimetroTotalM = perimetroPiezaM * cantidad;
  const pesoPiezaKg = areaPiezaM2 * (espesor / 1000) * densidad;
  const pesoTotalKg = pesoPiezaKg * cantidad;

  const sheet =
    item.sheetKey === "custom"
      ? {
          largo: parseFloat(item.sheetCustomLargo) || 0,
          ancho: parseFloat(item.sheetCustomAncho) || 0,
        }
      : CHAPAS_ESTANDAR.find((s) => s.key === item.sheetKey);
  const gap = parseFloat(item.separacionChapa) || 0;
  const margen = parseFloat(item.margenChapa) || 0;
  const usableL = Math.max(0, sheet.largo - 2 * margen);
  const usableW = Math.max(0, sheet.ancho - 2 * margen);

  function gridFit(SL, SW, PL, PW) {
    if (PL <= 0 || PW <= 0 || PL > SL || PW > SW)
      return { nx: 0, ny: 0, count: 0 };
    const nx = Math.floor((SL + gap) / (PL + gap));
    const ny = Math.floor((SW + gap) / (PW + gap));
    return { nx, ny, count: nx * ny };
  }
  const normal = gridFit(usableL, usableW, anchoPieza, largoPieza);
  const rotated = gridFit(usableL, usableW, largoPieza, anchoPieza);
  const best =
    rotated.count > normal.count
      ? { ...rotated, rot: true, w: largoPieza, h: anchoPieza }
      : { ...normal, rot: false, w: anchoPieza, h: largoPieza };

  const piezasPorChapa = best.count;
  const chapasNecesarias =
    piezasPorChapa > 0 ? Math.ceil(cantidad / piezasPorChapa) : 0;
  const sheetAreaM2 = (sheet.largo * sheet.ancho) / 1e6;
  const aprovechamientoPct =
    sheetAreaM2 > 0 && piezasPorChapa > 0
      ? ((piezasPorChapa * areaPiezaM2) / sheetAreaM2) * 100
      : 0;
  const pesoChapaKg = sheetAreaM2 * (espesor / 1000) * densidad;
  const pesoTotalChapasKg = chapasNecesarias * pesoChapaKg;
  const cabe = cantidad === 0 || piezasPorChapa > 0;

  const precioKgSinIva = precioChapaPorKg(espesor);
  const precioTotalSinIva = pesoTotalKg * precioKgSinIva;
  const precioTotalConIva = precioTotalSinIva * (1 + IVA_PCT / 100);

  return {
    anchoPieza,
    largoPieza,
    espesor,
    cantidad,
    densidad,
    segLenSum,
    areaPiezaM2,
    areaTotalM2,
    perimetroPiezaM,
    perimetroTotalM,
    pesoPiezaKg,
    pesoTotalKg,
    sheet,
    best,
    piezasPorChapa,
    chapasNecesarias,
    sheetAreaM2,
    aprovechamientoPct,
    pesoChapaKg,
    pesoTotalChapasKg,
    cabe,
    precioKgSinIva,
    precioTotalSinIva,
    precioTotalConIva,
  };
}

/* =========================================================================
   NESTING COMBINADO — varios ítems del mismo material + espesor comparten
   chapa. Modelo de "estantes" (filas): la chapa se llena con filas
   horizontales que se apilan una debajo de la otra sin dejar saltos. En
   cada paso se evalúan dos opciones —reusar el ancho sobrante de una fila
   ya abierta (para que piezas chicas puedan aprovechar ese lugar) o abrir
   una fila nueva justo debajo de las anteriores— y se elige la que más
   área ocupa, sin importar el orden en que se cargaron los ítems. Como
   toda fila nueva se apila debajo de la anterior, no pueden quedar huecos
   flotando en el medio de la chapa: lo que sobra siempre queda abajo,
   listo para pasar a la chapa siguiente. Es una heurística para calcular
   área/cantidad de chapas de forma aproximada y rápida —pensada para
   presupuestar—, no un optimizador de nesting de producción.
   ========================================================================= */
function computeGroupNesting(entries, sheet, margen, gap) {
  const usableL = Math.max(0, sheet.largo - 2 * margen);
  const usableW = Math.max(0, sheet.ancho - 2 * margen);

  const noEntra = new Set();
  const pendientes = entries
    .filter((e) => e.cantidad > 0)
    .map((e) => ({ itemId: e.itemId, color: e.color, ancho: e.ancho, largo: e.largo, restante: e.cantidad }));

  pendientes.forEach((e) => {
    const entraNormal = e.ancho <= usableL && e.largo <= usableW;
    const entraRot = e.largo <= usableL && e.ancho <= usableW;
    if (!entraNormal && !entraRot) {
      noEntra.add(e.itemId);
      e.restante = 0;
    }
  });

  function chapaNueva() {
    return { shelves: [], altoUsado: 0, placements: [] };
  }
  const chapas = [];
  const hayPendientes = () => pendientes.some((e) => e.restante > 0);

  let guardaGlobal = 0;
  while (hayPendientes() && guardaGlobal < 3000) {
    guardaGlobal++;
    const chapaActual = chapaNueva();
    chapas.push(chapaActual);

    let guardaChapa = 0;
    while (guardaChapa < 3000) {
      guardaChapa++;
      let mejor = null;

      // A) reusar el ancho sobrante de filas ya abiertas en esta chapa
      chapaActual.shelves.forEach((s) => {
        const anchoLibre = usableL - s.xUsed;
        if (anchoLibre <= 0) return;
        pendientes.forEach((e) => {
          if (e.restante <= 0) return;
          [
            { pw: e.ancho, ph: e.largo },
            { pw: e.largo, ph: e.ancho },
          ].forEach((orient) => {
            const { pw, ph } = orient;
            if (pw <= 0 || ph <= 0 || ph > s.height + 0.01) return;
            const nx = Math.floor((anchoLibre + gap) / (pw + gap));
            if (nx <= 0) return;
            const count = Math.min(e.restante, nx);
            if (count <= 0) return;
            const areaUsada = count * pw * ph;
            if (!mejor || areaUsada > mejor.areaUsada) {
              mejor = { tipo: "existente", shelf: s, e, pw, ph, count, areaUsada };
            }
          });
        });
      });

      // B) abrir una fila nueva justo debajo de las anteriores
      const altoLibre = usableW - chapaActual.altoUsado;
      if (altoLibre > 0) {
        pendientes.forEach((e) => {
          if (e.restante <= 0) return;
          [
            { pw: e.ancho, ph: e.largo },
            { pw: e.largo, ph: e.ancho },
          ].forEach((orient) => {
            const { pw, ph } = orient;
            if (pw <= 0 || ph <= 0 || ph > altoLibre + 0.01) return;
            const nx = Math.floor((usableL + gap) / (pw + gap));
            if (nx <= 0) return;
            const count = Math.min(e.restante, nx);
            if (count <= 0) return;
            const areaUsada = count * pw * ph;
            if (!mejor || areaUsada > mejor.areaUsada) {
              mejor = { tipo: "nueva", pw, ph, e, count, areaUsada };
            }
          });
        });
      }

      if (!mejor) break; // no entra nada más en esta chapa -> pasar a la siguiente

      if (mejor.tipo === "existente") {
        const { shelf, e, pw, ph, count } = mejor;
        chapaActual.placements.push({
          itemId: e.itemId,
          color: e.color,
          x: shelf.xUsed,
          y: shelf.y,
          nx: count,
          ny: 1,
          pw,
          ph,
          count,
          _shelf: shelf,
        });
        shelf.xUsed += count * pw + count * gap;
        e.restante -= count;
      } else {
        const { pw, ph, e, count } = mejor;
        const nuevaFila = { y: chapaActual.altoUsado, height: ph, xUsed: count * pw + count * gap };
        chapaActual.shelves.push(nuevaFila);
        chapaActual.placements.push({
          itemId: e.itemId,
          color: e.color,
          x: 0,
          y: nuevaFila.y,
          nx: count,
          ny: 1,
          pw,
          ph,
          count,
          _shelf: nuevaFila,
        });
        chapaActual.altoUsado += ph + gap;
        e.restante -= count;
      }
    }

    // Compactación: subimos cada fila para que quede pegada a la
    // anterior, usando la altura REAL ocupada (la pieza más alta que
    // realmente se colocó ahí) en vez de la altura nominal reservada.
    // Cierra cualquier hueco vertical que haya podido quedar entre filas.
    const shelvesOrdenadas = [...chapaActual.shelves].sort((a, b) => a.y - b.y);
    let cursorY = 0;
    shelvesOrdenadas.forEach((s) => {
      const piezasFila = chapaActual.placements.filter((p) => p._shelf === s);
      const alturaReal = piezasFila.reduce((m, p) => Math.max(m, p.ph), 0) || s.height;
      const delta = cursorY - s.y;
      piezasFila.forEach((p) => {
        p.y += delta;
      });
      cursorY += alturaReal + gap;
    });
  }

  chapas.forEach((c) => c.placements.forEach((p) => delete p._shelf));

  pendientes.forEach((e) => {
    if (e.restante > 0) noEntra.add(e.itemId);
  });

  const sheetsUsed = chapas.length;
  const sheetAreaM2 = (sheet.largo * sheet.ancho) / 1e6;
  const aprovechamientoPorChapa = chapas.map((c) => {
    const areaUsadaM2 = c.placements.reduce((a, p) => a + (p.count * p.pw * p.ph) / 1e6, 0);
    return sheetAreaM2 > 0 ? (areaUsadaM2 / sheetAreaM2) * 100 : 0;
  });

  return {
    placementsPerSheet: chapas.map((c) => c.placements),
    sheetsUsed,
    aprovechamientoPorChapa,
    noEntra: Array.from(noEntra),
    usableL,
    usableW,
  };
}


const fmt = (n, d = 1) =>
  isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "—";

const fmtMoney = (n) =>
  isFinite(n)
    ? n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
    : "—";

/* =========================================================================
   MENSAJE DE WHATSAPP
   ========================================================================= */
function buildWhatsAppMessage(items, metricsList, totalChapasGrupos) {
  const lines = ["Hola! Quiero cotizar lo siguiente:", ""];
  items.forEach((item) => {
    const m = metricsList.find((x) => x.id === item.id);
    const mat = MATERIALES.find((mm) => mm.key === item.material)?.label;
    lines.push(`— ${item.nombre} —`);
    lines.push(
      `Proceso: Corte láser${item.plegadoActivo ? " + plegado" : ""}`
    );
    lines.push(`Material: ${mat}, espesor ${item.espesor} mm`);
    lines.push(
      `Medidas de pieza: ${fmt(m.anchoPieza, 0)} x ${fmt(m.largoPieza, 0)} mm`
    );
    if (item.plegadoActivo) {
      lines.push(
        `Plegado: ${item.segments.length} tramos, desarrollo ${fmt(
          m.segLenSum,
          0
        )} mm`
      );
    }
    lines.push(`Cantidad: ${m.cantidad} unidades`);
    lines.push(`Peso total aprox: ${fmt(m.pesoTotalKg, 1)} kg`);
    lines.push("");
  });
  const totalPeso = metricsList.reduce((a, m) => a + m.pesoTotalKg, 0);
  const totalChapas = totalChapasGrupos;
  lines.push(
    `TOTAL PEDIDO: ${fmt(totalPeso, 1)} kg aprox. · ${totalChapas} chapa(s) estimadas`
  );
  return lines.join("\n");
}

/* =========================================================================
   ESTILOS COMPARTIDOS
   ========================================================================= */
const st = {
  panel: {
    background: PANEL,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: 16,
  },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 2,
    color: CYAN,
    textTransform: "uppercase",
  },
  label: { fontSize: 11, color: TEXT_MUT, display: "block", marginBottom: 4 },
  input: {
    width: "100%",
    background: INPUT_BG,
    border: `1px solid ${BORDER2}`,
    color: TEXT,
    borderRadius: 5,
    padding: "7px 9px",
    fontSize: 13,
    fontFamily: MONO,
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    background: INPUT_BG,
    border: `1px solid ${BORDER2}`,
    color: TEXT,
    borderRadius: 5,
    padding: "7px 9px",
    fontSize: 13,
    fontFamily: SANS,
    boxSizing: "border-box",
  },
  metric: {
    background: PANEL2,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    padding: "10px 12px",
  },
  metricK: {
    fontSize: 10.5,
    color: TEXT_MUT,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricV: { fontSize: 18, fontWeight: 600, color: TEXT, fontFamily: MONO },
};

function btnStyle({ active, variant = "default", small } = {}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: BORDER2,
    borderRadius: 7,
    padding: small ? "6px 10px" : "9px 14px",
    fontSize: small ? 12 : 13,
    fontFamily: SANS,
    cursor: "pointer",
    background: PANEL2,
    color: TEXT_MUT,
    whiteSpace: "nowrap",
  };
  if (variant === "primary")
    return { ...base, background: CYAN_DIM, borderColor: "#2a6f8f", color: "#eafcff" };
  if (variant === "accent")
    return { ...base, background: active ? ORANGE_DIM : PANEL2, borderColor: active ? ORANGE : BORDER2, color: active ? "#fff3e2" : TEXT_MUT };
  if (variant === "danger")
    return { ...base, background: "transparent", borderColor: "#4a2530", color: RED };
  if (variant === "disabled")
    return { ...base, opacity: 0.4, cursor: "not-allowed" };
  if (active) return { ...base, background: CYAN_DIM, borderColor: "#2a6f8f", color: "#eafcff" };
  return base;
}

/* =========================================================================
   COMPONENTE PRINCIPAL
   ========================================================================= */
export default function App() {
  const [items, setItems] = useState([crearItem(1)]);
  const [activeId, setActiveId] = useState(items[0].id);
  const [viewMode, setViewMode] = useState("2d");
  const [chapaViewIndex, setChapaViewIndex] = useState(0);
  const [pieceModalOpen, setPieceModalOpen] = useState(false);
  const [pieceModalTab, setPieceModalTab] = useState("manual");

  const activeItem = items.find((i) => i.id === activeId) || items[0];

  const metricsList = useMemo(
    () => items.map((i) => ({ id: i.id, ...computeItemMetrics(i) })),
    [items]
  );
  const m = metricsList.find((x) => x.id === activeItem.id);

  function colorForItem(itemId) {
    const idx = items.findIndex((i) => i.id === itemId);
    return PALETA_ITEMS[idx % PALETA_ITEMS.length];
  }

  // Ítems que comparten material + espesor con el activo -> comparten chapa
  const grupoItems = items.filter(
    (i) =>
      i.material === activeItem.material &&
      String(i.espesor) === String(activeItem.espesor)
  );
  const sheetActiva =
    activeItem.sheetKey === "custom"
      ? {
          largo: parseFloat(activeItem.sheetCustomLargo) || 0,
          ancho: parseFloat(activeItem.sheetCustomAncho) || 0,
        }
      : CHAPAS_ESTANDAR.find((s) => s.key === activeItem.sheetKey);
  const margenActivo = parseFloat(activeItem.margenChapa) || 0;
  const gapActivo = parseFloat(activeItem.separacionChapa) || 0;

  const grupoEntries = grupoItems.map((it) => {
    const mi = metricsList.find((x) => x.id === it.id);
    return {
      itemId: it.id,
      nombre: it.nombre,
      color: colorForItem(it.id),
      ancho: mi.anchoPieza,
      largo: mi.largoPieza,
      cantidad: mi.cantidad,
    };
  });
  const grupoNesting = useMemo(
    () => computeGroupNesting(grupoEntries, sheetActiva, margenActivo, gapActivo),
    [
      JSON.stringify(grupoEntries),
      sheetActiva.largo,
      sheetActiva.ancho,
      margenActivo,
      gapActivo,
    ]
  );

  const chapaIdx = Math.min(chapaViewIndex, grupoNesting.sheetsUsed - 1 < 0 ? 0 : grupoNesting.sheetsUsed - 1);

  const densidadGrupo =
    MATERIALES.find((mt) => mt.key === activeItem.material)?.densidad || 7850;
  const espesorGrupo = parseFloat(activeItem.espesor) || 0;
  const sheetAreaM2Grupo = (sheetActiva.largo * sheetActiva.ancho) / 1e6;
  const pesoChapaKgGrupo = sheetAreaM2Grupo * (espesorGrupo / 1000) * densidadGrupo;
  const pesoTotalChapasGrupoKg = grupoNesting.sheetsUsed * pesoChapaKgGrupo;
  const areaUtilizadaGrupoM2 = grupoEntries.reduce(
    (a, e) => a + (e.cantidad * (e.ancho * e.largo)) / 1e6,
    0
  );
  const aprovechamientoGrupoPct =
    grupoNesting.sheetsUsed > 0
      ? (areaUtilizadaGrupoM2 / (grupoNesting.sheetsUsed * sheetAreaM2Grupo)) * 100
      : 0;

  const geom = useMemo(() => computeGeometry(activeItem.segments), [
    activeItem.segments,
  ]);
  const roundedPts = useMemo(
    () => computeRoundedPoints(activeItem.segments, geom.pts, geom.dirs),
    [activeItem.segments, geom]
  );

  function updateItem(id, patch) {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function addItem() {
    const it = crearItem(items.length + 1);
    setItems((arr) => [...arr, it]);
    setActiveId(it.id);
  }
  function removeItem(id) {
    if (items.length <= 1) return;
    setItems((arr) => {
      const next = arr.filter((i) => i.id !== id);
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
  }
  function togglePlegado(id) {
    setItems((arr) =>
      arr.map((i) => (i.id === id ? { ...i, plegadoActivo: !i.plegadoActivo } : i))
    );
  }
  function handleDxfUpload(id, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const shape = parseDxfToShape(String(reader.result));
        if (!shape) {
          updateItem(id, { dxfShape: null, dxfFileName: null, dxfError: "No se encontró geometría reconocible en el plano." });
          return;
        }
        updateItem(id, { dxfShape: shape, dxfFileName: file.name, dxfError: null });
      } catch (err) {
        updateItem(id, { dxfShape: null, dxfFileName: null, dxfError: "No se pudo leer el archivo DXF." });
      }
    };
    reader.onerror = () => {
      updateItem(id, { dxfShape: null, dxfFileName: null, dxfError: "No se pudo leer el archivo DXF." });
    };
    reader.readAsText(file);
  }
  function quitarDxf(id) {
    updateItem(id, { dxfShape: null, dxfFileName: null, dxfError: null });
  }
  function updateSegment(itemId, segId, field, value) {
    setItems((arr) =>
      arr.map((i) =>
        i.id !== itemId
          ? i
          : {
              ...i,
              segments: i.segments.map((s) =>
                s.id === segId ? { ...s, [field]: value } : s
              ),
            }
      )
    );
  }
  function addSegment(itemId) {
    setItems((arr) =>
      arr.map((i) =>
        i.id !== itemId
          ? i
          : {
              ...i,
              segments: [
                ...i.segments,
                { length: 30, angle: 90, radius: 3, id: nextSegId() },
              ],
            }
      )
    );
  }
  function removeSegment(itemId, segId) {
    setItems((arr) =>
      arr.map((i) => {
        if (i.id !== itemId || i.segments.length <= 2) return i;
        return { ...i, segments: i.segments.filter((s) => s.id !== segId) };
      })
    );
  }
  function loadPreset(itemId, name) {
    setItems((arr) =>
      arr.map((i) =>
        i.id !== itemId
          ? i
          : { ...i, segments: PRESETS_PLEGADO[name].map((s) => ({ ...s, id: nextSegId() })) }
      )
    );
  }

  const totalPeso = metricsList.reduce((a, x) => a + x.pesoTotalKg, 0);
  const totalPrecioSinIva = metricsList.reduce((a, x) => a + x.precioTotalSinIva, 0);
  const totalPrecioConIva = metricsList.reduce((a, x) => a + x.precioTotalConIva, 0);

  // Total de chapas agrupando por material+espesor (cada grupo comparte chapa,
  // así que no sumamos las chapas de cada ítem por separado).
  // Resumen por grupo de material+espesor: qué ítems comparten chapa y
  // cuántas chapas/peso/aprovechamiento le corresponde a cada grupo.
  const gruposResumen = useMemo(() => {
    const grupos = {};
    items.forEach((it) => {
      const key = `${it.material}|${it.espesor}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(it);
    });
    return Object.values(grupos).map((grupoIts) => {
      const entries = grupoIts.map((it) => {
        const mi = metricsList.find((x) => x.id === it.id);
        return {
          itemId: it.id,
          ancho: mi.anchoPieza,
          largo: mi.largoPieza,
          cantidad: mi.cantidad,
          color: colorForItem(it.id),
        };
      });
      const ref = grupoIts[0];
      const sheet =
        ref.sheetKey === "custom"
          ? { largo: parseFloat(ref.sheetCustomLargo) || 0, ancho: parseFloat(ref.sheetCustomAncho) || 0 }
          : CHAPAS_ESTANDAR.find((s) => s.key === ref.sheetKey);
      const margen = parseFloat(ref.margenChapa) || 0;
      const gap = parseFloat(ref.separacionChapa) || 0;
      const nesting = computeGroupNesting(entries, sheet, margen, gap);
      const aprovechamientoProm =
        nesting.aprovechamientoPorChapa.length > 0
          ? nesting.aprovechamientoPorChapa.reduce((a, v) => a + v, 0) / nesting.aprovechamientoPorChapa.length
          : 0;
      const densidad = MATERIALES.find((mt) => mt.key === ref.material)?.densidad || 7850;
      const espesorNum = parseFloat(ref.espesor) || 0;
      const sheetAreaM2 = (sheet.largo * sheet.ancho) / 1e6;
      const pesoChapaKg = sheetAreaM2 * (espesorNum / 1000) * densidad;
      return {
        key: `${ref.material}|${ref.espesor}`,
        materialLabel: MATERIALES.find((mt) => mt.key === ref.material)?.label || ref.material,
        espesor: ref.espesor,
        items: grupoIts.map((it) => ({ id: it.id, nombre: it.nombre, color: colorForItem(it.id) })),
        sheetsUsed: nesting.sheetsUsed,
        aprovechamientoProm,
        aprovechamientoPorChapa: nesting.aprovechamientoPorChapa,
        pesoTotalChapasKg: nesting.sheetsUsed * pesoChapaKg,
        sheetLabel: `${fmt(sheet.largo, 0)} × ${fmt(sheet.ancho, 0)} mm`,
        sheet,
        margen,
        gap,
        placementsPerSheet: nesting.placementsPerSheet,
        primerItemId: grupoIts[0].id,
      };
    });
  }, [JSON.stringify(items), JSON.stringify(metricsList)]);

  const totalChapas = gruposResumen.reduce((a, g) => a + g.sheetsUsed, 0);

  const waLink = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(
    buildWhatsAppMessage(items, metricsList, totalChapas)
  )}`;

  /* ---------- generación de PDF: listado + kilos + miniaturas de chapas ---------- */
  async function generarPDF() {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 14;
    let y = 18;

    const logo = await getLogoDataUrl();
    let titleX = marginX;
    if (logo) {
      const logoW = 20;
      const logoH = logoW * (logo.h / logo.w);
      doc.addImage(logo.dataUrl, "PNG", marginX, y - 10, logoW, logoH, undefined, "FAST");
      titleX = marginX + logoW + 6;
    }

    doc.setFontSize(16);
    doc.setTextColor(20, 30, 40);
    doc.text("Cotización — Corte láser y plegado", titleX, y);
    y += 6;
    doc.setFontSize(9.5);
    doc.setTextColor(110, 110, 110);
    doc.text(`Fecha: ${new Date().toLocaleDateString("es-AR")}`, titleX, y);
    y += 8;

    // Miniatura de cada pieza (rasterizada a PNG) para meter en la tabla
    const thumbDataUrls = await Promise.all(
      items.map((it) => svgToPngDataUrl(itemThumbSvgMarkup(it, 160, colorForItem(it.id)), 160))
    );

    // Tabla de ítems: miniatura, medidas, cantidad, kilos y precio por ítem
    const filas = items.map((it) => {
      const m = metricsList.find((x) => x.id === it.id);
      const mat = MATERIALES.find((mm) => mm.key === it.material)?.label || it.material;
      return [
        "",
        it.nombre,
        `Láser${it.plegadoActivo ? " + plegado" : ""}`,
        mat,
        `${it.espesor} mm`,
        `${fmt(m.anchoPieza, 0)} × ${fmt(m.largoPieza, 0)} mm`,
        `${m.cantidad}`,
        `${fmt(m.pesoTotalKg, 1)} kg`,
        fmtMoney(m.precioTotalSinIva),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["Pieza", "Ítem", "Proceso", "Material", "Espesor", "Medidas", "Cant.", "Kilos", "Precio (sin IVA)"]],
      body: filas,
      styles: { fontSize: 8, cellPadding: 2.2 },
      headStyles: { fillColor: [15, 36, 55] },
      bodyStyles: { minCellHeight: 16 },
      columnStyles: { 0: { cellWidth: 18 } },
      margin: { left: marginX, right: marginX },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const url = thumbDataUrls[data.row.index];
          if (url) {
            const size = Math.min(data.cell.width, data.cell.height) - 3;
            const x = data.cell.x + (data.cell.width - size) / 2;
            const y2 = data.cell.y + (data.cell.height - size) / 2;
            doc.addImage(url, "PNG", x, y2, size, size, undefined, "FAST");
          }
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;

    // Totales generales
    doc.setFontSize(10.5);
    doc.setTextColor(20, 30, 40);
    doc.text(`Peso total: ${fmt(totalPeso, 1)} kg`, marginX, y);
    doc.text(`Chapas estimadas: ${totalChapas}`, marginX + 65, y);
    y += 7;
    doc.text(`Subtotal (sin IVA): ${fmtMoney(totalPrecioSinIva)}`, marginX, y);
    y += 6;
    doc.setFontSize(12.5);
    doc.setTextColor(20, 30, 40);
    doc.text(`TOTAL (IVA ${IVA_PCT}% incluido): ${fmtMoney(totalPrecioConIva)}`, marginX, y);
    y += 6;
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(
      "Valores orientativos, sujetos a revisión por un asesor antes de comenzar el trabajo. Precio cotizado por kilo, puede variar según la forma final de la pieza.",
      marginX,
      y,
      { maxWidth: pageW - marginX * 2 }
    );
    y += 10;

    // Por cada grupo de material+espesor: encabezado + miniaturas de cada chapa
    const cols = 3;
    const gap6 = 6;
    const thumbW = (pageW - marginX * 2 - (cols - 1) * gap6) / cols;

    gruposResumen.forEach((g) => {
      const thumbH = thumbW * (g.sheet.ancho / Math.max(g.sheet.largo, 1));
      const filasThumbs = Math.ceil(g.placementsPerSheet.length / cols);
      const altoGrupo = 14 + filasThumbs * (thumbH + 12);

      if (y + altoGrupo > pageH - 14) {
        doc.addPage();
        y = 18;
      }

      doc.setFontSize(11.5);
      doc.setTextColor(20, 30, 40);
      doc.text(
        `${g.materialLabel} · ${g.espesor} mm — ${g.sheetsUsed} chapa${g.sheetsUsed > 1 ? "s" : ""} (${g.sheetLabel})`,
        marginX,
        y
      );
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Ítems: ${g.items.map((it) => it.nombre).join(", ")}`, marginX, y + 5);
      y += 10;

      g.placementsPerSheet.forEach((placements, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = marginX + col * (thumbW + gap6);
        const thisY = y + row * (thumbH + 12);
        const dataUrl = dibujarChapaCanvas(g.sheet, placements, g.margen, g.gap, 360);
        doc.addImage(dataUrl, "PNG", x, thisY, thumbW, thumbH);
        doc.setFontSize(7.5);
        doc.setTextColor(90, 90, 90);
        doc.text(
          `Chapa ${i + 1} · ${fmt(g.aprovechamientoPorChapa[i] || 0, 0)}% aprovechamiento`,
          x,
          thisY + thumbH + 4
        );
      });

      y += filasThumbs * (thumbH + 12) + 6;
    });

    doc.save(`cotizacion_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  /* ---------- vista previa de la pieza (rectángulo o perfil plegado) ---------- */
  function PiezaPreview() {
    const W = 420,
      H = 320;
    if (activeItem.plegadoActivo) {
      const box = bbox(geom.pts);
      const w = Math.max(box.maxX - box.minX, 1);
      const h = Math.max(box.maxY - box.minY, 1);
      const diag = Math.sqrt(w * w + h * h);
      const pad = Math.max(diag * 0.28, 20);
      const viewBox = `${box.minX - pad} ${box.minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
      const svgPts = geom.pts.map((p) => ({ x: p.x, y: -p.y }));
      const roundedSvgPts = roundedPts.map((p) => ({ x: p.x, y: -p.y }));
      const polylineStr = roundedSvgPts.map((p) => `${p.x},${p.y}`).join(" ");
      const fontSize = Math.max(diag * 0.045, 4);
      const labelOffset = Math.max(diag * 0.1, 7);
      return (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[
              ["2d", "Vista 2D"],
              ["3d", "Vista 3D"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                style={btnStyle({ active: viewMode === key, small: true })}
              >
                {label}
              </button>
            ))}
            {viewMode === "3d" && (
              <div style={{ marginLeft: "auto", fontSize: 10.5, color: TEXT_DIM, alignSelf: "center" }}>
                arrastrá para rotar · rueda para zoom
              </div>
            )}
          </div>

          {viewMode === "3d" ? (
            <ThreeDProfile pts={roundedPts} depth={parseFloat(activeItem.profundidad) || 0} />
          ) : (
            <svg viewBox={viewBox} width="100%" height={H} style={{ overflow: "visible" }}>
              <polyline
                points={polylineStr}
                fill="none"
                stroke={CYAN}
                strokeWidth={Math.max(diag * 0.014, 0.9)}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {svgPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={Math.max(diag * 0.014, 1.2)} fill={TEXT} />
              ))}
              {activeItem.segments.map((seg, i) => {
                const p1 = svgPts[i];
                const p2 = svgPts[i + 1];
                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = -dy / len;
                const ny = dx / len;
                return (
                  <text
                    key={i}
                    x={mx + nx * labelOffset}
                    y={my + ny * labelOffset}
                    fontSize={fontSize}
                    fill="#c9e3ee"
                    fontFamily={MONO}
                    textAnchor="middle"
                  >
                    {parseFloat(seg.length || 0).toFixed(0)} mm
                  </text>
                );
              })}
            </svg>
          )}
        </div>
      );
    }
    if (activeItem.dxfShape) {
      return (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <DxfShapeSvg shape={activeItem.dxfShape} size={H} dashed strokeWidth={1.6} />
        </div>
      );
    }
    // rectángulo simple
    const ancho = parseFloat(activeItem.anchoManual) || 1;
    const largo = parseFloat(activeItem.largoManual) || 1;
    const pad = 40;
    const scale = Math.min((W - pad * 2) / ancho, (H - pad * 2 - 30) / largo);
    const drawW = ancho * scale;
    const drawH = largo * scale;
    const ox = (W - drawW) / 2;
    const oy = 20;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <rect
          x={ox}
          y={oy}
          width={drawW}
          height={drawH}
          fill={CYAN}
          fillOpacity={0.12}
          stroke={CYAN}
          strokeWidth={2}
        />
        <text
          x={ox + drawW / 2}
          y={oy + drawH + 22}
          textAnchor="middle"
          fontSize={13}
          fill={TEXT_MUT}
          fontFamily={MONO}
        >
          {fmt(ancho, 0)} mm
        </text>
        <text
          x={ox - 14}
          y={oy + drawH / 2}
          textAnchor="middle"
          fontSize={13}
          fill={TEXT_MUT}
          fontFamily={MONO}
          transform={`rotate(-90 ${ox - 14} ${oy + drawH / 2})`}
        >
          {fmt(largo, 0)} mm
        </text>
      </svg>
    );
  }

  /* ---------- vista de nesting en chapa ---------- */
  function NestingPreview() {
    const W = 900,
      H = 460;
    const sheet = sheetActiva;
    const pad = 50;
    const scale = Math.min(
      (W - pad * 2) / Math.max(sheet.largo, 1),
      (H - pad * 2) / Math.max(sheet.ancho, 1)
    );
    const drawW = sheet.largo * scale;
    const drawH = sheet.ancho * scale;
    const ox = (W - drawW) / 2;
    const oy = 20;
    const margen = margenActivo;
    const gap = gapActivo;
    const rects = [];
    (grupoNesting.placementsPerSheet[chapaIdx] || []).forEach((pl, plIdx) => {
      let dibujadas = 0;
      outer: for (let r = 0; r < pl.ny; r++) {
        for (let c = 0; c < pl.nx; c++) {
          if (dibujadas >= pl.count) break outer;
          const px = margen + pl.x + c * (pl.pw + gap);
          const py = margen + pl.y + r * (pl.ph + gap);
          rects.push(
            <rect
              key={`${plIdx}-${r}-${c}`}
              x={ox + px * scale}
              y={oy + py * scale}
              width={pl.pw * scale}
              height={pl.ph * scale}
              fill={pl.color}
              fillOpacity={0.28}
              stroke={pl.color}
              strokeWidth={1.2}
            />
          );
          dibujadas++;
        }
      }
    });

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <rect
          x={ox}
          y={oy}
          width={drawW}
          height={drawH}
          fill="#8fa4b8"
          fillOpacity={0.08}
          stroke="#8fa4b8"
          strokeWidth={2}
        />
        {rects}
        <text
          x={ox + drawW / 2}
          y={oy + drawH + 26}
          textAnchor="middle"
          fontSize={13}
          fill={TEXT_MUT}
          fontFamily={MONO}
        >
          {fmt(sheet.largo, 0)} mm
        </text>
        <text
          x={ox - 16}
          y={oy + drawH / 2}
          textAnchor="middle"
          fontSize={13}
          fill={TEXT_MUT}
          fontFamily={MONO}
          transform={`rotate(-90 ${ox - 16} ${oy + drawH / 2})`}
        >
          {fmt(sheet.ancho, 0)} mm
        </text>
      </svg>

    );
  }

  /* ---------- ventana modal para definir la pieza (medidas o DXF) + cantidad ---------- */
  function PiezaModal() {
    if (!pieceModalOpen) return null;
    return (
      <div
        onClick={() => setPieceModalOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(5,12,20,0.72)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...st.panel,
            width: "100%",
            maxWidth: 480,
            maxHeight: "90vh",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
            <div style={st.eyebrow}>Definir pieza — {activeItem.nombre}</div>
            <button
              onClick={() => setPieceModalOpen(false)}
              title="Cerrar"
              style={{ background: "transparent", border: "none", color: TEXT_MUT, cursor: "pointer", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              onClick={() => setPieceModalTab("manual")}
              style={btnStyle({ active: pieceModalTab === "manual" })}
            >
              Medidas manuales
            </button>
            <button
              onClick={() => setPieceModalTab("dxf")}
              style={btnStyle({ active: pieceModalTab === "dxf" })}
            >
              Subir plano (DXF)
            </button>
          </div>

          {pieceModalTab === "manual" ? (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={st.label}>Ancho de pieza (mm)</label>
                <input
                  type="number"
                  style={st.input}
                  value={activeItem.anchoManual}
                  onChange={(e) => {
                    if (activeItem.dxfShape) quitarDxf(activeItem.id);
                    updateItem(activeItem.id, { anchoManual: e.target.value });
                  }}
                />
              </div>
              <div>
                <label style={st.label}>Largo de pieza (mm)</label>
                <input
                  type="number"
                  style={st.input}
                  value={activeItem.largoManual}
                  onChange={(e) => {
                    if (activeItem.dxfShape) quitarDxf(activeItem.id);
                    updateItem(activeItem.id, { largoManual: e.target.value });
                  }}
                />
              </div>
              {activeItem.dxfShape && (
                <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: TEXT_DIM }}>
                  Ya hay un plano cargado para este ítem — si tocás las medidas manuales, se
                  quita el plano y pasa a usarse el rectángulo que cargues acá.
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {activeItem.dxfShape ? (
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                    background: PANEL2,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    flexWrap: "wrap",
                  }}
                >
                  <DxfShapeSvg shape={activeItem.dxfShape} size={84} />
                  <div style={{ flex: "1 1 140px" }}>
                    <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{activeItem.dxfFileName}</div>
                    <div style={{ fontSize: 12, color: TEXT_MUT, fontFamily: MONO, marginTop: 2 }}>
                      {fmt(activeItem.dxfShape.width, 1)} × {fmt(activeItem.dxfShape.height, 1)} mm
                    </div>
                  </div>
                  <button
                    onClick={() => quitarDxf(activeItem.id)}
                    style={btnStyle({ variant: "danger", small: true })}
                  >
                    <X size={13} /> Quitar
                  </button>
                </div>
              ) : (
                <div>
                  <label
                    style={{
                      ...btnStyle({ variant: "primary" }),
                      display: "inline-flex",
                      cursor: "pointer",
                    }}
                  >
                    <Layers size={14} /> Elegir archivo DXF
                    <input
                      type="file"
                      accept=".dxf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        handleDxfUpload(activeItem.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {activeItem.dxfError && (
                    <div style={{ fontSize: 10.5, color: RED, marginTop: 8 }}>{activeItem.dxfError}</div>
                  )}
                  <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: 10 }}>
                    Leemos líneas, arcos, círculos y curvas del plano para calcular el ancho y
                    largo reales de la pieza automáticamente — no hace falta cargarlos a mano.
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: ORANGE,
                      background: "rgba(232,135,30,.1)",
                      border: "1px solid rgba(232,135,30,.35)",
                      padding: "8px 10px",
                      borderRadius: 6,
                      marginTop: 10,
                      lineHeight: 1.5,
                    }}
                  >
                    Requisitos del archivo: escala 1:1 (1 unidad del dibujo = 1 mm real), formato
                    DXF, con todo el contorno de la pieza dibujado en la capa "0" — sin
                    acotaciones, textos, rótulos ni otras anotaciones, solo la geometría de corte.
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label style={st.label}>Cantidad de piezas</label>
            <input
              type="number"
              style={{ ...st.input, maxWidth: 140 }}
              value={activeItem.cantidad}
              onChange={(e) => updateItem(activeItem.id, { cantidad: e.target.value })}
            />
          </div>

          <button
            onClick={() => setPieceModalOpen(false)}
            style={{ ...btnStyle({ variant: "primary" }), width: "100%", justifyContent: "center", fontWeight: 600 }}
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------- RENDER ---------------------------- */
  return (
    <div
      style={{
        fontFamily: SANS,
        background: BG,
        color: TEXT,
        minHeight: "100vh",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <PiezaModal />
      <div style={st.eyebrow}>Módulo · Cotizador online</div>
      <h1 style={{ fontSize: 21, margin: "4px 0 4px", fontWeight: 600 }}>
        Corte láser y plegado de chapa
      </h1>
      <p style={{ fontSize: 13, color: TEXT_MUT, margin: "0 0 18px" }}>
        Cargá los ítems que necesitás cotizar. Cada ítem parte de una chapa: elegí el
        proceso, las medidas y —si corresponde— sumá el plegado como operación adicional.
      </p>

      {/* ---- tabs de ítems ---- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center" }}>
            <button
              onClick={() => setActiveId(it.id)}
              style={{
                ...btnStyle({ active: it.id === activeId }),
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
              }}
            >
              {it.nombre}
            </button>
            {items.length > 1 && (
              <button
                onClick={() => removeItem(it.id)}
                title="Quitar ítem"
                style={{
                  ...btnStyle({ active: it.id === activeId, variant: it.id === activeId ? "primary" : "default" }),
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  borderLeftWidth: 0,
                  padding: "9px 8px",
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addItem} style={btnStyle({ variant: "primary" })}>
          <Plus size={14} /> Agregar ítem
        </button>
      </div>

      {/* ---- configuración + preview de pieza ---- */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
        {/* Panel de configuración */}
        <div style={{ ...st.panel, flex: "1 1 360px", minWidth: "min(320px, 100%)" }}>
          <div style={{ ...st.eyebrow, marginBottom: 10 }}>{activeItem.nombre} · Proceso</div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button style={btnStyle({ active: true, variant: "primary" })}>
              <Scissors size={14} /> Corte láser
            </button>
            <button
              disabled
              title="Próximamente"
              style={btnStyle({ variant: "disabled" })}
            >
              Corte plasma
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={st.label}>Material</label>
              <select
                style={st.select}
                value={activeItem.material}
                onChange={(e) => {
                  const nuevoMaterial = e.target.value;
                  const patch = { material: nuevoMaterial };
                  if (
                    nuevoMaterial === "carbono" &&
                    !ESPESORES_CARBONO.includes(parseFloat(activeItem.espesor))
                  ) {
                    patch.espesor = 3.2;
                  }
                  updateItem(activeItem.id, patch);
                }}
              >
                {MATERIALES.map((mat) => (
                  <option key={mat.key} value={mat.key}>
                    {mat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={st.label}>Espesor (mm)</label>
              {activeItem.material === "carbono" ? (
                <select
                  style={st.select}
                  value={activeItem.espesor}
                  onChange={(e) => updateItem(activeItem.id, { espesor: e.target.value })}
                >
                  {ESPESORES_CARBONO.map((e) => (
                    <option key={e} value={e}>
                      {e} mm
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  style={st.input}
                  value={activeItem.espesor}
                  onChange={(e) => updateItem(activeItem.id, { espesor: e.target.value })}
                />
              )}
            </div>
          </div>

          {activeItem.material !== "carbono" && (
            <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: -4, marginBottom: 10 }}>
              Por ahora el espesor de este material se carga libremente — la lista de espesores
              comerciales para inoxidable y otros materiales queda como mejora futura.
            </div>
          )}

          {!activeItem.plegadoActivo ? (
            <div style={{ marginBottom: 14 }}>
              <label style={st.label}>Pieza y cantidad</label>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  background: PANEL2,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  flexWrap: "wrap",
                }}
              >
                {activeItem.dxfShape ? (
                  <DxfShapeSvg shape={activeItem.dxfShape} size={48} />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      flexShrink: 0,
                      background: INPUT_BG,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ItemThumb item={activeItem} size={38} />
                  </div>
                )}
                <div style={{ flex: "1 1 150px" }}>
                  <div style={{ fontSize: 12.5, color: TEXT, fontWeight: 600 }}>
                    {activeItem.dxfShape
                      ? activeItem.dxfFileName
                      : `${fmt(parseFloat(activeItem.anchoManual) || 0, 0)} × ${fmt(
                          parseFloat(activeItem.largoManual) || 0,
                          0
                        )} mm`}
                  </div>
                  <div style={{ fontSize: 11, color: TEXT_MUT, fontFamily: MONO }}>
                    {activeItem.dxfShape &&
                      `${fmt(activeItem.dxfShape.width, 1)} × ${fmt(activeItem.dxfShape.height, 1)} mm (auto) · `}
                    {activeItem.cantidad} piezas
                  </div>
                </div>
                <button
                  onClick={() => {
                    setPieceModalTab(activeItem.dxfShape ? "dxf" : "manual");
                    setPieceModalOpen(true);
                  }}
                  style={btnStyle({ variant: "primary", small: true })}
                >
                  Editar pieza
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                style={{
                  background: PANEL2,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 10,
                }}
              >
                <label style={st.label}>Longitud de la pieza (mm) — a lo largo del pliegue</label>
                <input
                  type="number"
                  style={{ ...st.input, maxWidth: 140 }}
                  value={activeItem.profundidad}
                  onChange={(e) => updateItem(activeItem.id, { profundidad: e.target.value })}
                />
                <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: 6 }}>
                  El ancho de la chapa a cortar se toma automáticamente del desarrollo del
                  perfil plegado ({fmt(m.segLenSum, 0)} mm), definido abajo.
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={st.label}>Cantidad de piezas</label>
                <input
                  type="number"
                  style={{ ...st.input, maxWidth: 120 }}
                  value={activeItem.cantidad}
                  onChange={(e) => updateItem(activeItem.id, { cantidad: e.target.value })}
                />
              </div>
            </>
          )}

          <button
            onClick={() => togglePlegado(activeItem.id)}
            style={btnStyle({ active: activeItem.plegadoActivo, variant: "accent" })}
          >
            <Layers size={14} />
            {activeItem.plegadoActivo ? "Quitar plegado" : "+ Agregar plegado a este ítem"}
          </button>

          {/* editor de tramos de plegado */}
          {activeItem.plegadoActivo && (
            <div
              style={{
                marginTop: 14,
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 14,
              }}
            >
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {Object.keys(PRESETS_PLEGADO).map((name) => (
                  <button
                    key={name}
                    onClick={() => loadPreset(activeItem.id, name)}
                    style={btnStyle({ small: true })}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeItem.segments.map((seg, i) => (
                  <div
                    key={seg.id}
                    style={{
                      background: PANEL2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                      padding: "8px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontFamily: MONO, fontSize: 11, color: CYAN, width: 44 }}>
                      Tramo {i + 1}
                    </div>
                    <label style={{ fontSize: 10.5, color: TEXT_MUT }}>
                      Largo (mm)
                      <input
                        type="number"
                        value={seg.length}
                        onChange={(e) => updateSegment(activeItem.id, seg.id, "length", e.target.value)}
                        style={{ ...st.input, width: 62, marginTop: 2 }}
                      />
                    </label>
                    {i < activeItem.segments.length - 1 ? (
                      <>
                        <label style={{ fontSize: 10.5, color: TEXT_MUT }}>
                          Ángulo (°)
                          <input
                            type="number"
                            value={seg.angle}
                            onChange={(e) => updateSegment(activeItem.id, seg.id, "angle", e.target.value)}
                            style={{ ...st.input, width: 62, marginTop: 2 }}
                          />
                        </label>
                        <label style={{ fontSize: 10.5, color: TEXT_MUT }}>
                          Radio (mm)
                          <input
                            type="number"
                            min="0"
                            value={seg.radius ?? 0}
                            onChange={(e) => updateSegment(activeItem.id, seg.id, "radius", e.target.value)}
                            style={{ ...st.input, width: 62, marginTop: 2 }}
                          />
                        </label>
                      </>
                    ) : (
                      <div style={{ fontSize: 10.5, color: TEXT_DIM, flex: 1 }}>(tramo final)</div>
                    )}
                    <button
                      onClick={() => removeSegment(activeItem.id, seg.id)}
                      style={{ ...btnStyle({ variant: "danger", small: true }), marginLeft: "auto", padding: "5px 8px" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => addSegment(activeItem.id)}
                style={{ ...btnStyle({ variant: "primary", small: true }), marginTop: 10 }}
              >
                <Plus size={12} /> Agregar tramo
              </button>
              <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: 10 }}>
                Desarrollo total: <span style={{ color: TEXT }}>{fmt(m.segLenSum, 1)} mm</span>. Suma
                simple de tramos — no incluye deducción de plegado (bend allowance / K-factor); para
                el desarrollo real conviene validar con el software de la plegadora.
              </div>
            </div>
          )}
        </div>

        {/* Panel de vista previa + métricas */}
        <div style={{ ...st.panel, flex: "1 1 380px", minWidth: "min(320px, 100%)" }}>
          <div style={{ ...st.eyebrow, marginBottom: 10 }}>Vista previa de pieza</div>
          <PiezaPreview />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
              gap: 10,
              marginTop: 8,
            }}
          >
            <div style={st.metric}>
              <div style={st.metricK}>Medidas</div>
              <div style={{ ...st.metricV, fontSize: 14 }}>
                {fmt(m.anchoPieza, 0)} × {fmt(m.largoPieza, 0)} mm
              </div>
            </div>
            <div style={st.metric}>
              <div style={st.metricK}>Peso total ({m.cantidad} u. de este ítem)</div>
              <div style={{ ...st.metricV, color: ORANGE }}>{fmt(m.pesoTotalKg, 1)} kg</div>
            </div>
            <div style={st.metric}>
              <div style={st.metricK}>Perímetro de corte</div>
              <div style={st.metricV}>{fmt(m.perimetroTotalM, 1)} m</div>
            </div>
            <div style={st.metric}>
              <div style={st.metricK}>Cantidad</div>
              <div style={st.metricV}>{m.cantidad}</div>
            </div>
            <div style={st.metric}>
              <div style={st.metricK}>Precio este ítem (sin IVA)</div>
              <div style={{ ...st.metricV, color: CYAN }}>{fmtMoney(m.precioTotalSinIva)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- nesting en chapa (la chapa "abajo de la pantalla") ---- */}
      <div style={{ ...st.panel, marginBottom: 18 }}>
        {gruposResumen.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...st.label, marginBottom: 6 }}>Grupo de chapa (material + espesor)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {gruposResumen.map((g) => (
                <button
                  key={g.key}
                  onClick={() => {
                    setActiveId(g.primerItemId);
                    setChapaViewIndex(0);
                  }}
                  style={btnStyle({
                    active: activeItem.material === g.key.split("|")[0] && String(activeItem.espesor) === g.key.split("|")[1],
                    small: true,
                  })}
                >
                  {g.materialLabel} · {g.espesor} mm ({g.sheetsUsed} chapa{g.sheetsUsed > 1 ? "s" : ""})
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div style={st.eyebrow}>Chapa compartida · mismo material y espesor</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              style={{ ...st.select, width: 170 }}
              value={activeItem.sheetKey}
              onChange={(e) => updateItem(activeItem.id, { sheetKey: e.target.value })}
            >
              {CHAPAS_ESTANDAR.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {activeItem.sheetKey === "custom" && (
              <>
                <input
                  type="number"
                  placeholder="Largo mm"
                  style={{ ...st.input, width: 90 }}
                  value={activeItem.sheetCustomLargo}
                  onChange={(e) => updateItem(activeItem.id, { sheetCustomLargo: e.target.value })}
                />
                <input
                  type="number"
                  placeholder="Ancho mm"
                  style={{ ...st.input, width: 90 }}
                  value={activeItem.sheetCustomAncho}
                  onChange={(e) => updateItem(activeItem.id, { sheetCustomAncho: e.target.value })}
                />
              </>
            )}
            <label style={{ fontSize: 11, color: TEXT_MUT }}>
              Margen
              <input
                type="number"
                style={{ ...st.input, width: 60, marginTop: 2 }}
                value={activeItem.margenChapa}
                onChange={(e) => updateItem(activeItem.id, { margenChapa: e.target.value })}
              />
            </label>
            <label style={{ fontSize: 11, color: TEXT_MUT }}>
              Separación
              <input
                type="number"
                style={{ ...st.input, width: 60, marginTop: 2 }}
                value={activeItem.separacionChapa}
                onChange={(e) => updateItem(activeItem.id, { separacionChapa: e.target.value })}
              />
            </label>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: TEXT_DIM, marginBottom: 10 }}>
          Los ítems con el mismo material y espesor que{" "}
          <strong style={{ color: TEXT }}>{activeItem.nombre}</strong> (
          {MATERIALES.find((mm) => mm.key === activeItem.material)?.label}, {activeItem.espesor} mm) se
          acomodan juntos en esta chapa. La configuración de chapa/márgenes de acá arriba aplica a todo
          el grupo.
        </div>

        {/* leyenda de ítems del grupo */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          {grupoItems.map((it) => (
            <div
              key={it.id}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: TEXT_MUT }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: colorForItem(it.id),
                  display: "inline-block",
                }}
              />
              {it.nombre}
              {grupoNesting.noEntra.includes(it.id) && (
                <span style={{ color: ORANGE }}>· no entra</span>
              )}
            </div>
          ))}
        </div>

        {grupoNesting.noEntra.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: ORANGE,
              background: "rgba(232,135,30,.1)",
              border: `1px solid rgba(232,135,30,.35)`,
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            {grupoNesting.noEntra.length === 1 ? "Un ítem no entra" : "Algunos ítems no entran"} en la chapa
            seleccionada con estas medidas. Probá una chapa más grande o revisá las medidas del ítem.
          </div>
        )}

        <NestingPreview />
        <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: 8 }}>
          {grupoNesting.sheetsUsed > 1
            ? "Elegí abajo qué chapa del grupo querés ver — cada una tiene su propio aprovechamiento."
            : "El dibujo muestra la chapa del grupo, con las piezas de cada ítem coloreadas según la leyenda de arriba."}
        </div>

        {grupoNesting.sheetsUsed > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {grupoNesting.aprovechamientoPorChapa.map((pct, i) => (
              <button
                key={i}
                onClick={() => setChapaViewIndex(i)}
                style={btnStyle({ active: i === chapaIdx, small: true })}
              >
                Chapa {i + 1} · {fmt(pct, 0)}%
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          <div style={st.metric}>
            <div style={st.metricK}>Ítems en este grupo</div>
            <div style={{ ...st.metricV, color: ORANGE }}>{grupoItems.length}</div>
          </div>
          <div style={st.metric}>
            <div style={st.metricK}>Chapas necesarias (grupo)</div>
            <div style={st.metricV}>{grupoNesting.sheetsUsed}</div>
          </div>
          <div style={st.metric}>
            <div style={st.metricK}>
              Aprovech. chapa {grupoNesting.sheetsUsed > 1 ? chapaIdx + 1 : ""}
            </div>
            <div style={st.metricV}>
              {fmt(grupoNesting.aprovechamientoPorChapa[chapaIdx] ?? 0, 1)} %
            </div>
          </div>
          {grupoNesting.sheetsUsed > 1 && (
            <div style={st.metric}>
              <div style={st.metricK}>Aprovech. promedio (grupo)</div>
              <div style={st.metricV}>{fmt(aprovechamientoGrupoPct, 1)} %</div>
            </div>
          )}
          <div style={st.metric}>
            <div style={st.metricK}>Peso en chapas (grupo)</div>
            <div style={st.metricV}>{fmt(pesoTotalChapasGrupoKg, 1)} kg</div>
          </div>
        </div>
      </div>

      {/* ---- listado de ítems: miniatura, unidades, kilos ---- */}
      <div style={{ ...st.panel, marginBottom: 18 }}>
        <div style={{ ...st.eyebrow, marginBottom: 12 }}>
          Listado de ítems ({items.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const im = metricsList.find((x) => x.id === it.id);
            return (
              <div
                key={it.id}
                onClick={() => setActiveId(it.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  rowGap: 8,
                  gap: 14,
                  background: it.id === activeId ? PANEL2 : "transparent",
                  border: `1px solid ${it.id === activeId ? BORDER2 : BORDER}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    background: INPUT_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ItemThumb item={it} />
                </div>

                <div style={{ flex: "1 1 140px", minWidth: 120 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{it.nombre}</div>
                  <div style={{ fontSize: 11, color: TEXT_MUT }}>
                    Corte láser{it.plegadoActivo ? " + plegado" : ""} ·{" "}
                    {MATERIALES.find((mm) => mm.key === it.material)?.label} · {it.espesor} mm
                  </div>
                </div>

                <div style={{ textAlign: "right", minWidth: 90 }}>
                  <div style={st.metricK}>Unidades</div>
                  <div style={{ fontFamily: MONO, fontSize: 15, color: TEXT }}>{im.cantidad}</div>
                </div>

                <div style={{ textAlign: "right", minWidth: 100 }}>
                  <div style={st.metricK}>Kilos</div>
                  <div style={{ fontFamily: MONO, fontSize: 15, color: ORANGE, fontWeight: 600 }}>
                    {fmt(im.pesoTotalKg, 1)} kg
                  </div>
                </div>

                <div style={{ textAlign: "right", minWidth: 110 }}>
                  <div style={st.metricK}>Precio (sin IVA)</div>
                  <div style={{ fontFamily: MONO, fontSize: 15, color: CYAN, fontWeight: 600 }}>
                    {fmtMoney(im.precioTotalSinIva)}
                  </div>
                </div>

                {items.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(it.id);
                    }}
                    style={{ ...btnStyle({ variant: "danger", small: true }), padding: "6px 8px" }}
                    title="Quitar ítem"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- listado de chapas por espesor ---- */}
      {gruposResumen.length > 1 && (
        <div style={{ ...st.panel, marginBottom: 18 }}>
          <div style={{ ...st.eyebrow, marginBottom: 12 }}>
            Chapas por espesor ({gruposResumen.length} grupo{gruposResumen.length > 1 ? "s" : ""})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {gruposResumen.map((g) => (
              <div
                key={g.key}
                style={{
                  background: PANEL2,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>
                    {g.materialLabel} · {g.espesor} mm{" "}
                    <span style={{ fontWeight: 400, color: TEXT_MUT, fontSize: 11.5 }}>
                      (chapa {g.sheetLabel})
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: TEXT_MUT }}>
                    <span>
                      Chapas: <strong style={{ color: TEXT }}>{g.sheetsUsed}</strong>
                    </span>
                    <span>
                      Aprovech. prom.: <strong style={{ color: TEXT }}>{fmt(g.aprovechamientoProm, 0)}%</strong>
                    </span>
                    <span>
                      Peso chapas: <strong style={{ color: ORANGE }}>{fmt(g.pesoTotalChapasKg, 1)} kg</strong>
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {g.items.map((it) => (
                    <div
                      key={it.id}
                      onClick={() => setActiveId(it.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        color: TEXT_MUT,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: it.color,
                          display: "inline-block",
                        }}
                      />
                      {it.nombre}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- resumen general + WhatsApp ---- */}
      <div style={{ ...st.panel, background: PANEL2 }}>
        <div style={{ ...st.eyebrow, marginBottom: 10 }}>Resumen del pedido ({items.length} ítem{items.length > 1 ? "s" : ""})</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div style={st.metric}>
            <div style={st.metricK}>Peso total</div>
            <div style={{ ...st.metricV, color: ORANGE }}>{fmt(totalPeso, 1)} kg</div>
          </div>
          <div style={st.metric}>
            <div style={st.metricK}>Chapas estimadas</div>
            <div style={st.metricV}>{totalChapas}</div>
          </div>
          <div style={st.metric}>
            <div style={st.metricK}>Subtotal (sin IVA)</div>
            <div style={st.metricV}>{fmtMoney(totalPrecioSinIva)}</div>
          </div>
          <div style={st.metric}>
            <div style={st.metricK}>Total (con IVA {IVA_PCT}%)</div>
            <div style={{ ...st.metricV, color: CYAN }}>{fmtMoney(totalPrecioConIva)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            style={{
              ...btnStyle({ variant: "primary" }),
              background: GREEN,
              borderColor: GREEN,
              color: "#08251a",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            <MessageCircle size={16} /> Enviar cotización por WhatsApp
          </a>
          <button onClick={generarPDF} style={{ ...btnStyle({ variant: "primary" }), fontWeight: 600 }}>
            <FileDown size={16} /> Generar PDF
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: 8 }}>
          El PDF incluye el listado de ítems con kilos por pieza y una miniatura de cada chapa
          nesteada, agrupadas por espesor. Arma un mensaje con el detalle de todos los ítems y lo
          abre en WhatsApp — número de contacto configurable en el código (NUMERO_WHATSAPP).
        </div>
      </div>
    </div>
  );
}
