/* ============================================================
   app.js — 하이마트 제휴 대시보드 메인 스크립트 (v6)

   [v6 변경]
   - Last Updated: 조회 시각이 아니라 데이터 업로드 시각(meta.last_data_updated_at)
   - 퀵버튼 3개: 캠페인 전체 / 이번달 / 이번주 (v7: 바이위클리 제거, 달력 조회로 대체)
   - TOP10 테이블 2개: 전체 / 제휴중개사 기준
   - 캠페인 누적 카드에서 시작일 표기 제거
   - 월간 목표: API monthly_goal_total(예: 800건) 사용, 카드 순서 변경
   - 라벨: "중복 참여" → "재참여 중개사"
============================================================ */

'use strict';

// ── 설정 상수 ──────────────────────────────────────────────
const API_URL = 'https://script.google.com/macros/s/AKfycby5MF-6W4T_qoNmBGM7hSsuzJDuTBeo_s0rLAZiDGH2BC8EAqfBB1wcQRvdPFzgQZ2g/exec';

// [v6.1] 기본 조회 시작일 = 캠페인 집계시작일
// (최초 로드 시 사용, 이후 API 응답의 aggregation_start_date로 자동 갱신)
const DEFAULT_CAMPAIGN_START = '2026-06-12';

// ── 전역 상태 ──────────────────────────────────────────────
let weeklyChart          = null;
let compareMode          = false;
let lastData             = null;
let lastCompare          = null;
let aggregationStartDate = DEFAULT_CAMPAIGN_START; // 캠페인 전체 퀵버튼 기준
const responseCache      = new Map();              // [v6.1] 세션 내 응답 캐시 (기간별)

// ── DOM 레퍼런스 ───────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── 유틸: 숫자 포맷 ───────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return Number(n).toLocaleString('ko-KR');
}
function fmtF1(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—%';
  return `${fmtF1(n)}%`;
}
function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}
function delta(curr, prev) {
  if (prev === null || prev === undefined || curr === null || curr === undefined) return { txt: '—', cls: 'flat' };
  const d = curr - prev;
  const p = prev !== 0 ? Math.round((d / Math.abs(prev)) * 1000) / 10 : 0;
  if (d > 0) return { txt: `▲ ${fmt(d)} (+${fmtF1(p)}%)`, cls: 'up' };
  if (d < 0) return { txt: `▼ ${fmt(Math.abs(d))} (${fmtF1(p)}%)`, cls: 'down' };
  return { txt: '변동 없음', cls: 'flat' };
}

// ── 유틸: 날짜 ────────────────────────────────────────────
function todayStr() { return new Date().toLocaleDateString('sv-SE'); }
function monthStartStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
// 이번주 시작 = 이번 주 월요일 (일요일이면 전주 월요일)
function weekStartStr() {
  const now = new Date();
  const day = now.getDay();               // 일=0, 월=1 ...
  const diff = day === 0 ? 6 : day - 1;   // 월요일까지 거슬러 갈 일수
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return dateStr(monday);
}
function dateStr(d) { return d.toLocaleDateString('sv-SE'); }
function shortDate(str) {
  if (!str) return '';
  const parts = str.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ── 초기화 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDateInputs();
  bindEvents();
  updateQuickBtnState();
  loadData();
});

function initDateInputs() {
  // [v6.1] 기본값 = 캠페인 전체 (집계시작일 ~ 오늘)
  $('start-date').value = aggregationStartDate || monthStartStr();
  $('end-date').value   = todayStr();
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
  $('compare-start').value = dateStr(prevMonthStart);
  $('compare-end').value   = dateStr(prevMonthEnd);
}

function bindEvents() {
  $('load-btn').addEventListener('click', loadData);
  $('compare-check').addEventListener('change', onCompareToggle);
  ['start-date','end-date','compare-start','compare-end'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') loadData(); });
  });

  // ── 퀵 기간 선택 버튼 ──────────────────────────────────
  // [캠페인 전체]: 집계시작일 ~ 오늘
  $('quick-campaign').addEventListener('click', () => {
    if (!aggregationStartDate) return;
    $('start-date').value = aggregationStartDate;
    $('end-date').value   = todayStr();
    loadData();
  });

  // [이번달]: 이번달 1일 ~ 오늘
  $('quick-this-month').addEventListener('click', () => {
    $('start-date').value = monthStartStr();
    $('end-date').value   = todayStr();
    loadData();
  });

  // [이번주]: 이번주 월요일 ~ 오늘
  $('quick-this-week').addEventListener('click', () => {
    $('start-date').value = weekStartStr();
    $('end-date').value   = todayStr();
    loadData();
  });

  ['start-date', 'end-date'].forEach(id => {
    $(id).addEventListener('change', updateQuickBtnState);
  });
}

// 현재 date input 값과 퀵버튼 기준값을 비교해 active 클래스를 토글
function updateQuickBtnState() {
  const start = $('start-date').value;
  const end   = $('end-date').value;
  const today = todayStr();

  const isCampaign  = (aggregationStartDate && start === aggregationStartDate && end === today);
  const isThisMonth = (start === monthStartStr() && end === today);
  const isThisWeek  = (start === weekStartStr() && end === today);

  $('quick-campaign').classList.toggle('active', isCampaign);
  $('quick-this-month').classList.toggle('active', isThisMonth);
  $('quick-this-week').classList.toggle('active', isThisWeek);

  // 캠페인 전체: 집계시작일 로드 전 비활성
  $('quick-campaign').disabled = !aggregationStartDate;
  $('quick-campaign').title    = aggregationStartDate
    ? `${aggregationStartDate} ~ 오늘`
    : '데이터 로드 후 활성화됩니다';
}

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
async function loadData() {
  const start = $('start-date').value;
  const end   = $('end-date').value;
  if (!start || !end) { showError('조회 기간을 입력해주세요.'); return; }

  showLoading(true);
  hideError();

  try {
    const url  = buildApiUrl(start, end);
    const data = await fetchJson(url);
    lastData = data;

    if (compareMode) {
      const cStart = $('compare-start').value;
      const cEnd   = $('compare-end').value;
      if (cStart && cEnd) {
        lastCompare = await fetchJson(buildApiUrl(cStart, cEnd));
      }
    } else {
      lastCompare = null;
    }

    renderAll(lastData, lastCompare);

    // [v6] Last Updated: 데이터가 마지막으로 업로드된 시각 표시
    const lastUp = lastData?.meta?.last_data_updated_at;
    $('last-updated').textContent = lastUp
      ? `Last Updated: ${lastUp}`
      : `조회: ${new Date().toLocaleTimeString('ko-KR')}`;

    // API 응답에서 퀵버튼 기준값 캐시
    aggregationStartDate = lastData?.campaign_cumulative?.aggregation_start_date || null;
    updateQuickBtnState();

  } catch (err) {
    console.error(err);
    showError(`데이터를 불러오지 못했습니다: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

function buildApiUrl(start, end) {
  return `${API_URL}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}

async function fetchJson(url) {
  // [v6.1] 세션 내 동일 기간 재조회는 캐시에서 즉시 반환
  if (responseCache.has(url)) return responseCache.get(url);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.message || '서버 오류');

  responseCache.set(url, json);
  return json;
}

// ── 로딩 / 에러 UI ────────────────────────────────────────
function showLoading(on) {
  const ov  = $('loading-overlay');
  const btn = $('load-btn');
  if (on) { ov.classList.remove('hidden'); btn.disabled = true;  }
  else    { ov.classList.add('hidden');    btn.disabled = false; }
}
function showError(msg) { $('error-msg').textContent = msg; $('error-banner').classList.remove('hidden'); }
function hideError()     { $('error-banner').classList.add('hidden'); }

// ── 렌더링 총괄 ───────────────────────────────────────────
// 섹션 순서(v6): 중개사 참여(1, 최상단) → 신청구분/경로/안심케어 2x2(2) → 월간목표+TOP10(3)
function renderAll(data, compare) {
  const period = `${data.meta?.start} ~ ${data.meta?.end}`;
  ['s1-period','s2-period','s3-period','s4-period'].forEach(id => {
    const el = $(id);
    if (el) el.textContent = period;
  });
  $('top10-period-badge').textContent  = period;
  $('top10p-period-badge').textContent = period;

  renderSection1Agents(data, compare);   // 중개사 참여 (최상단, 알림톡 총 발송 포함)
  renderSection2Mix(data);               // 신청구분/경로 + GA4/CTR (2x2)
  renderSection3Target(data);            // 월간 목표 + TOP10 x2
}

// ── 섹션 1: 중개사무소 참여 현황 (최상단) ─────────────────
function renderSection1Agents(data, compare) {
  const ns      = data.notification_stats ?? {};
  const active  = data.participating_agents ?? 0;
  const repeat  = data.repeat_agents ?? 0;
  const partner = data.partner_agent_participation ?? {};

  $('v-total-sent').textContent    = fmt(ns.total_sent);
  $('v-participating').textContent = fmt(active);
  $('v-repeat').textContent        = fmt(repeat);
  $('v-repeat-pct').textContent    = `참여자 대비 ${fmtPct(pct(repeat, active))}`;
  $('v-partner').textContent       = `${fmt(partner.active)} / ${fmt(partner.total)}`;
  $('v-partner-pct').textContent   = `${fmt(partner.total)}개소 중 ${fmtPct(pct(partner.active, partner.total))}`;

  if (compare) renderAgentsCompare(data, compare);
}

function renderAgentsCompare(curr, prev) {
  const row = $('agents-compare-row');
  row.classList.remove('hidden');
  const items = [
    { label: '총 발송건수',     curr: curr.notification_stats?.total_sent,      prev: prev.notification_stats?.total_sent },
    { label: '참여 중개사',     curr: curr.participating_agents,                prev: prev.participating_agents },
    { label: '재참여 중개사',   curr: curr.repeat_agents,                       prev: prev.repeat_agents },
    { label: '제휴중개사 참여',  curr: curr.partner_agent_participation?.active, prev: prev.partner_agent_participation?.active },
    { label: '안심케어 클릭',   curr: curr.notification_stats?.ga4_clicks,      prev: prev.notification_stats?.ga4_clicks },
    { label: '클릭률(CTR)',     curr: curr.notification_stats?.ctr,             prev: prev.notification_stats?.ctr },
  ];
  row.innerHTML = items.map(item => {
    const d = delta(item.curr, item.prev);
    return `<div class="delta-card">
      <span class="delta-label">${item.label}</span>
      <span class="delta-value ${d.cls}">${d.txt}</span>
    </div>`;
  }).join('');
}

// ── 섹션 2: 신청구분/경로 + 안심케어 (2×2) ────────────────
function renderSection2Mix(data) {
  const ns = data.notification_stats ?? {};
  const rt = data.by_request_type    ?? {};
  const ch = data.by_channel         ?? {};

  $('v-ga4-clicks').textContent = fmt(ns.ga4_clicks);
  $('v-ctr').textContent        = fmtF1(ns.ctr);

  const rtTotal = (rt['상담신청'] ?? 0) + (rt['계약고객'] ?? 0);
  renderStackbar({
    barId:    'req-type-bar',
    legendId: 'req-type-legend',
    valuesId: 'req-type-values',
    total:    rtTotal,
    segments: [
      { label: '상담신청', value: rt['상담신청'] ?? 0, color: '#3b7df8' },
      { label: '계약고객', value: rt['계약고객'] ?? 0, color: '#7c4dff' },
    ],
  });

  const chTotal = (ch['제휴소개']?.count ?? 0) + (ch['매물리스트']?.count ?? 0);
  renderStackbar({
    barId:    'channel-bar',
    legendId: 'channel-legend',
    valuesId: 'channel-values',
    total:    chTotal,
    segments: [
      { label: '제휴소개',   value: ch['제휴소개']?.count  ?? 0, color: '#0ea5a0' },
      { label: '매물리스트', value: ch['매물리스트']?.count ?? 0, color: '#f97316' },
    ],
  });
}

// ── 섹션 3: 월간 목표 달성 현황 + TOP10 x2 ────────────────
function renderSection3Target(data) {
  const mt = data.monthly_target      ?? {};
  const cc = data.campaign_cumulative ?? {};
  const wb = data.weekly_breakdown    ?? [];

  const totalBizDays = mt.business_days_in_month ?? 1;
  const elapsedBiz   = mt.elapsed_business_days  ?? 1;
  const actual       = mt.cumulative_actual      ?? 0;

  // [v6] 이번달 전체 목표: API가 직접 계산해 내려줌 (예: 80,000 × 1% = 800)
  // 없으면 누적목표로 선형 추정 (하위 호환)
  let monthlyGoalTotal = mt.monthly_goal_total ?? 0;
  if (!monthlyGoalTotal) {
    const cumTarget = mt.cumulative_target ?? 0;
    monthlyGoalTotal = elapsedBiz > 0 ? Math.round((cumTarget / elapsedBiz) * totalBizDays) : 0;
  }

  const progressPct = monthlyGoalTotal > 0 ? Math.min((actual / monthlyGoalTotal) * 100, 150) : 0;

  // 진행바
  $('prog-pct').textContent    = fmtPct(pct(actual, monthlyGoalTotal));
  $('prog-fill').style.width   = `${Math.min(progressPct, 100)}%`;
  $('prog-actual').textContent = `실적: ${fmt(actual)}건`;
  $('prog-target').textContent = `이번달 목표: ${fmt(monthlyGoalTotal)}건`;

  const ratioUsed = mt.target_ratio_used ?? [];
  const ratioText = ratioUsed.length
    ? ratioUsed.map(r => `${r.ratio}% (${shortDate(r.from)}~${shortDate(r.to)})`).join(', ')
    : '—';
  $('prog-label-ratio').textContent = `적용 목표비율: ${ratioText}`;

  // 일평균 KPI (순서: 일 목표 → 이번달 일평균 → 경과 영업일)
  const dailyAvg    = mt.daily_avg_this_month ?? 0;
  const dailyTarget = totalBizDays > 0 ? monthlyGoalTotal / totalBizDays : 0;
  $('v-daily-target').textContent   = fmtF1(dailyTarget);
  $('v-daily-avg').textContent      = fmtF1(dailyAvg);
  $('v-biz-days').textContent       = fmt(elapsedBiz);
  $('v-biz-days-total').textContent = `/ ${fmt(totalBizDays)}일`;

  // 캠페인 누적 (시작일 표기 제거됨)
  $('v-camp-total').textContent = fmt(cc.total_sent_since_start);
  $('v-camp-biz').textContent   = fmt(cc.business_days_since_start);
  $('v-camp-avg').textContent   = `${fmtF1(cc.daily_avg_since_start)}건`;

  // 차트
  renderWeeklyChart(wb);

  // TOP10 테이블 x2
  renderTop10Table('top10-tbody',  data.top10_agents ?? [],         true);
  renderTop10Table('top10p-tbody', data.top10_partner_agents ?? [], false);
}

// ── Chart.js 주차별 차트 ─────────────────────────────────
function renderWeeklyChart(wb) {
  const ctx = $('weekly-chart').getContext('2d');
  if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }
  if (!wb.length) return;

  const labels      = wb.map(w => `${w.week}주 (${shortDate(w.week_start)})`);
  const sentCounts  = wb.map(w => w.sent_count);
  const cumulatives = wb.map(w => w.cumulative);

  weeklyChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: '주간 발송건수',
          data: sentCounts,
          backgroundColor: 'rgba(59,125,248,0.65)',
          borderColor:     'rgba(59,125,248,0.9)',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: '누적 발송건수',
          data: cumulatives,
          borderColor:     '#0ea5a0',
          backgroundColor: 'rgba(14,165,160,0.08)',
          borderWidth: 2.5,
          pointBackgroundColor: '#0ea5a0',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
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
      animation: { duration: 700, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderColor:     'rgba(20,23,55,0.12)',
          borderWidth: 1,
          padding: 11,
          titleColor: '#4a5275',
          bodyColor:  '#14172b',
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}건`
          }
        },
      },
      scales: {
        x: {
          grid:   { color: 'rgba(20,23,55,0.06)' },
          ticks:  { color: '#4a5275', font: { size: 11 } },
          border: { color: 'rgba(20,23,55,0.1)' },
        },
        y: {
          type: 'linear', position: 'left',
          grid:   { color: 'rgba(20,23,55,0.06)' },
          ticks:  { color: '#4a5275', font: { size: 11 }, callback: v => fmt(v) },
          border: { color: 'rgba(20,23,55,0.1)' },
        },
        y2: {
          type: 'linear', position: 'right',
          grid:   { drawOnChartArea: false },
          ticks:  { color: '#0ea5a0', font: { size: 11 }, callback: v => fmt(v) },
          border: { color: 'rgba(14,165,160,0.2)' },
        },
      },
    },
  });
}

// ── TOP10 테이블 렌더링 (공용) ────────────────────────────
// tbodyId: 대상 tbody, agents: 데이터, showPartnerCol: 제휴 컬럼 표시 여부
function renderTop10Table(tbodyId, agents, showPartnerCol) {
  const tbody = $(tbodyId);
  const colCount = showPartnerCol ? 4 : 3;
  if (!agents.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-row">데이터 없음</td></tr>`;
    return;
  }
  const maxCount = agents[0]?.sent_count || 1;
  tbody.innerHTML = agents.map((ag, i) => {
    const rank    = i + 1;
    const rankCls = rank <= 3 ? `rank-badge--${rank}` : 'rank-badge--n';
    const barPct  = Math.round((ag.sent_count / maxCount) * 100);
    const partnerCell = showPartnerCol
      ? `<td>${ag.is_partner
          ? '<span class="partner-badge">제휴</span>'
          : '<span class="nonpartner-badge">—</span>'}</td>`
      : '';
    return `<tr>
      <td><span class="rank-badge ${rankCls}">${rank}</span></td>
      <td>${escHtml(ag.agency_name || ag.member_id)}</td>
      <td>
        <div class="sent-bar-wrap">
          <div class="sent-bar-bg"><div class="sent-bar-fill" style="width:${barPct}%"></div></div>
          <span class="sent-count-text">${fmt(ag.sent_count)}</span>
        </div>
      </td>
      ${partnerCell}
    </tr>`;
  }).join('');
}

// ── 스택바 렌더링 ────────────────────────────────────────
function renderStackbar({ barId, legendId, valuesId, total, segments }) {
  const bar    = $(barId);
  const legend = $(legendId);
  const vals   = $(valuesId);

  bar.innerHTML = legend.innerHTML = vals.innerHTML = '';

  if (!total) {
    bar.innerHTML = '<div class="stackbar-segment" style="width:100%;background:#e8ecf5;color:#8e96b5">데이터 없음</div>';
    return;
  }

  segments.forEach(seg => {
    const p = total > 0 ? (seg.value / total) * 100 : 0;

    const el = document.createElement('div');
    el.className = 'stackbar-segment';
    el.style.width = `${p}%`;
    el.style.background = seg.color;
    if (p >= 11) el.textContent = `${fmtF1(p)}%`;
    el.title = `${seg.label}: ${fmt(seg.value)}건 (${fmtF1(p)}%)`;
    bar.appendChild(el);

    const li = document.createElement('span');
    li.innerHTML = `<span class="legend-swatch" style="background:${seg.color}"></span>${seg.label}`;
    legend.appendChild(li);

    const vi = document.createElement('div');
    vi.className = 'stackbar-value-item';
    vi.innerHTML = `
      <span class="sv-label">${seg.label}</span>
      <span class="sv-count">${fmt(seg.value)}건</span>
      <span class="sv-pct">${fmtPct(p)}</span>`;
    vals.appendChild(vi);
  });
}

// ── 보안 유틸 ─────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
