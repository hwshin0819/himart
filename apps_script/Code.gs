// ============================================================
// 이실장 × 하이마트 쿠폰 프로모션 대시보드 백엔드
// Google Apps Script Web App (doGet)
// 스프레드시트 ID: 1DqtrYVJBveCYvV9b_3y2SZRe2A6LGGpWujfhbHJFWdY
// ============================================================

const SPREADSHEET_ID = '1DqtrYVJBveCYvV9b_3y2SZRe2A6LGGpWujfhbHJFWdY';

// 탭(시트) 이름 상수
const SHEET = {
  APPLICATIONS: '신청관리_원본데이터',
  MEMBERS:      '회원마스터',
  PARTNERS:     '제휴중개사_사전참여',
  OFFLINE:      '오프라인비치대상',
  GA4:          'GA4클릭데이터',
  TARGET_RATIO: '목표비율_변경이력',
  MONTHLY_TXN:  '월평균거래완료건수',
  HOLIDAYS:     '공휴일마스터',
};

// ============================================================
// 메인 진입점: doGet(e)
// 쿼리 파라미터 start(YYYY-MM-DD), end(YYYY-MM-DD) 수신
// 기본값: 이번 달 1일 ~ 오늘
// ============================================================
function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};

    // 기준 날짜 설정 (로컬타임 기준)
    const today = toLocalDate(new Date());
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultEnd   = today;

    const startDate = params.start ? parseDate(params.start) : defaultStart;
    const endDate   = params.end   ? parseDate(params.end)   : defaultEnd;

    // 스프레드시트 전체 데이터 로드 (시트별 객체 배열)
    const data = loadAllSheetData();

    // 각 지표 계산
    const result = {
      meta: {
        start:        formatDate(startDate),
        end:          formatDate(endDate),
        generated_at: formatDatetime(new Date()),
      },
      total_agents:                calcTotalAgents(data),
      participating_agents:        calcParticipatingAgents(data, startDate, endDate),
      repeat_agents:               calcRepeatAgents(data, startDate, endDate),
      partner_agent_participation: calcPartnerParticipation(data, startDate, endDate),
      top10_agents:                calcTop10Agents(data, startDate, endDate),
      monthly_target:              calcMonthlyTarget(data, today),
      campaign_cumulative:         calcCampaignCumulative(data, today),
      weekly_breakdown:            calcWeeklyBreakdown(data, today),
      by_request_type:             calcByRequestType(data, startDate, endDate),
      by_channel:                  calcByChannel(data, startDate, endDate),
      notification_stats:          calcNotificationStats(data, startDate, endDate),
      offline_target_activity:     calcOfflineActivity(data, startDate, endDate),
    };

    return ContentService
      .createTextOutput(JSON.stringify(result, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // 에러 발생 시에도 JSON 형태로 반환
    const errResult = {
      error:   true,
      message: err.message,
      stack:   err.stack,
    };
    return ContentService
      .createTextOutput(JSON.stringify(errResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// 데이터 로드: 모든 시트의 데이터를 한 번에 읽어 객체로 반환
// 헤더 행(1번 행)을 키로 사용하여 객체 배열로 변환
// 데이터가 없거나 시트가 없으면 빈 배열 반환
// ============================================================
function loadAllSheetData() {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = {};

  for (const key in SHEET) {
    const sheetName = SHEET[key];
    try {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        Logger.log(`시트 없음: ${sheetName}`);
        data[key] = [];
        continue;
      }
      const values = sheet.getDataRange().getValues();
      if (values.length < 2) {
        data[key] = [];
        continue;
      }
      // 1행을 헤더로 사용, 이후 행은 객체로 변환
      const headers = values[0].map(h => String(h).trim());
      data[key] = values.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
      }).filter(row =>
        // 모든 값이 비어 있는 행 제거
        Object.values(row).some(v => v !== '' && v !== null && v !== undefined)
      );
    } catch (e) {
      Logger.log(`시트 로드 에러 [${sheetName}]: ${e.message}`);
      data[key] = [];
    }
  }

  return data;
}

// ============================================================
// 날짜/시간 유틸리티 함수들
// ============================================================

// 'YYYY-MM-DD' 또는 'YYYY/MM/DD' 문자열 → Date 객체 (시분초 0)
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim().replace(/\//g, '-');
  const parts = s.split('-');
  if (parts.length < 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m, d);
}

// Date → 'YYYY-MM-DD' 문자열
function formatDate(d) {
  if (!d || isNaN(d)) return null;
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Date → 'YYYY-MM-DD HH:mm:ss' 문자열
function formatDatetime(d) {
  if (!d || isNaN(d)) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mm}:${ss}`;
}

// new Date()에서 시분초를 제거한 날짜 객체 반환
function toLocalDate(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 셀 값(문자열/숫자/Date 등)에서 날짜(시분초 없음)를 추출
// 실패하면 null 반환
function extractDate(val) {
  if (val === null || val === undefined || val === '') return null;

  // Date 객체인 경우
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }

  // 숫자인 경우 (스프레드시트 시리얼 날짜 또는 타임스탬프)
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d) && d.getFullYear() > 1900) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  }

  // 문자열인 경우
  if (typeof val === 'string') {
    // 'YYYY-MM-DD' 또는 'YYYY/MM/DD' 형식 직접 파싱
    const directParsed = parseDate(val.split(' ')[0].split('T')[0]);
    if (directParsed) return directParsed;
    // 그 외 문자열은 Date 생성자로 시도
    const d = new Date(val);
    if (!isNaN(d) && d.getFullYear() > 1900) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }

  return null;
}

// startDate <= date <= endDate 인지 확인
function isInRange(date, startDate, endDate) {
  if (!date || !startDate || !endDate) return false;
  return date.getTime() >= startDate.getTime() && date.getTime() <= endDate.getTime();
}

// ============================================================
// 영업일 계산 유틸리티
// 규칙: 일요일 + 공휴일마스터에 있는 날 제외, 토요일은 포함
// ============================================================

// 공휴일마스터에서 'YYYY-MM-DD' 문자열 Set 생성
function buildHolidaySet(data) {
  const set = new Set();
  (data.HOLIDAYS || []).forEach(row => {
    const d = extractDate(row['날짜']);
    if (d) set.add(formatDate(d));
  });
  return set;
}

// 특정 날짜가 영업일인지 확인
function isBusinessDay(date, holidaySet) {
  if (!date) return false;
  if (date.getDay() === 0) return false;              // 일요일 제외
  if (holidaySet.has(formatDate(date))) return false; // 공휴일 제외
  return true;                                         // 나머지(월~토) 영업일
}

// startDate ~ endDate 사이의 영업일 수 반환
function countBusinessDays(startDate, endDate, holidaySet) {
  let count = 0;
  const cur = new Date(startDate);
  while (cur <= endDate) {
    if (isBusinessDay(cur, holidaySet)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ============================================================
// 신청관리_원본데이터에서 기간 필터링된 행 반환
// 기준 컬럼: 최근발송일시
// ============================================================
function getFilteredApplications(data, startDate, endDate) {
  return (data.APPLICATIONS || []).filter(row => {
    const d = extractDate(row['최근발송일시']);
    return d && isInRange(d, startDate, endDate);
  });
}

// ============================================================
// 1. total_agents: 회원마스터 전체 행 수
// ============================================================
function calcTotalAgents(data) {
  return (data.MEMBERS || []).length;
}

// ============================================================
// 2. participating_agents: 기간 내 고유 회원번호 수
// ============================================================
function calcParticipatingAgents(data, startDate, endDate) {
  const rows = getFilteredApplications(data, startDate, endDate);
  const ids  = new Set(rows.map(r => String(r['회원번호']).trim()).filter(Boolean));
  return ids.size;
}

// ============================================================
// 3. repeat_agents: 기간 내 2건 이상 발송한 회원번호 수
// ============================================================
function calcRepeatAgents(data, startDate, endDate) {
  const rows     = getFilteredApplications(data, startDate, endDate);
  const countMap = {};
  rows.forEach(r => {
    const id = String(r['회원번호']).trim();
    if (id) countMap[id] = (countMap[id] || 0) + 1;
  });
  return Object.values(countMap).filter(c => c >= 2).length;
}

// ============================================================
// 4. partner_agent_participation: 제휴중개사 참여 현황
//    total: 제휴중개사_사전참여 전체 수
//    active: 그중 기간 내 신청관리_원본데이터에 존재하는 회원번호 수
// ============================================================
function calcPartnerParticipation(data, startDate, endDate) {
  const partners  = data.PARTNERS || [];
  const appRows   = getFilteredApplications(data, startDate, endDate);
  const activeIds = new Set(appRows.map(r => String(r['회원번호']).trim()).filter(Boolean));

  const partnerIds     = partners.map(r => String(r['회원번호']).trim()).filter(Boolean);
  const activeCount    = partnerIds.filter(id => activeIds.has(id)).length;

  return {
    total:  partnerIds.length,
    active: activeCount,
  };
}

// ============================================================
// 5. top10_agents: 기간 내 발송건수 상위 10개 중개사무소
//    (회원번호, 중개업소명, 발송건수, 제휴중개사여부)
// ============================================================
function calcTop10Agents(data, startDate, endDate) {
  const rows      = getFilteredApplications(data, startDate, endDate);
  const partnerSet = new Set(
    (data.PARTNERS || []).map(r => String(r['회원번호']).trim()).filter(Boolean)
  );

  // 회원번호별 건수 집계
  const countMap = {};
  const nameMap  = {};
  rows.forEach(r => {
    const id   = String(r['회원번호']).trim();
    const name = String(r['중개업소명'] || '').trim();
    if (!id) return;
    countMap[id] = (countMap[id] || 0) + 1;
    if (name && !nameMap[id]) nameMap[id] = name;
  });

  return Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      member_id:   id,
      agency_name: nameMap[id] || '',
      sent_count:  count,
      is_partner:  partnerSet.has(id),
    }));
}

// ============================================================
// 6. monthly_target: 이번달 목표 vs 실적
//    - 목표비율_변경이력이 월 중간에 바뀌면 구간별로 다른 기울기 적용
//    - 일일목표 = 월평균거래완료건수 × 목표비율% / 월영업일수
// ============================================================
function calcMonthlyTarget(data, today) {
  const holidaySet = buildHolidaySet(data);

  // 이번달 시작일 / 말일
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // 월평균 거래완료건수 최신값 (등록일시 내림차순)
  const txnRows = [...(data.MONTHLY_TXN || [])].sort((a, b) => {
    const da = extractDate(a['등록일시']) || new Date(0);
    const db = extractDate(b['등록일시']) || new Date(0);
    return db - da;
  });
  const latestRow  = txnRows[0] || {};
  const monthlyAvg = parseFloat(latestRow['월평균거래완료건수']) || 0;

  // 목표비율_변경이력 → 적용시작일 오름차순 정렬
  const ratioHistory = (data.TARGET_RATIO || [])
    .map(r => ({
      startDate: extractDate(r['적용시작일']),
      ratio:     parseFloat(r['목표비율(%)']) || 0,
    }))
    .filter(r => r.startDate && !isNaN(r.startDate))
    .sort((a, b) => a.startDate - b.startDate);

  // 이번달에 겹치는 비율 구간 계산
  // 각 비율은 적용시작일부터 다음 적용시작일 하루 전까지 유효
  const ratioSegments = [];
  for (let i = 0; i < ratioHistory.length; i++) {
    const cur     = ratioHistory[i];
    const next    = ratioHistory[i + 1];
    const segFrom = cur.startDate;
    const segTo   = next
      ? new Date(next.startDate.getTime() - 86400000) // 다음 시작일 하루 전
      : new Date(9999, 11, 31);

    // 이번달과의 교집합
    const overlapFrom = new Date(Math.max(segFrom.getTime(), monthStart.getTime()));
    const overlapTo   = new Date(Math.min(segTo.getTime(),   monthEnd.getTime()));

    if (overlapFrom <= overlapTo) {
      ratioSegments.push({ from: overlapFrom, to: overlapTo, ratio: cur.ratio });
    }
  }

  // 이번달 총 영업일수
  const totalBizDays = countBusinessDays(monthStart, monthEnd, holidaySet);

  // 오늘까지의 누적 목표건수 계산 (구간별 영업일 × 일일목표)
  let cumulativeTarget = 0;
  const ratioUsed      = [];

  ratioSegments.forEach(seg => {
    if (seg.from > today) return; // 아직 도래하지 않은 구간 제외
    const calcTo = new Date(Math.min(seg.to.getTime(), today.getTime()));

    // 이 구간에서 오늘까지의 영업일수
    const bizDaysInSeg = countBusinessDays(seg.from, calcTo, holidaySet);
    // 일일 목표 = 월목표 / 월총영업일
    const monthlyGoal  = monthlyAvg * (seg.ratio / 100);
    const dailyGoal    = totalBizDays > 0 ? monthlyGoal / totalBizDays : 0;

    cumulativeTarget += dailyGoal * bizDaysInSeg;
    ratioUsed.push({
      from:  formatDate(seg.from),
      to:    formatDate(seg.to),
      ratio: seg.ratio,
    });
  });

  // 이번달 1일 ~ 오늘까지 실제 누적 발송건수
  const monthRows        = getFilteredApplications(data, monthStart, today);
  const cumulativeActual = monthRows.length;

  // 경과 영업일수 (이번달 1일 ~ 오늘 포함)
  const elapsedBizDays = countBusinessDays(monthStart, today, holidaySet);

  // 이번달 일평균 발송건수
  const dailyAvg = elapsedBizDays > 0
    ? Math.round((cumulativeActual / elapsedBizDays) * 100) / 100
    : 0;

  return {
    target_ratio_used:        ratioUsed,
    monthly_avg_transactions: monthlyAvg,
    business_days_in_month:   totalBizDays,
    elapsed_business_days:    elapsedBizDays,
    cumulative_target:        Math.round(cumulativeTarget * 100) / 100,
    cumulative_actual:        cumulativeActual,
    daily_avg_this_month:     dailyAvg,
  };
}

// ============================================================
// 7. campaign_cumulative: 캠페인 시작일부터 오늘까지 누적 통계
//    캠페인시작일은 월평균거래완료건수 시트에서 읽음
// ============================================================
function calcCampaignCumulative(data, today) {
  const holidaySet = buildHolidaySet(data);

  // 캠페인시작일 추출 (첫 번째로 유효한 값)
  let campaignStart = null;
  for (const row of (data.MONTHLY_TXN || [])) {
    const d = extractDate(row['캠페인시작일']);
    if (d) { campaignStart = d; break; }
  }

  if (!campaignStart) {
    return {
      campaign_start_date:       null,
      total_sent_since_start:    0,
      business_days_since_start: 0,
      daily_avg_since_start:     0,
    };
  }

  // 캠페인 시작일 ~ 오늘까지 영업일수
  const bizDays  = countBusinessDays(campaignStart, today, holidaySet);
  // 캠페인 시작일 ~ 오늘까지 총 발송건수
  const totalSent = getFilteredApplications(data, campaignStart, today).length;
  const dailyAvg  = bizDays > 0
    ? Math.round((totalSent / bizDays) * 100) / 100
    : 0;

  return {
    campaign_start_date:       formatDate(campaignStart),
    total_sent_since_start:    totalSent,
    business_days_since_start: bizDays,
    daily_avg_since_start:     dailyAvg,
  };
}

// ============================================================
// 8. weekly_breakdown: 이번달을 1일 기준 7일 단위로 나눈 주차별 집계
//    [{week, week_start, week_end, sent_count, cumulative}]
// ============================================================
function calcWeeklyBreakdown(data, today) {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // 이번달 전체 신청 데이터 (말일까지)
  const monthRows = getFilteredApplications(data, monthStart, monthEnd);

  // 날짜별 발송건수 맵 구성
  const dailyMap = {};
  monthRows.forEach(r => {
    const d = extractDate(r['최근발송일시']);
    if (!d) return;
    const key = formatDate(d);
    dailyMap[key] = (dailyMap[key] || 0) + 1;
  });

  const weeks    = [];
  let weekNum    = 1;
  let cumulative = 0;
  let cur        = new Date(monthStart);

  while (cur <= monthEnd) {
    // 주차 종료일: 시작+6일 vs 말일 중 작은 값
    const weekEnd = new Date(Math.min(
      new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 6).getTime(),
      monthEnd.getTime()
    ));

    // 이 주차의 발송건수 합계
    let weekCount = 0;
    const d = new Date(cur);
    while (d <= weekEnd) {
      weekCount += (dailyMap[formatDate(d)] || 0);
      d.setDate(d.getDate() + 1);
    }

    cumulative += weekCount;
    weeks.push({
      week:       weekNum,
      week_start: formatDate(new Date(cur)),
      week_end:   formatDate(weekEnd),
      sent_count: weekCount,
      cumulative: cumulative,
    });

    weekNum++;
    cur.setDate(cur.getDate() + 7);
  }

  return weeks;
}

// ============================================================
// 9. by_request_type: 신청구분별 건수 (상담신청 / 계약고객)
// ============================================================
function calcByRequestType(data, startDate, endDate) {
  const rows   = getFilteredApplications(data, startDate, endDate);
  const result = { '상담신청': 0, '계약고객': 0 };
  rows.forEach(r => {
    const type = String(r['신청구분'] || '').trim();
    if (type in result) result[type]++;
  });
  return result;
}

// ============================================================
// 10. by_channel: 신청경로별 건수 및 비율 (제휴소개 / 매물리스트)
// ============================================================
function calcByChannel(data, startDate, endDate) {
  const rows     = getFilteredApplications(data, startDate, endDate);
  const total    = rows.length;
  const countMap = { '제휴소개': 0, '매물리스트': 0 };

  rows.forEach(r => {
    const ch = String(r['신청경로'] || '').trim();
    if (ch in countMap) countMap[ch]++;
  });

  const result = {};
  for (const key in countMap) {
    const count = countMap[key];
    result[key] = {
      count: count,
      pct:   total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
    };
  }
  return result;
}

// ============================================================
// 11. notification_stats: 알림톡 발송 통계 + GA4 클릭수 + CTR
// ============================================================
function calcNotificationStats(data, startDate, endDate) {
  const rows      = getFilteredApplications(data, startDate, endDate);
  const totalSent = rows.length;

  // GA4클릭데이터에서 기간 내 클릭수 합산
  const ga4Clicks = (data.GA4 || []).reduce((sum, row) => {
    const d = extractDate(row['날짜']);
    if (!d || !isInRange(d, startDate, endDate)) return sum;
    const clicks = parseInt(row['클릭수'], 10) || 0;
    return sum + clicks;
  }, 0);

  // CTR = 클릭수 / 발송건수 × 100 (%)
  const ctr = totalSent > 0
    ? Math.round((ga4Clicks / totalSent) * 10000) / 100
    : 0;

  return {
    total_sent: totalSent,
    ga4_clicks: ga4Clicks,
    ctr:        ctr, // 단위: %
  };
}

// ============================================================
// 12. offline_target_activity: 오프라인비치대상 참여 현황
//     total_target: 오프라인비치대상 전체 수
//     active_count: 그중 기간 내 신청관리_원본데이터에 있는 회원번호 수
// ============================================================
function calcOfflineActivity(data, startDate, endDate) {
  const offlineRows = data.OFFLINE || [];
  const appRows     = getFilteredApplications(data, startDate, endDate);
  const activeIds   = new Set(appRows.map(r => String(r['회원번호']).trim()).filter(Boolean));

  const offlineIds  = offlineRows.map(r => String(r['회원번호']).trim()).filter(Boolean);
  const activeCount = offlineIds.filter(id => activeIds.has(id)).length;

  return {
    total_target: offlineIds.length,
    active_count: activeCount,
  };
}
