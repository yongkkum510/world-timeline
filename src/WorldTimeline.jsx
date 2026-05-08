import { useState, useRef } from "react";
import editedDb from "./data/edited_db.json";

// ============================
// 지역 정의
// ============================
// ============================
// 지역 계층 구조
//
// depth 0: global (전지구) — 별도 처리
// depth 1: 대륙 (parent: null)
// depth 2: 국가 (parent: 대륙 id)
//
// 국가 추가 예시:
// { id: "africa.egypt",   label: "이집트",  color: "#c4842a", depth: 2, parent: "africa" },
// { id: "europe.britain", label: "영국",    color: "#4a7c9e", depth: 2, parent: "europe" },
//
// 타임라인에서 depth 2는 대륙 행 아래에 들여쓰기로 표시됨
// ============================
const REGIONS = [
  { id: "africa",         label: "아프리카",   color: "#c4842a", depth: 1, parent: null },
  { id: "europe",         label: "유럽",       color: "#4a7c9e", depth: 1, parent: null },
  { id: "middleeast",     label: "중동",       color: "#c4a42a", depth: 1, parent: null },
  { id: "india",          label: "인도",       color: "#b34a4a", depth: 1, parent: null },
  { id: "china",          label: "중국",       color: "#6b8e5a", depth: 1, parent: null },
  { id: "korea",          label: "한국",       color: "#9e6b8e", depth: 1, parent: null },
  { id: "japan",          label: "일본",       color: "#4a9e8e", depth: 1, parent: null },
  { id: "southeast_asia", label: "동남아",     color: "#7a5a9e", depth: 1, parent: null },
  { id: "americas",       label: "아메리카",   color: "#5a8e7a", depth: 1, parent: null },
  { id: "oceania",        label: "오세아니아", color: "#8e6b4a", depth: 1, parent: null },
  // depth 2 국가들은 여기에 추가 (부모 대륙 바로 아래에 위치시킬 것)
];

// ============================
// 관계 타입 정의
// 각 이벤트의 relations 배열 안에 들어가는 객체를 "상호작용 객체"라고 부른다.
// 상호작용 객체 구조:
//   { targetId: number, type: string, label: string }
//   - targetId : 연결 대상 이벤트의 id
//   - type     : 아래 RELATION_TYPES의 키 중 하나 (exploitation/spread/exchange/resistance/alliance)
//   - label    : SVG 선 위에 표시되는 설명 텍스트
// ============================
const RELATION_TYPES = {
  exploitation: { label: "수탈·지배",   color: "#c0392b", dash: "none",   arrow: "→" },
  spread:       { label: "전파",         color: "#e67e22", dash: "5,3",    arrow: "→" },
  exchange:     { label: "쌍방교환",     color: "#27ae60", dash: "none",   arrow: "↔" },
  resistance:   { label: "저항·반작용", color: "#8e44ad", dash: "8,4",    arrow: "←" },
  alliance:     { label: "동맹·협력",   color: "#2980b9", dash: "none",   arrow: "↔" },
};

// ============================
// 이벤트 데이터
// edited_db.json에서 불러온 데이터를 사용.
// 타임라인 상단 "edited_db 불러오기" 버튼으로 JSON을 로드하면
// 아래 초기값 대신 로드된 데이터가 사용됨.
// 각 이벤트 객체 구조:
// {
//   id: string,            고유 ID
//   year_bp: number,       현재로부터 몇 년 전
//   region: string,        "global" 또는 REGIONS의 id
//   title: string,
//   summary: string,
//   importance: "high" | "medium" | "low",
//   relations: [           ← 상호작용 객체 목록
//     { targetId: string, type: string, label: string }
//   ]
// }
// ============================
const INITIAL_EVENTS = editedDb;

// ============================
// 시간 변환 + 이벤트 밀도 기반 X 좌표 스케일
//
// 스케일 방식: 시간(로그) 10% + 이벤트 밀도 90% 혼합
// - 이벤트가 많은 구간은 넓게, 적은 구간은 좁게 표현
// - 시간 구간은 DENSITY_BINS로 정의 (과거 → 현재 순서)
// - buildDensityScale(events)를 호출하면 각 bp → X비율 변환 함수 반환
// ============================
const BP_MAX = 100_000_000;
const BP_MIN = 1;

// 밀도 계산용 시간 구간 경계 (과거 → 현재)
const DENSITY_BINS = [
  100_000_000,
  10_000_000,
  1_000_000,
  100_000,
  10_000,
  5_000,
  2_000,
  1_000,
  500,
  200,
  100,
  1,
];

// 시간(로그) 비율 계산 (순수 로그 스케일)
function logRatio(bp) {
  const val = Math.max(BP_MIN, bp);
  return 1 - (Math.log(val) - Math.log(BP_MIN)) / (Math.log(BP_MAX) - Math.log(BP_MIN));
}

// 이벤트 배열을 받아 bp → [0,1] 비율 변환 함수를 반환
// 시간 10% + 이벤트 밀도 90% 혼합
function buildDensityScale(events) {
  const TIME_W = 0.10;   // 시간 가중치
  const DENS_W = 0.90;   // 이벤트 밀도 가중치
  const MIN_W  = 0.01;   // 이벤트 0개 구간 최소 너비 비율

  const n = DENSITY_BINS.length - 1;

  // 각 구간의 이벤트 수 계산
  const counts = Array(n).fill(0);
  events.forEach(evt => {
    const bp = evt.year_bp;
    for (let i = 0; i < n; i++) {
      const lo = DENSITY_BINS[i + 1]; // 더 최근 (작은 값)
      const hi = DENSITY_BINS[i];     // 더 과거 (큰 값)
      if (bp <= hi && bp > lo) { counts[i]++; break; }
      if (i === n - 1 && bp <= lo) { counts[i]++; }
    }
  });

  // 각 구간의 시간 너비 (로그 스케일 기준)
  const timeWidths = Array(n).fill(0).map((_, i) => {
    const loRatio = logRatio(DENSITY_BINS[i + 1]);
    const hiRatio = logRatio(DENSITY_BINS[i]);
    return Math.abs(loRatio - hiRatio);
  });

  // 밀도 너비: 이벤트 수 비율 (최소 MIN_W 보장)
  const totalEvents = Math.max(1, events.length);
  const rawDensWidths = counts.map(c => Math.max(MIN_W / n, c / totalEvents));
  const densSum = rawDensWidths.reduce((s, v) => s + v, 0);
  const densWidths = rawDensWidths.map(v => v / densSum);

  // 혼합 너비
  const mixed = Array(n).fill(0).map((_, i) =>
    timeWidths[i] * TIME_W + densWidths[i] * DENS_W
  );
  const mixedSum = mixed.reduce((s, v) => s + v, 0);
  const normMixed = mixed.map(v => v / mixedSum);

  // 누적 X 비율 계산
  // DENSITY_BINS[0] = 가장 과거(1억년) → X=0 (왼쪽)
  // DENSITY_BINS[n] = 현재(1)          → X=1 (오른쪽)
  // cumLeft[i] = DENSITY_BINS[i] 시점의 X 비율 (왼쪽 경계)
  // i=0 → X=0(과거 끝), i=n → X=1(현재)
  const cumLeft = Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    cumLeft[i + 1] = cumLeft[i] + normMixed[i];
  }

  // bp → [0,1] 변환 함수 반환
  // bp가 클수록(더 과거) → X가 작음(왼쪽)
  // bp가 작을수록(더 최근) → X가 큼(오른쪽)
  return function bpToRatio(bp) {
    const val = Math.max(BP_MIN, Math.min(BP_MAX, bp));
    for (let i = 0; i < n; i++) {
      const hi = DENSITY_BINS[i];     // 구간 왼쪽(과거)
      const lo = DENSITY_BINS[i + 1]; // 구간 오른쪽(현재)
      if (val <= hi && val > lo) {
        // t=0: val=hi(과거 끝, 왼쪽), t=1: val=lo(현재 끝, 오른쪽)
        const t = (Math.log(hi) - Math.log(val)) / (Math.log(hi) - Math.log(Math.max(1, lo)));
        return cumLeft[i] + normMixed[i] * t;
      }
    }
    if (val >= DENSITY_BINS[0]) return cumLeft[0];   // 가장 과거 → X=0
    if (val <= DENSITY_BINS[n]) return cumLeft[n];   // 현재 → X=1
    return 0;
  };
}

function formatBP(bp) {
  if (bp >= 10_000_000) return `${(bp/1_000_000).toFixed(0)}백만년 전`;
  if (bp >= 1_000_000)  return `${(bp/1_000_000).toFixed(1)}백만년 전`;
  if (bp >= 10_000)     return `${(bp/10_000).toFixed(1)}만년 전`;
  if (bp >= 1_000)      return `${(bp/1_000).toFixed(1)}천년 전`;
  return `${bp}년 전`;
}

// 시간축 눈금을 이벤트 year_bp 기준으로 동적 생성
// - 이벤트가 없는 연대는 표시하지 않음
// - X 좌표가 너무 가까운 눈금은 겹침 방지를 위해 제거 (최소 간격 MIN_TICK_GAP px)
const MIN_TICK_GAP = 60;

function buildTicks(events, bpToRatio) {
  if (events.length === 0) return [];

  // 이벤트 year_bp를 내림차순 정렬 (과거→현재)
  const sorted = [...events]
    .sort((a, b) => b.year_bp - a.year_bp)
    .map(e => ({ bp: e.year_bp, label: formatBP(e.year_bp) }));

  // 중복 bp 제거
  const unique = sorted.filter((t, i, arr) =>
    i === 0 || t.bp !== arr[i - 1].bp
  );

  // X 좌표 기준 겹침 제거 (가까운 눈금은 뒤쪽 제거)
  const result = [];
  for (const tick of unique) {
    const x = ML + bpToRatio(tick.bp) * PW;
    const last = result[result.length - 1];
    if (!last || Math.abs(x - (ML + bpToRatio(last.bp) * PW)) >= MIN_TICK_GAP) {
      result.push(tick);
    }
  }
  return result;
}

// ============================
// 레이아웃 상수
// ============================
const SVG_W = 1200;
const ML = 70;
const PW = SVG_W - ML - 50;
const TIMELINE_Y = 60;

// 지역별 Y 좌표
const REGION_ROW = {};
const REGION_ORDER = ["global", ...REGIONS.map(r => r.id)];
REGION_ORDER.forEach((id, i) => {
  REGION_ROW[id] = TIMELINE_Y + 60 + i * 44;
});
const SVG_H = TIMELINE_Y + 60 + REGION_ORDER.length * 44 + 40;

// evtX / tickX 는 컴포넌트 내부에서 bpToRatio(events 기반)를 받아 계산
function makeEvtX(bpToRatio) {
  return (evt) => ML + bpToRatio(evt.year_bp) * PW;
}
function evtY(evt) {
  return REGION_ROW[evt.region] ?? REGION_ROW["global"];
}

// 곡선 경로 생성 (두 점 사이 호)
function arcPath(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.15 - 20;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

// ============================
// 메인 컴포넌트
// ============================
export default function WorldTimeline() {
  // EVENTS: edited_db.json을 불러오면 갱신됨
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [selected, setSelected] = useState(null);
  const [hoveredRel, setHoveredRel] = useState(null);
  const fileRef = useRef();

  // edited_db.json 불러오기
  function loadEditedDb(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        setEvents(data);
        setSelected(null);
      } catch {
        alert("올바른 edited_db.json 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
  }

  // 이벤트 밀도 기반 X 좌표 스케일 (시간 10% + 밀도 90%)
  const bpToRatio = buildDensityScale(events);
  const evtX = makeEvtX(bpToRatio);

  // 시간축 눈금: 이벤트 year_bp 기준으로 동적 생성
  const ticks = buildTicks(events, bpToRatio);

  // 선택된 이벤트의 관계 계산
  const activeRelations = selected
    ? selected.relations.map(rel => {
        const target = events.find(e => e.id === rel.targetId);
        return target ? { ...rel, target } : null;
      }).filter(Boolean)
    : [];

  // 선택된 이벤트에 관련된 이벤트 ID 집합
  const highlightIds = new Set(
    selected
      ? [selected.id, ...selected.relations.map(r => r.targetId)]
      : []
  );

  // 역방향 관계도 표시 (다른 이벤트가 selected를 가리키는 경우)
  const incomingRelations = selected
    ? events.flatMap(evt =>
        evt.relations
          .filter(r => r.targetId === selected.id)
          .map(r => ({ ...r, source: evt, isIncoming: true }))
      )
    : [];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#1a1410",
      fontFamily: "'Noto Serif KR', Georgia, serif",
      color: "#e8dcc8",
    }}>
      {/* 헤더 */}
      <div style={{
        textAlign: "center", padding: "18px 0 12px",
        borderBottom: "1px solid #3a2a1a",
        background: "linear-gradient(180deg, #0e0c08 0%, #1a1410 100%)",
      }}>
        <div style={{ fontSize: 9, letterSpacing: 7, color: "#7a5a30", textTransform: "uppercase", marginBottom: 4 }}>
          Historia Mundi · 지역간 상호작용
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e8d0a0", margin: 0, letterSpacing: 3 }}>
          세계사 연혁
        </h1>
        <div style={{ fontSize: 10, color: "#6a5030", marginTop: 4 }}>
          이벤트를 클릭하면 지역 간 관계가 시각화됩니다
        </div>
        {/* edited_db.json 불러오기 버튼 */}
        <div style={{ marginTop: 10 }}>
          <button onClick={() => fileRef.current.click()} style={{
            padding: "4px 14px", background: "transparent",
            border: "1px solid #4a3020", borderRadius: 4,
            color: "#8a6a40", fontSize: 11, cursor: "pointer",
          }}>
            📂 edited_db.json 불러오기 ({events.length}개 이벤트)
          </button>
          <input ref={fileRef} type="file" accept=".json"
            style={{ display: "none" }} onChange={loadEditedDb} />
        </div>
      </div>

      {/* 범례 */}
      <div style={{
        display: "flex", gap: 16, padding: "8px 20px", flexWrap: "wrap",
        borderBottom: "1px solid #2a1a0a", background: "#120e08",
        alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "#6a5030", marginRight: 4 }}>관계 유형:</span>
        {Object.entries(RELATION_TYPES).map(([key, rt]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width={28} height={10}>
              <line x1={0} y1={5} x2={28} y2={5}
                stroke={rt.color} strokeWidth={2}
                strokeDasharray={rt.dash === "none" ? undefined : rt.dash} />
            </svg>
            <span style={{ fontSize: 10, color: rt.color }}>{rt.label}</span>
          </div>
        ))}
      </div>

      {/* SVG 메인 */}
      <div style={{ overflowX: "auto", padding: "12px 0" }}>
        <svg width={SVG_W} height={SVG_H} style={{ display: "block", margin: "0 auto" }}>

          {/* 행 배경 */}
          {REGION_ORDER.map((id, i) => {
            const region = id === "global" ? { label: "전지구", color: "#7a7a7a", depth: 0, parent: null } : REGIONS.find(r => r.id === id);
            const label = region?.label;
            const color = region?.color;
            const y = REGION_ROW[id];
            const isHighlighted = selected && (
              selected.region === id ||
              activeRelations.some(r => r.target.region === id) ||
              incomingRelations.some(r => r.source.region === id)
            );
            return (
              <g key={id}>
                <rect x={0} y={y - 18} width={SVG_W} height={36}
                  fill={isHighlighted ? `${color}12` : (i % 2 === 0 ? "#ffffff06" : "transparent")} />
                <text x={ML - 8} y={y + 4} textAnchor="end"
                  fontSize={region?.depth === 2 ? 8.5 : 9.5}
                  fill={isHighlighted ? color : region?.depth === 2 ? "#4a3a2a" : "#5a4a38"}
                  fontWeight={isHighlighted ? 700 : 400}
                  style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  {/* depth 2(국가)는 "ㄴ" 접두어로 계층 표시 */}
                  {region?.depth === 2 ? `ㄴ ${label}` : label}
                </text>
                {/* 수평 가이드선 */}
                <line x1={ML} y1={y} x2={ML + PW} y2={y}
                  stroke={color} strokeWidth={0.4} opacity={isHighlighted ? 0.3 : 0.1} />
              </g>
            );
          })}

          {/* 시간축 */}
          <line x1={ML} y1={TIMELINE_Y} x2={ML + PW} y2={TIMELINE_Y}
            stroke="#7a5020" strokeWidth={1.5} />
          <polygon points={`${ML+PW},${TIMELINE_Y} ${ML+PW-6},${TIMELINE_Y-3} ${ML+PW-6},${TIMELINE_Y+3}`}
            fill="#7a5020" />
          {/* 시간축 눈금: 이벤트 year_bp와 동기화, 이벤트 없으면 미표시 */}
          {ticks.map(({ bp, label }) => {
            const x = ML + bpToRatio(bp) * PW;
            return (
              <g key={bp}>
                <line x1={x} y1={TIMELINE_Y-4} x2={x} y2={TIMELINE_Y+4}
                  stroke="#6a4018" strokeWidth={1} />
                <text x={x} y={TIMELINE_Y-7} textAnchor="middle"
                  fontSize={7} fill="#6a4018" fontFamily="Georgia">{label}</text>
              </g>
            );
          })}
          {events.length === 0 && (
            <text x={ML + PW/2} y={TIMELINE_Y - 7} textAnchor="middle"
              fontSize={9} fill="#4a3010" fontFamily="Georgia">
              edited_db.json을 불러오면 이벤트가 표시됩니다
            </text>
          )}
          <text x={ML} y={TIMELINE_Y-18} fontSize={8} fill="#4a3010">← 과거</text>
          <text x={ML+PW} y={TIMELINE_Y-18} textAnchor="end" fontSize={8} fill="#4a3010">현재 →</text>

          {/* ====== 관계 선 (선택 시만 표시) ====== */}
          {selected && activeRelations.map((rel, i) => {
            const sx = evtX(selected), sy = evtY(selected);
            const tx = evtX(rel.target), ty = evtY(rel.target);
            const rt = RELATION_TYPES[rel.type] || RELATION_TYPES.spread;
            const isHovered = hoveredRel === i;
            return (
              <g key={i}
                onMouseEnter={() => setHoveredRel(i)}
                onMouseLeave={() => setHoveredRel(null)}
                style={{ cursor: "pointer" }}>
                {/* 히트 영역 */}
                <path d={arcPath(sx, sy, tx, ty)}
                  fill="none" stroke="transparent" strokeWidth={12} />
                {/* 실제 선 */}
                <path d={arcPath(sx, sy, tx, ty)}
                  fill="none"
                  stroke={rt.color}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  strokeDasharray={rt.dash === "none" ? undefined : rt.dash}
                  opacity={isHovered ? 1 : 0.7}
                  style={{ transition: "all 0.15s" }} />
                {/* 화살표 끝 */}
                <circle cx={tx} cy={ty} r={3.5}
                  fill={rt.color} opacity={0.8} />
                {/* 호버 시 라벨 */}
                {isHovered && (
                  <g>
                    <rect
                      x={(sx+tx)/2 - 60}
                      y={Math.min(sy,ty) - Math.abs(tx-sx)*0.15 - 36}
                      width={120} height={18} rx={4}
                      fill="#1a1410" stroke={rt.color} strokeWidth={0.8} />
                    <text
                      x={(sx+tx)/2}
                      y={Math.min(sy,ty) - Math.abs(tx-sx)*0.15 - 23}
                      textAnchor="middle" fontSize={9}
                      fill={rt.color}
                      style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                      {rel.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 역방향 관계 (incoming) */}
          {selected && incomingRelations.map((rel, i) => {
            const sx = evtX(rel.source), sy = evtY(rel.source);
            const tx = evtX(selected), ty = evtY(selected);
            const rt = RELATION_TYPES[rel.type] || RELATION_TYPES.spread;
            return (
              <path key={`in-${i}`}
                d={arcPath(sx, sy, tx, ty)}
                fill="none"
                stroke={rt.color}
                strokeWidth={1.2}
                strokeDasharray={rt.dash === "none" ? undefined : rt.dash}
                opacity={0.45} />
            );
          })}

          {/* ====== 이벤트 노드 ====== */}
          {events.map(evt => {
            const x = evtX(evt), y = evtY(evt);
            const r = evt.importance === "high" ? 8 : 5;
            const isSel = selected?.id === evt.id;
            const isHighlit = highlightIds.has(evt.id);
            const isGray = selected && !isHighlit;
            const region = evt.region === "global"
              ? { color: "#9a8060" }
              : REGIONS.find(rg => rg.id === evt.region);
            const color = region?.color || "#9a8060";

            return (
              <g key={evt.id} style={{ cursor: "pointer" }}
                onClick={() => setSelected(isSel ? null : evt)}>
                {/* 선택 글로우 */}
                {isSel && (
                  <circle cx={x} cy={y} r={r+8}
                    fill={color} opacity={0.2} />
                )}
                {/* 노드 */}
                <circle cx={x} cy={y} r={r}
                  fill={isGray ? "#2a2a2a" : color}
                  stroke={isSel ? "#e8d0a0" : isHighlit ? color : "#3a3a3a"}
                  strokeWidth={isSel ? 2 : isHighlit ? 1.5 : 0.8}
                  opacity={isGray ? 0.2 : 0.95}
                  style={{ transition: "all 0.2s" }} />
                {/* 라벨 */}
                {(!isGray || isSel) && (
                  <text x={x} y={y - r - 4} textAnchor="middle"
                    fontSize={isSel ? 9.5 : 8.5}
                    fill={isGray ? "#333" : isSel ? "#e8d0a0" : color}
                    fontWeight={isSel ? 700 : 500}
                    opacity={isGray ? 0.2 : 1}
                    style={{ fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.2s" }}>
                    {evt.title.length > 12 ? evt.title.slice(0, 12) + "…" : evt.title}
                  </text>
                )}
              </g>
            );
          })}

        </svg>
      </div>

      {/* 선택 패널 */}
      {selected && (() => {
        const region = selected.region === "global"
          ? { label: "전지구", color: "#9a8060" }
          : REGIONS.find(r => r.id === selected.region);
        return (
          <div style={{
            maxWidth: 900, margin: "0 auto 24px", padding: "16px 20px",
            background: "#120e08",
            border: `1px solid ${region?.color}50`,
            borderTop: `3px solid ${region?.color}`,
            marginLeft: 16, marginRight: 16, borderRadius: "0 0 6px 6px",
          }}>
            {/* 제목 행 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{
                background: region?.color, color: "#fff",
                padding: "2px 8px", borderRadius: 3, fontSize: 9,
                fontFamily: "'Noto Sans KR', sans-serif"
              }}>{region?.label}</span>
              <span style={{ fontSize: 11, color: "#7a5a30", fontFamily: "Georgia" }}>
                {formatBP(selected.year_bp)}
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#e8d0a0", flex: 1 }}>
                {selected.title}
              </span>
              <button onClick={() => setSelected(null)} style={{
                background: "transparent", border: "none",
                fontSize: 18, cursor: "pointer", color: "#6a5030" }}>×</button>
            </div>

            {/* 이벤트 설명 문단 */}
            {selected.desc_event && (
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#c8b890", lineHeight: 1.9 }}>
                {selected.desc_event}
              </p>
            )}

            {/* 상호작용 설명 문단 */}
            {selected.desc_relation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: "#6a4a20",
                  textTransform: "uppercase", marginBottom: 6 }}>상호작용</div>
                <p style={{ margin: 0, fontSize: 13, color: "#a89878", lineHeight: 1.9 }}>
                  {selected.desc_relation}
                </p>
              </div>
            )}

            {/* desc 없고 summary만 있는 경우 fallback */}
            {!selected.desc_event && selected.summary && (
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#c8b890", lineHeight: 1.8 }}>
                {selected.summary}
              </p>
            )}

            {/* 출처 */}
            {selected.sources?.length > 0 && (
              <div style={{
                marginBottom: 16, padding: "8px 12px",
                background: "#0e0c08", borderRadius: 4,
                borderLeft: "2px solid #3a2a10",
              }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: "#6a4a20",
                  textTransform: "uppercase", marginBottom: 6 }}>출처</div>
                {selected.sources.map((src, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#6a5838",
                    fontStyle: "italic", lineHeight: 1.8,
                    fontFamily: "Georgia, serif" }}>
                    {src}
                  </div>
                ))}
              </div>
            )}

            {/* 관계 목록 */}
            {(activeRelations.length > 0 || incomingRelations.length > 0) && (
              <div>
                <div style={{ fontSize: 9, letterSpacing: 3, color: "#6a4a20",
                  textTransform: "uppercase", marginBottom: 8 }}>연결된 관계</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeRelations.map((rel, i) => {
                    const rt = RELATION_TYPES[rel.type];
                    const tRegion = rel.target.region === "global"
                      ? { label: "전지구", color: "#9a8060" }
                      : REGIONS.find(r => r.id === rel.target.region);
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px",
                        background: "#1a1410",
                        borderLeft: `3px solid ${rt?.color}`,
                        borderRadius: "0 4px 4px 0",
                        cursor: "pointer",
                      }}
                        onClick={() => setSelected(rel.target)}>
                        <span style={{ fontSize: 10, color: rt?.color, minWidth: 60,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          {rt?.arrow} {rt?.label}
                        </span>
                        <span style={{ fontSize: 10, color: "#6a8060" }}>→</span>
                        <span style={{ fontSize: 11, color: tRegion?.color,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          [{tRegion?.label}]
                        </span>
                        <span style={{ fontSize: 12, color: "#c8b080", fontWeight: 600,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          {rel.target.title}
                        </span>
                        <span style={{ fontSize: 10, color: "#5a4a38", marginLeft: "auto" }}>
                          {rel.label}
                        </span>
                      </div>
                    );
                  })}
                  {incomingRelations.map((rel, i) => {
                    const rt = RELATION_TYPES[rel.type];
                    const sRegion = rel.source.region === "global"
                      ? { label: "전지구", color: "#9a8060" }
                      : REGIONS.find(r => r.id === rel.source.region);
                    return (
                      <div key={`in-${i}`} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px",
                        background: "#1a1410",
                        borderLeft: `3px solid ${rt?.color}60`,
                        borderRadius: "0 4px 4px 0",
                        cursor: "pointer", opacity: 0.8,
                      }}
                        onClick={() => setSelected(rel.source)}>
                        <span style={{ fontSize: 10, color: rt?.color, minWidth: 60,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          ← {rt?.label}
                        </span>
                        <span style={{ fontSize: 10, color: "#6a5050" }}>에서</span>
                        <span style={{ fontSize: 11, color: sRegion?.color,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          [{sRegion?.label}]
                        </span>
                        <span style={{ fontSize: 12, color: "#c8b080", fontWeight: 600,
                          fontFamily: "'Noto Sans KR', sans-serif" }}>
                          {rel.source.title}
                        </span>
                        <span style={{ fontSize: 10, color: "#5a4a38", marginLeft: "auto" }}>
                          {rel.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
