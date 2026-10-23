export interface Point { id: number; x: number; y: number }
export interface Segment {
  start: { x: number; y: number };
  end: { x: number; y: number };
  siteIndex: number;
  neighborIndex: number;
}
export interface Cell { site: Point; polygon: Array<{ x: number; y: number }>; color: string }
export interface Triangle { a: number; b: number; c: number }
export interface Diagram { cells: Cell[]; boundaries: Segment[]; neighbors: Array<[number, number]>; triangles: Triangle[] }

const EPSILON = 1e-8;
const PALETTE = ['#bde5a5', '#ffe08a', '#9fd2ed', '#f6afbd', '#c8afe8', '#8ed7b2', '#ffc28a', '#f0d66e'];

export function buildDiagram(points: Point[], width: number, height: number): Diagram {
  if (points.length === 0) return { cells: [], boundaries: [], neighbors: [], triangles: [] };
  const rawCells = points.map((site) => {
    let polygon = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    for (const other of points) {
      if (site.id !== other.id && polygon.length > 0) polygon = clipToCloserHalfPlane(polygon, site, other);
    }
    return { site, polygon };
  });

  const segmentMap = new Map<string, Segment>();
  const neighborKeys = new Set<string>();
  rawCells.forEach((cell, siteIndex) => {
    const polygon = cell.polygon;
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const start = polygon[edgeIndex];
      const end = polygon[(edgeIndex + 1) % polygon.length];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.6) continue;
      for (let neighborIndex = siteIndex + 1; neighborIndex < points.length; neighborIndex += 1) {
        const neighbor = points[neighborIndex];
        if (Math.abs(squaredDistance(start, cell.site) - squaredDistance(start, neighbor)) > 0.2 ||
            Math.abs(squaredDistance(end, cell.site) - squaredDistance(end, neighbor)) > 0.2) continue;
        const pairKey = `${siteIndex}:${neighborIndex}`;
        const a = `${Math.round(start.x * 10)},${Math.round(start.y * 10)}`;
        const b = `${Math.round(end.x * 10)},${Math.round(end.y * 10)}`;
        const key = `${pairKey}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
        segmentMap.set(key, { start, end, siteIndex, neighborIndex });
        neighborKeys.add(pairKey);
      }
    }
  });

  const neighbors = [...neighborKeys].map((key) => key.split(':').map(Number) as [number, number]);
  const colors = colorGraph(points.length, neighbors);
  return {
    cells: rawCells.map((cell, index) => ({ ...cell, color: colors[index] })),
    boundaries: [...segmentMap.values()],
    neighbors,
    triangles: triangulate(points),
  };
}

function clipToCloserHalfPlane(polygon: Array<{ x: number; y: number }>, site: Point, other: Point): Array<{ x: number; y: number }> {
  const nx = 2 * (other.x - site.x);
  const ny = 2 * (other.y - site.y);
  const limit = other.x ** 2 + other.y ** 2 - site.x ** 2 - site.y ** 2;
  const result: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentValue = nx * current.x + ny * current.y - limit;
    const nextValue = nx * next.x + ny * next.y - limit;
    const currentInside = currentValue <= EPSILON;
    const nextInside = nextValue <= EPSILON;
    if (currentInside) result.push(current);
    if (currentInside !== nextInside) {
      const ratio = currentValue / (currentValue - nextValue);
      result.push({ x: current.x + ratio * (next.x - current.x), y: current.y + ratio * (next.y - current.y) });
    }
  }
  return result;
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function colorGraph(nodeCount: number, edges: Array<[number, number]>): string[] {
  const graph = Array.from({ length: nodeCount }, () => new Set<number>());
  for (const [a, b] of edges) { graph[a].add(b); graph[b].add(a); }
  const assigned = Array<number>(nodeCount).fill(-1);
  const uncolored = new Set(Array.from({ length: nodeCount }, (_, index) => index));
  while (uncolored.size > 0) {
    let selected = -1;
    let bestSaturation = -1;
    let bestDegree = -1;
    for (const node of uncolored) {
      const saturation = new Set([...graph[node]].map((neighbor) => assigned[neighbor]).filter((color) => color >= 0)).size;
      if (saturation > bestSaturation || (saturation === bestSaturation && graph[node].size > bestDegree)) {
        selected = node; bestSaturation = saturation; bestDegree = graph[node].size;
      }
    }
    const used = new Set([...graph[selected]].map((neighbor) => assigned[neighbor]));
    let colorIndex = 0;
    while (used.has(colorIndex)) colorIndex += 1;
    assigned[selected] = colorIndex;
    uncolored.delete(selected);
  }
  return assigned.map(colorForIndex);
}

function colorForIndex(index: number): string {
  if (index < PALETTE.length) return PALETTE[index];
  return `hsl(${((index * 137.508) % 360).toFixed(1)} 68% 69%)`;
}

interface TriangleIndex { a: number; b: number; c: number }
function triangulate(points: Point[]): Triangle[] {
  if (points.length < 3) return [];
  const vertices = points.map(({ x, y }) => ({ x, y }));
  const superStart = vertices.length;
  vertices.push({ x: -10000, y: -10000 }, { x: 11000, y: -10000 }, { x: 500, y: 12000 });
  let triangles: TriangleIndex[] = [{ a: superStart, b: superStart + 1, c: superStart + 2 }];

  points.forEach((_, pointIndex) => {
    const bad = new Set<number>();
    triangles.forEach((triangle, triangleIndex) => {
      const circle = circumcircle(vertices[triangle.a], vertices[triangle.b], vertices[triangle.c]);
      if (circle && squaredDistance(vertices[pointIndex], circle.center) <= circle.radiusSquared + 1e-6) bad.add(triangleIndex);
    });
    const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
    for (const triangleIndex of bad) {
      const triangle = triangles[triangleIndex];
      for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edgeCounts.get(key);
        if (edge) edge.count += 1;
        else edgeCounts.set(key, { a, b, count: 1 });
      }
    }
    triangles = triangles.filter((_, triangleIndex) => !bad.has(triangleIndex));
    for (const edge of edgeCounts.values()) {
      if (edge.count !== 1) continue;
      const area = cross(vertices[edge.a], vertices[edge.b], vertices[pointIndex]);
      if (Math.abs(area) > 1e-7) triangles.push({ a: edge.a, b: edge.b, c: pointIndex });
    }
  });

  return triangles
    .filter((triangle) => triangle.a < points.length && triangle.b < points.length && triangle.c < points.length)
    .map(({ a, b, c }) => ({ a, b, c }));
}

function circumcircle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const denominator = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(denominator) < 1e-8) return null;
  const a2 = a.x ** 2 + a.y ** 2;
  const b2 = b.x ** 2 + b.y ** 2;
  const c2 = c.x ** 2 + c.y ** 2;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / denominator,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / denominator,
  };
  return { center, radiusSquared: squaredDistance(center, a) };
}

function cross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
