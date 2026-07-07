/* ============================================================
   app.js — 하이마트 제휴 대시보드 메인 스크립트 (라이트 모드)
============================================================ */

'use strict';

// ── 설정 상수 ──────────────────────────────────────────────
const API_URL = 'https://script.google.com/macros/s/AKfycby5MF-6W4T_qoNmBGM7hSsuzJDuTBeo_s0rLAZiDGH2BC8EAqfBB1wcQRvdPFzgQZ2g/exec';

// ── 전역 상태 ──────────────────────────────────────────────
let weeklyChart = null;
let compareMode = false;
let lastData    = null;
let lastCompare = null;

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
  loadData();
});

function initDateInputs() {
  $('start-date').value = monthStartStr();
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
    $('last-updated').textContent = `갱신: ${new Date().toLocaleTimeString('ko-KR')}`;

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
  if (on) { ov.classList.remove('hidden'); btn.disabled = true;  }
  else    { ov.classList.add('hidden');    btn.disabled = false; }
}
function showError(msg) { $('error-msg').textContent = msg; $('error-banner').classList.remove('hidden'); }
function hideError()     { $('error-banner').classList.add('hidden'); }

// ── 렌더링 총괄 ───────────────────────────────────────────
// 섹션 순서: 알림톡(1) → 중개사 KPI(2) → 월간목표+TOP10(3)
function renderAll(data, compare) {
  const period = `${data.meta?.start} ~ ${data.meta?.end}`;
  ['s1-period','s2-period','s3-period','s4-period'].forEach(id => {
    const el = $(id);
    if (el) el.textContent = period;
  });
  $('top10-period-badge').textContent = period;

  renderSection1Notification(data);    // 알림톡 (최상단)
  renderSection2Agents(data, compare); // 중개사 KPI
  renderSection3Target(data);          // 월간 목표 + TOP10
}

// ── 섹션 1: 알림톡·안심케어 (최상단) ─────────────────────
function renderSection1Notification(data) {
  const ns = data.notification_stats ?? {};
  const rt = data.by_request_type    ?? {};
  const ch = data.by_channel         ?? {};

  $('v-total-sent').textContent = fmt(ns.total_sent);
  $('v-ga4-clicks').textContent = fmt(ns.ga4_clicks);
  $('v-ctr').textContent        = fmtF1(ns.ctr);

  // 신청구분 스택바
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

  // 신청경로 스택바
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

// ── 섹션 2: 중개사무소 참여 현황 (KPI) ───────────────────
function renderSection2Agents(data, compare) {
  const total   = data.total_agents ?? 0;
  const active  = data.participating_agents ?? 0;
  const repeat  = data.repeat_agents ?? 0;
  const partner = data.partner_agent_participation ?? {};

  $('v-total-agents').textContent    = fmt(total);
  $('v-participating').textContent   = fmt(active);
  $('v-participating-pct').textContent = `전체 대비 ${fmtPct(pct(active, total))}`;
  $('v-repeat').textContent          = fmt(repeat);
  $('v-repeat-pct').textContent      = `참여자 대비 ${fmtPct(pct(repeat, active))}`;
  $('v-partner').textContent         = `${fmt(partner.active)} / ${fmt(partner.total)}`;
  $('v-partner-pct').textContent     = `${fmt(partner.total)}개소 중 ${fmtPct(pct(partner.active, partner.total))}`;

  if (compare) renderAgentsCompare(data, compare);
}

function renderAgentsCompare(curr, prev) {
  const row = $('agents-compare-row');
  row.classList.remove('hidden');
  const items = [
    { label: '참여 중개사',    curr: curr.participating_agents,                   prev: prev.participating_agents },
    { label: '중복 참여',      curr: curr.repeat_agents,                          prev: prev.repeat_agents },
    { label: '제휴중개사 참여', curr: curr.partner_agent_participation?.active,    prev: prev.partner_agent_participation?.active },
    { label: '총 발송건수',    curr: curr.notification_stats?.total_sent,         prev: prev.notification_stats?.total_sent },
  ];
  row.innerHTML = items.map(item => {
    const d = delta(item.curr, item.prev);
    return `<div class="delta-card">
      <span class="delta-label">${item.label}</span>
      <span class="delta-value ${d.cls}">${d.txt}</span>
    </div>`;
  }).join('');
}

// ── 섹션 3: 월간 목표 달성 현황 + TOP10 ──────────────────
function renderSection3Target(data) {
  const mt = data.monthly_target     ?? {};
  const cc = data.campaign_cumulative ?? {};
  const wb = data.weekly_breakdown   ?? [];

  const totalBizDays   = mt.business_days_in_month ?? 1;
  const elapsedBiz     = mt.elapsed_business_days  ?? 1;
  const monthlyGoal    = mt.cumulative_target       ?? 0;
  const actual         = mt.cumulative_actual       ?? 0;

  // 월 전체 목표 추산 (오늘까지 누적 목표를 기준으로 월말 선형 추정)
  const projFullTarget = elapsedBiz > 0 ? (monthlyGoal / elapsedBiz) * totalBizDays : 0;
  const progressPct    = projFullTarget > 0 ? Math.min((actual / projFullTarget) * 100, 150) : 0;

  // 진행바
  $('prog-pct').textContent       = fmtPct(pct(actual, projFullTarget));
  $('prog-fill').style.width      = `${Math.min(progressPct, 100)}%`;
  $('prog-actual').textContent    = `실적: ${fmt(actual)}건`;
  $('prog-target').textContent    = `이번달 전체 목표(추산): ${fmt(Math.round(projFullTarget))}건`;

  const ratioUsed = mt.target_ratio_used ?? [];
  const ratioText = ratioUsed.length
    ? ratioUsed.map(r => `${r.ratio}% (${shortDate(r.from)}~${shortDate(r.to)})`).join(', ')
    : '—';
  $('prog-label-ratio').textContent = `적용 목표비율: ${ratioText}`;

  // 일평균 KPI
  const dailyAvg    = mt.daily_avg_this_month ?? 0;
  const dailyTarget = projFullTarget > 0 && totalBizDays > 0 ? projFullTarget / totalBizDays : 0;
  $('v-daily-avg').textContent      = fmtF1(dailyAvg);
  $('v-daily-target').textContent   = fmtF1(dailyTarget);
  $('v-biz-days').textContent       = fmt(elapsedBiz);
  $('v-biz-days-total').textContent = `/ ${fmt(totalBizDays)}일`;

  // 캠페인 누적
  $('v-camp-start').textContent = cc.campaign_start_date          ?? '—';
  $('v-camp-total').textContent = fmt(cc.total_sent_since_start);
  $('v-camp-biz').textContent   = fmt(cc.business_days_since_start);
  $('v-camp-avg').textContent   = `${fmtF1(cc.daily_avg_since_start)}건`;

  // 차트
  renderWeeklyChart(wb);

  // TOP10 테이블 (오른쪽 컬럼)
  renderTop10Table(data.top10_agents ?? []);
}

// ── Chart.js 주차별 차트 (라이트 모드 색상) ──────────────
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
          boxShadow:  '0 4px 12px rgba(0,0,0,0.1)',
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

// ── TOP10 테이블 렌더링 ───────────────────────────────────
function renderTop10Table(agents) {
  const tbody = $('top10-tbody');
  if (!agents.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">데이터 없음</td></tr>';
    return;
  }
  const maxCount = agents[0]?.sent_count || 1;
  tbody.innerHTML = agents.map((ag, i) => {
    const rank    = i + 1;
    const rankCls = rank <= 3 ? `rank-badge--${rank}` : 'rank-badge--n';
    const partnerHtml = ag.is_partner
      ? '<span class="partner-badge">제휴</span>'
      : '<span class="nonpartner-badge">—</span>';
    const barPct = Math.round((ag.sent_count / maxCount) * 100);
    return `<tr>
      <td><span class="rank-badge ${rankCls}">${rank}</span></td>
      <td>${escHtml(ag.agency_name || ag.member_id)}</td>
      <td>
        <div class="sent-bar-wrap">
          <div class="sent-bar-bg"><div class="sent-bar-fill" style="width:${barPct}%"></div></div>
          <span class="sent-count-text">${fmt(ag.sent_count)}</span>
        </div>
      </td>
      <td>${partnerHtml}</td>
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
