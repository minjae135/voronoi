import './style.css';
import { buildDiagram, type Diagram, type Point, type Segment } from './geometry';

const WIDTH = 1000;
const HEIGHT = 680;
const ANIMATION_DURATION = 5600;
const MIN_POINT_SPACING = 13;
type AnimationState = 'idle' | 'running' | 'paused' | 'finished';

const svg = document.querySelector<SVGSVGElement>('#diagram')!;
const pointModeButton = document.querySelector<HTMLButtonElement>('#point-mode')!;
const pointButtonLabel = document.querySelector<HTMLSpanElement>('#point-button-label')!;
const pointHint = document.querySelector<HTMLParagraphElement>('#point-hint')!;
const pointCount = document.querySelector<HTMLElement>('#point-count')!;
const playButton = document.querySelector<HTMLButtonElement>('#play-button')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const playLabel = document.querySelector<HTMLSpanElement>('#play-label')!;
const playIcon = document.querySelector<HTMLSpanElement>('#play-icon')!;
const animationHint = document.querySelector<HTMLParagraphElement>('#animation-hint')!;
const triangulationToggle = document.querySelector<HTMLInputElement>('#triangulation-toggle')!;
const bisectorToggle = document.querySelector<HTMLInputElement>('#bisector-toggle')!;
const bisectorModeWrap = document.querySelector<HTMLDivElement>('#bisector-mode-wrap')!;
const bisectorMode = document.querySelector<HTMLSelectElement>('#bisector-mode')!;
const emptyPrompt = document.querySelector<HTMLDivElement>('#empty-prompt')!;
const stageCaption = document.querySelector<HTMLElement>('#stage-caption')!;
const stageCount = document.querySelector<HTMLElement>('#stage-count')!;
const stageStatus = document.querySelector<HTMLElement>('#stage-status')!;
const triangulationLegend = document.querySelector<HTMLSpanElement>('#triangulation-legend')!;

let points: Point[] = [];
let nextPointId = 1;
let pointModeActive = false;
let animationState: AnimationState = 'idle';
let animationElapsed = 0;
let lastFrameTime = 0;
let animationFrame = 0;
let draggingPointId: number | null = null;
let diagram: Diagram = buildDiagram(points, WIDTH, HEIGHT);
let maxWaveRadius = 1;

function updateDiagram(): void {
  diagram = buildDiagram(points, WIDTH, HEIGHT);
  maxWaveRadius = diagram.cells.reduce((maximum, cell) => {
    const farthest = cell.polygon.reduce((distance, vertex) => Math.max(distance, Math.hypot(vertex.x - cell.site.x, vertex.y - cell.site.y)), 0);
    return Math.max(maximum, farthest);
  }, 1);
}

function setPointMode(active: boolean): void {
  pointModeActive = active;
  pointModeButton.setAttribute('aria-pressed', String(active));
  pointButtonLabel.textContent = active ? '점 찍기 활성화됨' : '생성점 찍기';
  svg.classList.toggle('is-placing', active);
  svg.classList.remove('is-near-site');
  updatePointHint();
  updateStageStatus();
}

function updatePointHint(): void {
  if (pointModeActive) {
    pointHint.textContent = '오른쪽 화면을 눌러 점을 추가하세요.';
  } else if (points.length > 0) {
    pointHint.textContent = '점 찍기 모드가 꺼져 있어요. 생성점을 끌어 옮길 수 있어요.';
  } else {
    pointHint.textContent = '버튼을 켠 뒤 오른쪽 화면을 눌러 보세요.';
  }
}

function toDiagramPoint(clientX: number, clientY: number): { x: number; y: number } | null {
  const bounds = svg.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return null;
  return {
    x: Math.min(WIDTH - 16, Math.max(16, ((clientX - bounds.left) / bounds.width) * WIDTH)),
    y: Math.min(HEIGHT - 16, Math.max(16, ((clientY - bounds.top) / bounds.height) * HEIGHT)),
  };
}

function findPointAt(clientX: number, clientY: number): Point | null {
  const position = toDiagramPoint(clientX, clientY);
  const bounds = svg.getBoundingClientRect();
  if (!position || bounds.width === 0) return null;
  const hitRadius = Math.max(14, 18 * WIDTH / bounds.width);
  let nearest: Point | null = null;
  let nearestDistance = hitRadius;
  for (const point of points) {
    const distance = Math.hypot(point.x - position.x, point.y - position.y);
    if (distance <= nearestDistance) { nearest = point; nearestDistance = distance; }
  }
  return nearest;
}

function addPoint(clientX: number, clientY: number): void {
  const position = toDiagramPoint(clientX, clientY);
  if (!position) return;
  const { x, y } = position;
  if (points.some((point) => Math.hypot(point.x - x, point.y - y) < MIN_POINT_SPACING)) {
    pointHint.textContent = '점이 너무 가까워요. 조금 떨어진 곳을 눌러 주세요.';
    return;
  }
  stopAnimation();
  animationState = 'idle';
  animationElapsed = 0;
  points = [...points, { id: nextPointId++, x, y }];
  updateDiagram();
  updateControls();
  render();
}

function movePoint(id: number, clientX: number, clientY: number): void {
  const position = toDiagramPoint(clientX, clientY);
  if (!position) return;
  const current = points.find((point) => point.id === id);
  if (!current || Math.hypot(current.x - position.x, current.y - position.y) < 0.2) return;
  const tooClose = points.some((point) => point.id !== id && Math.hypot(point.x - position.x, point.y - position.y) < MIN_POINT_SPACING);
  if (tooClose) {
    pointHint.textContent = '생성점끼리 너무 가까워요. 조금 떨어진 곳으로 옮겨 주세요.';
    return;
  }
  if (animationState !== 'idle') {
    stopAnimation();
    animationState = 'idle';
    animationElapsed = 0;
  }
  points = points.map((point) => point.id === id ? { ...point, ...position } : point);
  updateDiagram();
  updateControls();
  render();
}

function stopAnimation(): void {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastFrameTime = 0;
}

function beginAnimation(): void {
  if (points.length === 0) return;
  stopAnimation();
  animationElapsed = 0;
  animationState = 'running';
  lastFrameTime = 0;
  updateControls();
  render();
  animationFrame = requestAnimationFrame(animate);
}

function animate(timestamp: number): void {
  if (animationState !== 'running') return;
  if (lastFrameTime === 0) lastFrameTime = timestamp;
  else animationElapsed += timestamp - lastFrameTime;
  lastFrameTime = timestamp;
  if (animationElapsed >= ANIMATION_DURATION) {
    animationElapsed = ANIMATION_DURATION;
    animationState = 'finished';
    animationFrame = 0;
    updateControls();
    render();
    return;
  }
  render();
  animationFrame = requestAnimationFrame(animate);
}

function togglePlayback(): void {
  if (points.length === 0) return;
  if (animationState === 'running') {
    stopAnimation();
    animationState = 'paused';
    updateControls();
    render();
  } else if (animationState === 'paused') {
    animationState = 'running';
    lastFrameTime = 0;
    updateControls();
    animationFrame = requestAnimationFrame(animate);
  } else {
    beginAnimation();
  }
}

function stopPlayback(): void {
  if (animationState === 'idle') return;
  stopAnimation();
  animationState = 'idle';
  animationElapsed = 0;
  updateControls();
  render();
}

function updateControls(): void {
  updatePointHint();
  pointCount.textContent = String(points.length);
  stageCount.textContent = `${points.length} ${points.length === 1 ? 'SITE' : 'SITES'}`;
  playButton.disabled = points.length === 0;
  stopButton.disabled = points.length === 0 || animationState === 'idle';
  bisectorModeWrap.hidden = !bisectorToggle.checked;
  emptyPrompt.hidden = points.length > 0;
  triangulationLegend.hidden = !triangulationToggle.checked;
  if (animationState === 'running') {
    playLabel.textContent = '일시정지'; playIcon.textContent = 'Ⅱ';
    animationHint.textContent = '파동이 각 영역의 경계에서 만나요.';
  } else if (animationState === 'paused') {
    playLabel.textContent = '이어 재생'; playIcon.textContent = '▶';
    animationHint.textContent = '잠시 멈췄어요. 이어서 볼 수 있어요.';
  } else if (animationState === 'finished') {
    playLabel.textContent = '다시 재생'; playIcon.textContent = '↻';
    animationHint.textContent = '파동이 모든 영역을 채웠어요.';
  } else {
    playLabel.textContent = '애니메이션 재생'; playIcon.textContent = '▶';
    animationHint.textContent = points.length === 0 ? '점이 생기면 원형 파동을 재생할 수 있어요.' : '재생은 동시에 시작하고, 중지는 처음으로 돌아가요.';
  }
  updateStageStatus();
}

function updateStageStatus(): void {
  if (animationState === 'running') {
    stageCaption.textContent = '파동이 퍼지는 중';
    stageStatus.innerHTML = '<span class="status-dot is-running"></span> 파동 진행 중';
  } else if (animationState === 'paused') {
    stageCaption.textContent = '파동 일시정지';
    stageStatus.innerHTML = '<span class="status-dot is-paused"></span> 일시정지';
  } else if (animationState === 'finished') {
    stageCaption.textContent = '영역이 완성됐어요';
    stageStatus.innerHTML = '<span class="status-dot is-done"></span> 영역 완성';
  } else if (pointModeActive) {
    stageCaption.textContent = '화면을 눌러 생성점을 놓으세요';
    stageStatus.innerHTML = '<span class="status-dot is-active"></span> 점 찍기 활성';
  } else if (points.length > 0) {
    stageCaption.textContent = '생성점 사이의 영역';
    stageStatus.innerHTML = '<span class="status-dot"></span> 재생 대기 중';
  } else {
    stageCaption.textContent = '생성점을 놓아 보세요';
    stageStatus.innerHTML = '<span class="status-dot"></span> 점 추가 대기 중';
  }
}

function render(): void {
  const progress = animationState === 'finished' ? 1 : Math.min(1, animationElapsed / ANIMATION_DURATION);
  const isAnimating = animationState === 'running' || animationState === 'paused';
  const radius = progress * maxWaveRadius;
  const cellFills = diagram.cells.map((cell) => {
    const path = polygonPath(cell.polygon);
    const clipId = `cell-clip-${cell.site.id}`;
    const opacity = animationState === 'finished' ? 0.3 : isAnimating ? 0.04 : 0.24;
    const wave = isAnimating
      ? `<circle cx="${cell.site.x}" cy="${cell.site.y}" r="${radius}" fill="${cell.color}" fill-opacity="0.58" clip-path="url(#${clipId})" />
         <circle class="wave-ring" cx="${cell.site.x}" cy="${cell.site.y}" r="${radius}" clip-path="url(#${clipId})" />`
      : '';
    return `<path d="${path}" fill="${cell.color}" fill-opacity="${opacity}" />${wave}`;
  }).join('');

  const edges = diagram.boundaries.map((segment) => {
    const visible = isAnimating ? clipSegmentToCircle(segment, points[segment.siteIndex], radius) : segment;
    if (!visible) return '';
    return `<line x1="${visible.start.x}" y1="${visible.start.y}" x2="${visible.end.x}" y2="${visible.end.y}" class="voronoi-edge" opacity="${isAnimating ? 0.94 : 0.78}" />`;
  }).join('');

  const triangles = triangulationToggle.checked ? renderTriangulation() : '';

  const bisectors = bisectorToggle.checked ? renderBisectors() : '';
  const markers = points.map((point, index) => {
    const label = pointLabel(index);
    return `<g class="site-marker" aria-label="생성점 ${label}"><circle cx="${point.x}" cy="${point.y}" r="13" class="site-halo" /><circle cx="${point.x}" cy="${point.y}" r="7" class="site-core" /><text x="${point.x + 16}" y="${point.y - 14}" class="site-label">${label}</text></g>`;
  }).join('');

  const clips = diagram.cells.map((cell) => `<clipPath id="cell-clip-${cell.site.id}"><path d="${polygonPath(cell.polygon)}" /></clipPath>`).join('');
  svg.innerHTML = `<defs><pattern id="dot-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dce2eb" /></pattern>${clips}</defs>
    <rect class="grid-background" width="${WIDTH}" height="${HEIGHT}" fill="url(#dot-grid)" />
    <g class="cell-layer">${cellFills}</g><g class="boundary-layer">${edges}</g>
    <g class="triangulation-layer">${triangles}</g><g class="bisector-layer">${bisectors}</g><g class="site-layer">${markers}</g>`;
  svg.setAttribute('aria-label', points.length === 0 ? '생성점을 추가하면 보로노이 다이어그램이 표시됩니다.' : `생성점 ${points.length}개가 있는 보로노이 다이어그램`);
  updateStageStatus();
}

function renderTriangulation(): string {
  const boundaryPairs = new Set(diagram.neighbors.map(([a, b]) => String(Math.min(a, b)) + ':' + String(Math.max(a, b))));
  const lineMap = new Map<string, { a: Point; b: Point; isVisibleVoronoiBoundary: boolean }>();
  const fills = diagram.triangles.map((triangle) => {
    const a = points[triangle.a];
    const b = points[triangle.b];
    const c = points[triangle.c];
    const pairs: Array<[number, number]> = [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]];
    for (const [firstIndex, secondIndex] of pairs) {
      const low = Math.min(firstIndex, secondIndex);
      const high = Math.max(firstIndex, secondIndex);
      const key = String(low) + ':' + String(high);
      if (!lineMap.has(key)) {
        lineMap.set(key, { a: points[low], b: points[high], isVisibleVoronoiBoundary: boundaryPairs.has(key) });
      }
    }
    return '<polygon points="' + a.x + ',' + a.y + ' ' + b.x + ',' + b.y + ' ' + c.x + ',' + c.y + '" class="delaunay-triangle" />';
  }).join('');

  const edges = [...lineMap.values()].map(({ a, b, isVisibleVoronoiBoundary }) => {
    const edgeStyle = isVisibleVoronoiBoundary ? 'is-voronoi-boundary' : 'is-other-edge';
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" class="delaunay-edge ' + edgeStyle + '" />';
  }).join('');

  return fills + edges;
}

function renderBisectors(): string {
  const pairs: Array<[number, number]> = bisectorMode.value === 'all' ? allPairs(points.length) : diagram.neighbors;
  return pairs.map(([aIndex, bIndex]) => {
    const line = bisectorAcrossCanvas(points[aIndex], points[bIndex]);
    return line ? `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" class="perpendicular-bisector" />` : '';
  }).join('');
}

function allPairs(count: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < count; a += 1) for (let b = a + 1; b < count; b += 1) pairs.push([a, b]);
  return pairs;
}

function bisectorAcrossCanvas(first: Point, second: Point): Segment | null {
  const dx = second.x - first.x; const dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const direction = { x: -dy / length, y: dx / length };
  let lower = -Infinity; let upper = Infinity;
  for (const [origin, velocity, minimum, maximum] of [[midpoint.x, direction.x, 0, WIDTH], [midpoint.y, direction.y, 0, HEIGHT]]) {
    if (Math.abs(velocity) < 1e-9) { if (origin < minimum || origin > maximum) return null; continue; }
    const firstT = (minimum - origin) / velocity; const secondT = (maximum - origin) / velocity;
    lower = Math.max(lower, Math.min(firstT, secondT));
    upper = Math.min(upper, Math.max(firstT, secondT));
  }
  if (lower > upper) return null;
  return { start: { x: midpoint.x + direction.x * lower, y: midpoint.y + direction.y * lower }, end: { x: midpoint.x + direction.x * upper, y: midpoint.y + direction.y * upper }, siteIndex: -1, neighborIndex: -1 };
}

function clipSegmentToCircle(segment: Segment, center: Point, radius: number): Segment | null {
  const dx = segment.end.x - segment.start.x; const dy = segment.end.y - segment.start.y;
  const fx = segment.start.x - center.x; const fy = segment.start.y - center.y;
  const a = dx * dx + dy * dy; const b = 2 * (fx * dx + fy * dy); const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a < 1e-9 || discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const startT = Math.max(0, (-b - root) / (2 * a)); const endT = Math.min(1, (-b + root) / (2 * a));
  if (startT > endT) return null;
  return { ...segment, start: { x: segment.start.x + startT * dx, y: segment.start.y + startT * dy }, end: { x: segment.start.x + endT * dx, y: segment.start.y + endT * dy } };
}

function polygonPath(polygon: Array<{ x: number; y: number }>): string {
  if (polygon.length === 0) return '';
  return polygon.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ') + ' Z';
}

function pointLabel(index: number): string {
  let number = index + 1; let label = '';
  while (number > 0) { number -= 1; label = String.fromCharCode(65 + number % 26) + label; number = Math.floor(number / 26); }
  return label;
}

pointModeButton.addEventListener('click', () => setPointMode(!pointModeActive));
playButton.addEventListener('click', togglePlayback);
stopButton.addEventListener('click', stopPlayback);
triangulationToggle.addEventListener('change', () => { updateControls(); render(); });
bisectorToggle.addEventListener('change', () => { updateControls(); render(); });
bisectorMode.addEventListener('change', render);
svg.addEventListener('pointerdown', (event: PointerEvent) => {
  if (pointModeActive) {
    event.preventDefault();
    addPoint(event.clientX, event.clientY);
    return;
  }
  const point = findPointAt(event.clientX, event.clientY);
  if (!point) return;
  event.preventDefault();
  draggingPointId = point.id;
  svg.classList.add('is-dragging');
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove', (event: PointerEvent) => {
  if (draggingPointId !== null) {
    event.preventDefault();
    movePoint(draggingPointId, event.clientX, event.clientY);
  } else if (!pointModeActive) {
    svg.classList.toggle('is-near-site', findPointAt(event.clientX, event.clientY) !== null);
  }
});
function finishPointDrag(event: PointerEvent): void {
  if (draggingPointId === null) return;
  draggingPointId = null;
  svg.classList.remove('is-dragging');
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}
svg.addEventListener('pointerup', finishPointDrag);
svg.addEventListener('pointercancel', finishPointDrag);
svg.addEventListener('lostpointercapture', finishPointDrag);
svg.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!pointModeActive || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  const bounds = svg.getBoundingClientRect();
  addPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
});

updateControls();
render();
