/* ============================================================
   app.js — 하이마트 제휴 대시보드 메인 스크립트
============================================================ */

'use strict';

// ── 설정 상수 ──────────────────────────────────────────────
const API_URL = 'https://script.google.com/macros/s/AKfycby5MF-6W4T_qoNmBGM7hSsuzJDuTBeo_s0rLAZiDGH2BC8EAqfBB1wcQRvdPFzgQZ2g/exec';

// ── 전역 상태 ──────────────────────────────────────────────
let weeklyChart = null;        // Chart.js 인스턴스
let compareMode = false;       // 비교 모드 여부
let lastData    = null;        // 마지막 primary 데이터
let lastCompare = null;        // 마지막 compare 데이터

// ── DOM 레퍼런스 ───────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── 유틸: 숫자 포맷 ───────────────────────────────────────
/** 천단위 콤마 */
function fmt(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return Number(n).toLocaleString('ko-KR');
}
/** 소수점 1자리 */
function fmtF1(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}
/** % 표시 */
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—%';
  return `${fmtF1(n)}%`;
}
/** 비율 계산 */
function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}
/** 증감 텍스트 */
function delta(curr, prev) {
  if (prev === null || prev === undefined || curr === null || curr === undefined) return { txt: '—', cls: 'flat' };
  const d = curr - prev;
  const p = prev !== 0 ? Math.round((d / Math.abs(prev)) * 1000) / 10 : 0;
  if (d > 0) return { txt: `▲ ${fmt(d)} (+${fmtF1(p)}%)`, cls: 'up' };
  if (d < 0) return { txt: `▼ ${fmt(Math.abs(d))} (${fmtF1(p)}%)`, cls: 'down' };
  return { txt: '변동 없음', cls: 'flat' };
}

// ── 유틸: 날짜 ────────────────────────────────────────────
/** 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환 */
function todayStr() {
  return new Date().toLocaleDateString('sv-SE'); // sv-SE 로케일이 ISO 형식
}
/** 이번달 1일을 'YYYY-MM-DD' 형식으로 반환 */
function monthStartStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
/** Date → 'YYYY-MM-DD' */
function dateStr(d) {
  return d.toLocaleDateString('sv-SE');
}
/** 날짜 라벨 포맷 'YYYY-MM-DD' → 'M/D' */
function shortDate(str) {
  if (!str) return '';
  const parts = str.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ── 초기화 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDateInputs();
  bindEvents();
  loadData();  // 페이지 로드 시 자동 조회
});

/** 날짜 입력 기본값 설정 */
function initDateInputs() {
  $('start-date').value   = monthStartStr();
  $('end-date').value     = todayStr();
  // 비교 기간 기본값: 지난달 같은 기간
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0); // 지난달 말일
  $('compare-start').value = dateStr(prevMonthStart);
  $('compare-end').value   = dateStr(prevMonthEnd);
}

/** 이벤트 바인딩 */
function bindEvents() {
  $('load-btn').addEventListener('click', loadData);
  $('compare-check').addEventListener('change', onCompareToggle);

  // 엔터로 조회
  ['start-date','end-date','compare-start','compare-end'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') loadData(); });
  });
}

/** 비교 모드 토글 */
function onCompareToggle(e) {
  compareMode = e.target.checked;
  const grp = $('compare-date-group');
  if (compareMode) {
    grp.classList.remove('hidden');
  } else {
    grp.classList.add('hidden');
    $('agents-compare-row').classList.add('hidden');
    $('agents-compare-row').innerHTML = '';
  }
}

// ── 데이터 로드 ───────────────────────────────────────────
/** 메인 데이터 조회 (비교 모드이면 두 번 fetch) */
async function loadData() {
  const start = $('start-date').value;
  const end   = $('end-date').value;
  if (!start || !end) { showError('조회 기간을 입력해주세요.'); return; }

  showLoading(true);
  hideError();

  try {
    const url = buildApiUrl(start, end);
    const data = await fetchJson(url);
    lastData = data;

    // 비교 모드면 비교 데이터도 fetch
    if (compareMode) {
      const cStart = $('compare-start').value;
      const cEnd   = $('compare-end').value;
      if (cStart && cEnd) {
        const cUrl = buildApiUrl(cStart, cEnd);
        lastCompare = await fetchJson(cUrl);
      }
    } else {
      lastCompare = null;
    }

    renderAll(lastData, lastCompare);
    $('last-updated').textContent = `갱신: ${new Date().toLocaleTimeString('ko-KR')}`;

  } catch (err) {
    console.error(err);
    showError(`데이터를 불러오지 못했습니다: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

/** API URL 생성 */
function buildApiUrl(start, end) {
  return `${API_URL}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}

/** JSON fetch (CORS 리다이렉트 follow) */
async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.message || '서버 오류');
  return json;
}

// ── 로딩 / 에러 UI ────────────────────────────────────────
function showLoading(on) {
  const ov  = $('loading-overlay');
  const btn = $('load-btn');
  if (on) {
    ov.classList.remove('hidden');
    btn.disabled = true;
  } else {
    ov.classList.add('hidden');
    btn.disabled = false;
  }
}

function showError(msg) {
  $('error-msg').textContent = msg;
  $('error-banner').classList.remove('hidden');
}
function hideError() { $('error-banner').classList.add('hidden'); }

// ── 렌더링 총괄 ───────────────────────────────────────────
function renderAll(data, compare) {
  const period = `${data.meta?.start} ~ ${data.meta?.end}`;

  // 기간 라벨 업데이트
  ['s1-period','s2-period','s3-period','s4-period'].forEach(id => {
    $(id).textContent = period;
  });
  $('top10-period-badge').textContent = period;

  renderSection1Agents(data, compare);
  renderSection2Target(data);
  renderSection3Notification(data);
  renderSection4Offline(data);
}

// ── 섹션 1: 중개사무소 참여 현황 ─────────────────────────
function renderSection1Agents(data, compare) {
  const total    = data.total_agents ?? 0;
  const active   = data.participating_agents ?? 0;
  const repeat   = data.repeat_agents ?? 0;
  const partner  = data.partner_agent_participation ?? {};

  $('v-total-agents').textContent    = fmt(total);
  $('v-participating').textContent   = fmt(active);
  $('v-participating-pct').textContent = `전체 대비 ${fmtPct(pct(active, total))}`;
  $('v-repeat').textContent          = fmt(repeat);
  $('v-repeat-pct').textContent      = `참여자 대비 ${fmtPct(pct(repeat, active))}`;
  $('v-partner').textContent         = `${fmt(partner.active)} / ${fmt(partner.total)}`;
  $('v-partner-pct').textContent     = `${fmt(partner.total)}개소 중 ${fmtPct(pct(partner.active, partner.total))}`;

  // 비교 모드 증감 행
  if (compare) {
    renderAgentsCompare(data, compare);
  }

  // TOP10 테이블
  renderTop10Table(data.top10_agents ?? []);
}

/** 비교 증감 카드 */
function renderAgentsCompare(curr, prev) {
  const row = $('agents-compare-row');
  row.classList.remove('hidden');

  const items = [
    { label: '참여 중개사', curr: curr.participating_agents, prev: prev.participating_agents },
    { label: '중복 참여',   curr: curr.repeat_agents, prev: prev.repeat_agents },
    { label: '제휴중개사 참여', curr: curr.partner_agent_participation?.active, prev: prev.partner_agent_participation?.active },
    { label: '총 발송건수', curr: curr.notification_stats?.total_sent, prev: prev.notification_stats?.total_sent },
  ];

  row.innerHTML = items.map(item => {
    const d = delta(item.curr, item.prev);
    return `
      <div class="delta-card">
        <span class="delta-label">${item.label}</span>
        <span class="delta-value ${d.cls}">${d.txt}</span>
      </div>
    `;
  }).join('');
}

/** TOP10 테이블 렌더링 */
function renderTop10Table(agents) {
  const tbody = $('top10-tbody');
  if (!agents.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">데이터 없음</td></tr>';
    return;
  }

  const maxCount = agents[0]?.sent_count || 1;

  tbody.innerHTML = agents.map((ag, i) => {
    const rank = i + 1;
    const rankCls = rank <= 3 ? `rank-badge--${rank}` : 'rank-badge--n';
    const partnerHtml = ag.is_partner
      ? '<span class="partner-badge">제휴</span>'
      : '<span class="nonpartner-badge">—</span>';
    const barPct = Math.round((ag.sent_count / maxCount) * 100);

    return `
      <tr>
        <td><span class="rank-badge ${rankCls}">${rank}</span></td>
        <td>${escHtml(ag.agency_name || ag.member_id)}</td>
        <td>
          <div class="sent-bar-wrap">
            <div class="sent-bar-bg"><div class="sent-bar-fill" style="width:${barPct}%"></div></div>
            <span class="sent-count-text">${fmt(ag.sent_count)}</span>
          </div>
        </td>
        <td>${partnerHtml}</td>
      </tr>
    `;
  }).join('');
}

// ── 섹션 2: 월간 목표 달성 현황 ──────────────────────────
function renderSection2Target(data) {
  const mt = data.monthly_target ?? {};
  const cc = data.campaign_cumulative ?? {};
  const wb = data.weekly_breakdown ?? [];

  // 목표건수 계산: 월목표 = 월평균 × 최근비율
  const totalBizDays  = mt.business_days_in_month ?? 1;
  const monthlyGoal   = mt.cumulative_target ?? 0;  // 이미 누적으로 계산된 값
  const actual        = mt.cumulative_actual ?? 0;

  // 진행률: 실적 / 월말까지의 전체 목표 환산
  // 전체 월 목표 = cumulative_target / elapsed * totalBiz (단순 선형 추정)
  const elapsedBiz    = mt.elapsed_business_days ?? 1;
  const projFullTarget = elapsedBiz > 0 ? (monthlyGoal / elapsedBiz) * totalBizDays : 0;
  const progressPct   = projFullTarget > 0 ? Math.min((actual / projFullTarget) * 100, 150) : 0;

  $('prog-pct').textContent = fmtPct(pct(actual, projFullTarget));
  const fill = Math.min(progressPct, 100);
  $('prog-fill').style.width = `${fill}%`;

  // 사용된 비율 표시
  const ratioUsed = mt.target_ratio_used ?? [];
  const ratioText = ratioUsed.length
    ? ratioUsed.map(r => `${r.ratio}% (${shortDate(r.from)}~${shortDate(r.to)})`).join(', ')
    : '—';
  $('prog-label-ratio').textContent = `적용 목표비율: ${ratioText}`;
  $('prog-actual').textContent = `실적: ${fmt(actual)}건`;
  $('prog-target').textContent = `이번달 전체 목표(추산): ${fmt(Math.round(projFullTarget))}건`;

  // 일평균 KPI
  const dailyAvg    = mt.daily_avg_this_month ?? 0;
  const dailyTarget = projFullTarget > 0 && totalBizDays > 0 ? projFullTarget / totalBizDays : 0;
  $('v-daily-avg').textContent    = fmtF1(dailyAvg);
  $('v-daily-target').textContent = fmtF1(dailyTarget);
  $('v-biz-days').textContent     = fmt(elapsedBiz);
  $('v-biz-days-total').textContent = `/ ${fmt(totalBizDays)}일`;

  // 캠페인 누적
  $('v-camp-start').textContent = cc.campaign_start_date ?? '—';
  $('v-camp-total').textContent = fmt(cc.total_sent_since_start);
  $('v-camp-biz').textContent   = fmt(cc.business_days_since_start);
  $('v-camp-avg').textContent   = `${fmtF1(cc.daily_avg_since_start)}건`;

  // 주차별 차트
  renderWeeklyChart(wb);
}

/** Chart.js 주차별 막대+누적선 차트 */
function renderWeeklyChart(wb) {
  const ctx = $('weekly-chart').getContext('2d');

  if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }

  if (!wb.length) return;

  const labels     = wb.map(w => `${w.week}주 (${shortDate(w.week_start)})`);
  const sentCounts = wb.map(w => w.sent_count);
  const cumulatives = wb.map(w => w.cumulative);

  weeklyChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: '주간 발송건수',
          data: sentCounts,
          backgroundColor: 'rgba(79,142,247,0.6)',
          borderColor: 'rgba(79,142,247,0.9)',
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: '누적 발송건수',
          data: cumulatives,
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45,212,191,0.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#2dd4bf',
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: true,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(19,22,30,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          titleColor: '#8b91a8',
          bodyColor: '#e8eaf0',
          callbacks: {
            label: ctx => {
              const label = ctx.dataset.label || '';
              return ` ${label}: ${fmt(ctx.parsed.y)}건`;
            }
          }
        },
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8b91a8', font: { size: 11 } },
          border: { color: 'rgba(255,255,255,0.07)' },
        },
        y: {
          type: 'linear',
          position: 'left',
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8b91a8', font: { size: 11 }, callback: v => fmt(v) },
          border: { color: 'rgba(255,255,255,0.07)' },
        },
        y2: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#2dd4bf', font: { size: 11 }, callback: v => fmt(v) },
          border: { color: 'rgba(45,212,191,0.2)' },
        },
      },
    },
  });
}

// ── 섹션 3: 알림톡·안심케어 유입 현황 ────────────────────
function renderSection3Notification(data) {
  const ns = data.notification_stats ?? {};
  const rt = data.by_request_type  ?? {};
  const ch = data.by_channel       ?? {};

  $('v-total-sent').textContent  = fmt(ns.total_sent);
  $('v-ga4-clicks').textContent  = fmt(ns.ga4_clicks);
  $('v-ctr').textContent         = fmtF1(ns.ctr);

  // 신청구분 스택바
  const rtTotal = (rt['상담신청'] ?? 0) + (rt['계약고객'] ?? 0);
  renderStackbar({
    barId:      'req-type-bar',
    legendId:   'req-type-legend',
    valuesId:   'req-type-values',
    total:      rtTotal,
    segments: [
      { label: '상담신청', value: rt['상담신청'] ?? 0, color: '#4f8ef7' },
      { label: '계약고객', value: rt['계약고객'] ?? 0, color: '#9b6dff' },
    ],
  });

  // 신청경로 스택바
  const chTotal = (ch['제휴소개']?.count ?? 0) + (ch['매물리스트']?.count ?? 0);
  renderStackbar({
    barId:    'channel-bar',
    legendId: 'channel-legend',
    valuesId: 'channel-values',
    total:    chTotal,
    segments: [
      { label: '제휴소개',  value: ch['제휴소개']?.count  ?? 0, color: '#2dd4bf' },
      { label: '매물리스트', value: ch['매물리스트']?.count ?? 0, color: '#fb923c' },
    ],
  });
}

/**
 * 스택바 렌더링
 * @param {{ barId, legendId, valuesId, total, segments: {label, value, color}[] }} opts
 */
function renderStackbar({ barId, legendId, valuesId, total, segments }) {
  const bar    = $(barId);
  const legend = $(legendId);
  const vals   = $(valuesId);

  bar.innerHTML = '';
  legend.innerHTML = '';
  vals.innerHTML = '';

  if (!total) {
    bar.innerHTML = '<div class="stackbar-segment" style="width:100%;background:rgba(255,255,255,0.05);color:#525870">데이터 없음</div>';
    return;
  }

  segments.forEach(seg => {
    const p = total > 0 ? (seg.value / total) * 100 : 0;

    // 세그먼트
    const el = document.createElement('div');
    el.className = 'stackbar-segment';
    el.style.width = `${p}%`;
    el.style.background = seg.color;
    el.style.color = '#fff';
    if (p >= 12) el.textContent = `${fmtF1(p)}%`;
    el.title = `${seg.label}: ${fmt(seg.value)}건 (${fmtF1(p)}%)`;
    bar.appendChild(el);

    // 범례
    const li = document.createElement('span');
    li.innerHTML = `<span class="legend-swatch" style="background:${seg.color}"></span>${seg.label}`;
    legend.appendChild(li);

    // 수치
    const vi = document.createElement('div');
    vi.className = 'stackbar-value-item';
    vi.innerHTML = `
      <span class="sv-label">${seg.label}</span>
      <span class="sv-count">${fmt(seg.value)}건</span>
      <span class="sv-pct">${fmtPct(p)}</span>
    `;
    vals.appendChild(vi);
  });
}

// ── 섹션 4: 오프라인 비치 대상 ───────────────────────────
function renderSection4Offline(data) {
  const oa = data.offline_target_activity ?? {};
  const total  = oa.total_target ?? 0;
  const active = oa.active_count ?? 0;
  const p      = pct(active, total);

  $('v-offline-total').textContent  = fmt(total);
  $('v-offline-active').textContent = fmt(active);
  $('v-offline-pct').textContent    = `대상 대비 ${fmtPct(p)}`;
  $('offline-prog-fill').style.width = `${Math.min(p, 100)}%`;
  $('offline-prog-pct').textContent  = fmtPct(p);
}

// ── 보안 유틸 ─────────────────────────────────────────────
/** XSS 방지 HTML 이스케이프 */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
