import DxfParser from "dxf-parser";

/* =========================================================================
   LECTURA DE DXF — convierte las entidades de un plano 2D (líneas, arcos,
   círculos, elipses, polilíneas y splines) en una lista de "loops" (arrays
   de puntos) listos para dibujar en SVG y para sacar el bounding box
   (ancho x largo real de la pieza). Pensado para la miniatura de
   reconocimiento visual de la pieza, no para generar trayectoria de corte.
   ========================================================================= */

const ARC_SEGMENTS = 32;

function evalBSpline(degree, knots, controlPoints, numSamples) {
  const n = controlPoints.length - 1;
  const tMin = knots[degree];
  const tMax = knots[n + 1];
  const pts = [];

  function findSpan(t) {
    if (t >= tMax) return n;
    let lo = degree,
      hi = n + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (knots[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  function deBoor(t) {
    const k = findSpan(t);
    const d = [];
    for (let j = 0; j <= degree; j++) d.push({ ...controlPoints[k - degree + j] });
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const denom = knots[i + degree - r + 1] - knots[i];
        const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;
        d[j] = {
          x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
          y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        };
      }
    }
    return d[degree];
  }

  for (let i = 0; i <= numSamples; i++) {
    const t = tMin + ((tMax - tMin) * i) / numSamples;
    pts.push(deBoor(Math.min(t, tMax - 1e-9)));
  }
  return pts;
}

// Arco definido por un segmento de polilínea con "bulge" (LWPOLYLINE).
// Devuelve los puntos intermedios entre p1 y p2 (sin incluir p1).
function bulgeToPoints(p1, p2, bulge, segments = 16) {
  if (!bulge || Math.abs(bulge) < 1e-9) return [p2];
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [p2];
  const theta = Math.abs(4 * Math.atan(bulge));
  const radius = chord / (2 * Math.sin(theta / 2));
  const midX = (p1.x + p2.x) / 2,
    midY = (p1.y + p2.y) / 2;
  const h = Math.sqrt(Math.max(radius * radius - (chord / 2) * (chord / 2), 0));
  const ux = -dy / chord,
    uy = dx / chord;
  const candidates = [
    { x: midX + ux * h, y: midY + uy * h },
    { x: midX - ux * h, y: midY - uy * h },
  ];
  const ccw = bulge > 0;
  let best = null;
  for (const c of candidates) {
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let sweep = a2 - a1;
    if (ccw) {
      while (sweep <= 0) sweep += 2 * Math.PI;
    } else {
      while (sweep >= 0) sweep -= 2 * Math.PI;
    }
    const diff = Math.abs(Math.abs(sweep) - theta);
    if (!best || diff < best.diff) best = { center: c, a1, sweep, diff };
  }
  const pts = [];
  for (let i = 1; i <= segments; i++) {
    const a = best.a1 + (best.sweep * i) / segments;
    pts.push({ x: best.center.x + radius * Math.cos(a), y: best.center.y + radius * Math.sin(a) });
  }
  return pts;
}

function sampleArc(center, radius, startAngle, endAngle, segments = ARC_SEGMENTS) {
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (sweep * i) / segments;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

function sampleEllipse(center, majorAxisEndPoint, axisRatio, startAngle, endAngle, segments = ARC_SEGMENTS) {
  const majorLen = Math.hypot(majorAxisEndPoint.x, majorAxisEndPoint.y);
  const rot = Math.atan2(majorAxisEndPoint.y, majorAxisEndPoint.x);
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (sweep * i) / segments;
    const lx = majorLen * Math.cos(a);
    const ly = majorLen * axisRatio * Math.sin(a);
    pts.push({
      x: center.x + lx * Math.cos(rot) - ly * Math.sin(rot),
      y: center.y + lx * Math.sin(rot) + ly * Math.cos(rot),
    });
  }
  return pts;
}

function polylineToPoints(entity) {
  const verts = entity.vertices || [];
  const pts = [];
  const closed = !!entity.shape;
  const n = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < verts.length; i++) pts.push({ x: verts[i].x, y: verts[i].y });
  const withArcs = [pts[0]];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const p1 = { x: a.x, y: a.y };
    const p2 = { x: b.x, y: b.y };
    if (a.bulge) {
      withArcs.push(...bulgeToPoints(p1, p2, a.bulge, 16));
    } else {
      withArcs.push(p2);
    }
  }
  return withArcs;
}

// Junta segmentos sueltos (típicamente LINE) que comparten puntas, armando
// polilíneas más largas. Sirve para DXFs donde el contorno se dibujó como
// varias líneas separadas en vez de una sola polilínea.
function chainSegments(segments, tolerance = 0.05) {
  const remaining = segments.map((s) => [...s]);
  const loops = [];
  const closeEnough = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tolerance;

  while (remaining.length) {
    let chain = remaining.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const chainEnd = chain[chain.length - 1];
        const chainStart = chain[0];
        if (closeEnough(chainEnd, seg[0])) {
          chain = chain.concat(seg.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (closeEnough(chainEnd, seg[seg.length - 1])) {
          chain = chain.concat([...seg].reverse().slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (closeEnough(chainStart, seg[seg.length - 1])) {
          chain = seg.slice(0, -1).concat(chain);
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (closeEnough(chainStart, seg[0])) {
          chain = [...seg].reverse().slice(0, -1).concat(chain);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    loops.push(chain);
  }
  return loops;
}

/**
 * Parsea un DXF (texto) y devuelve { loops, minX, maxX, minY, maxY, width, height }
 * o null si no se encontró geometría 2D reconocible.
 */
export function parseDxfToShape(text) {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf || !dxf.entities || !dxf.entities.length) return null;

  const loops = [];
  const looseLines = [];

  dxf.entities.forEach((e) => {
    switch (e.type) {
      case "LINE": {
        if (e.vertices?.length >= 2) {
          looseLines.push([
            { x: e.vertices[0].x, y: e.vertices[0].y },
            { x: e.vertices[1].x, y: e.vertices[1].y },
          ]);
        }
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const pts = polylineToPoints(e);
        if (pts.length >= 2) loops.push(pts);
        break;
      }
      case "CIRCLE": {
        loops.push(sampleArc(e.center, e.radius, 0, 2 * Math.PI));
        break;
      }
      case "ARC": {
        looseLines.push(sampleArc(e.center, e.radius, e.startAngle, e.endAngle, ARC_SEGMENTS));
        break;
      }
      case "ELLIPSE": {
        const isFull = Math.abs((e.endAngle ?? 2 * Math.PI) - (e.startAngle ?? 0) - 2 * Math.PI) < 1e-6;
        const pts = sampleEllipse(
          e.center,
          e.majorAxisEndPoint,
          e.axisRatio ?? 1,
          e.startAngle ?? 0,
          e.endAngle ?? 2 * Math.PI
        );
        if (isFull) loops.push(pts);
        else looseLines.push(pts);
        break;
      }
      case "SPLINE": {
        if (e.controlPoints?.length && e.knotValues?.length) {
          const pts = evalBSpline(e.degreeOfSplineCurve ?? 3, e.knotValues, e.controlPoints, 100);
          loops.push(pts);
        }
        break;
      }
      default:
        break; // TEXT, DIMENSION, INSERT, etc. — se ignoran para esta miniatura
    }
  });

  // Convertimos cada segmento suelto (LINE/ARC individuales) en tramos de 2
  // puntos y los encadenamos por sus puntas para reconstruir contornos que
  // se dibujaron como varias entidades sueltas en vez de una polilínea.
  const twoPointSegments = [];
  looseLines.forEach((pts) => {
    for (let i = 0; i < pts.length - 1; i++) twoPointSegments.push([pts[i], pts[i + 1]]);
  });
  if (twoPointSegments.length) loops.push(...chainSegments(twoPointSegments));

  if (!loops.length) return null;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  loops.forEach((loop) =>
    loop.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    })
  );
  if (!isFinite(minX)) return null;

  return {
    loops,
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
