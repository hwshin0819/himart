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

// 스프레드시트 타임존 캐시 (성능 최적화)
// ● 날짜 비교 원칙:
//   모든 기간 비교는 시각을 제거한 날짜(YYYY-MM-DD) 단위로만 수행한다.
//   시작일 00:00:00 이상, 종료일의 날짜까지 포함(<=).
//
// ● 타임존 원칙:
//   getValues()로 읽은 Date 객체는 V8 런타임 내부적으로 UTC epoch 기준이므로
//   val.getDate() 등 로컬 메서드는 스크립트 타임존(≒UTC) 기준을 반환한다.
//   시트가 KST(UTC+9)로 설정된 경우, 아침 09:00 이전 데이터는
//   UTC 기준으로 전날로 판정되어 기간 필터에서 탈락한다.
//   → Utilities.formatDate(val, KST_TZ, 'yyyy-MM-dd') 로 시트 타임존 기준 날짜를 추출
//   → 폴백은 Session.getScriptTimeZone()이 아닌 'Asia/Seoul' 하드코딩으로 안전하게 처리
const KST_TZ = 'Asia/Seoul'; // 하이마트 운영 타임존 (UTC+9)
let _sheetTZ = null;
function getSheetTZ() {
  if (!_sheetTZ) {
    try {
      const tz = SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone();
      // getSpreadsheetTimeZone()이 빈 문자열/null을 반환하는 경우 폴백
      _sheetTZ = (tz && tz.trim()) ? tz.trim() : KST_TZ;
    } catch (e) {
      // 권한 오류 등 예외 시 KST 하드코딩 (Session.getScriptTimeZone()은 UTC를 반환할 수 있음)
      _sheetTZ = KST_TZ;
    }
  }
  return _sheetTZ;
}

// ============================================================
// 메인 진입점: doGet(e)
// 쿼리 파라미터 start(YYYY-MM-DD), end(YYYY-MM-DD) 수신
// 기본값: 이번 달 1일 ~ 오늘
// ============================================================
function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};

    // 기준 날짜 설정 (로컬타임 기준)
    const today        = toLocalDate(new Date());
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultEnd   = today;

    const startDate = params.start ? parseDate(params.start) : defaultStart;
    const endDate   = params.end   ? parseDate(params.end)   : defaultEnd;

    // 스프레드시트 전체 데이터 로드 (시트별 객체 배열)
    const data = loadAllSheetData();

    // 각 지표 계산
    // 진단 통계를 먼저 계산해두고 meta에 포함
    // startDate/endDate도 전달해 기간 밖 행 수까지 진단
    const dateStats = calcDateParseStats(data, startDate, endDate);

    const result = {
      meta: {
        start:                    formatDate(startDate),
        end:                      formatDate(endDate),
        generated_at:             formatDatetime(new Date()),
        // ── 진단 필드: 날짜 파싱 현황 ──────────────────────
        // 숫자가 안 맞을 때 이 값을 먼저 확인하세요
        // total = valid + invalid  (파싱 성공/실패)
        // valid = in_range + outside_range  (기간 내/외)
        total_rows_in_sheet:      dateStats.total,
        rows_with_valid_date:     dateStats.valid,
        rows_with_invalid_date:   dateStats.invalid,
        rows_outside_range:       dateStats.outsideRange,
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
// 회원번호 유연 추출 유틸리티 (버그 수정 핵심)
//
// 시트마다 컬럼명이 다를 수 있음:
//   - 신청관리_원본데이터: '회원번호'
//   - 제휴중개사_사전참여: '이실장 회원번호'
//   - 기타 시트: '회원번호' 포함 어떤 이름이든 OK
//
// → 행(row 객체)에서 키 이름에 '회원번호'가 포함된 컬럼을
//   자동으로 찾아 값을 반환. 없으면 빈 문자열.
// ============================================================
function getMemberIdValue(row) {
  if (!row || typeof row !== 'object') return '';
  for (const key of Object.keys(row)) {
    if (key.includes('회원번호')) {
      const val = String(row[key] ?? '').trim();
      if (val && val !== '0' && val !== 'undefined') return val;
    }
  }
  return '';
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

// ============================================================
// 셀 값(문자열/숫자/Date 등)에서 날짜(시분초 없음)를 추출
// 실패하면 null 반환
//
// [강화된 처리 목록]
//   - Date 객체
//   - 숫자 (시리얼 / 타임스탬프)
//   - "2026-06-30 16:17:27"  (하이픈 구분 + 시각)
//   - "2026/06/30 16:17"     (슬래시 구분 + 시각)
//   - "2026.06.30"           (점 구분)
//   - "2026-06-30"           (날짜만)
//   - "06/30/2026"           (MM/DD/YYYY 등 연도 위치 자동 감지)
//   - 앞뒤 공백 허용
// ============================================================
function extractDate(val) {
  if (val === null || val === undefined || val === '') return null;

  // ── 1. Date 객체 ────────────────────────────────────────
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    // ● 날짜 비교 원칙: 시각을 제거한 날짜(YYYY-MM-DD) 단위로만 비교
    //
    // Apps Script getValues()가 반환하는 Date 객체는 V8 내부적으로 UTC epoch 기준.
    // val.getDate() 등 로컬 메서드는 스크립트 런타임 타임존(UTC) 기준을 반환하므로,
    // KST(UTC+9) 시트의 자정~09:00 사이 데이터를 전날로 오판하는 버그가 발생한다.
    //
    // Utilities.formatDate(val, KST 타임존, 'yyyy-MM-dd') 를 사용해
    // 시트 타임존(KST) 기준의 날짜 문자열을 추출한 뒤 parseDate()로 변환한다.
    // getSheetTZ()는 반드시 유효한 IANA 타임존 문자열을 반환하도록 보장됨.
    try {
      const tz      = getSheetTZ(); // 항상 유효한 IANA 타임존 (폴백: 'Asia/Seoul')
      const dateStr = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
      return parseDate(dateStr);
    } catch (e) {
      // 최후 폴백: KST_TZ 하드코딩으로 재시도
      try {
        const dateStr = Utilities.formatDate(val, KST_TZ, 'yyyy-MM-dd');
        return parseDate(dateStr);
      } catch (e2) {
        // 그래도 실패 시 로컬 메서드 사용 (타임존 오차 가능성 있음)
        Logger.log(`[extractDate 폴백] val=${val}, err=${e.message}`);
        return new Date(val.getFullYear(), val.getMonth(), val.getDate());
      }
    }
  }

  // ── 2. 숫자 (스프레드시트 시리얼 날짜 또는 타임스탬프) ──
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d) && d.getFullYear() > 1900) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  }

  // ── 3. 문자열 ───────────────────────────────────────────
  if (typeof val !== 'string') return null;

  const s = val.trim();
  if (!s) return null;

  // 3-a. 날짜+시각 부분만 잘라내기 (T 또는 공백 뒤 시각 제거)
  const datePart = s.split(/[T ]/)[0];

  // 3-b. 점(.) 구분 → 하이픈으로 정규화 "2026.06.30" → "2026-06-30"
  const normalized = datePart.replace(/\./g, '-').replace(/\//g, '-');

  // 3-c. YYYY-MM-DD 패턴 직접 파싱
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const result = new Date(y, m, d);
      if (!isNaN(result) && result.getFullYear() > 1900) return result;
    }
  }

  // 3-d. 연도가 4자리인 위치로 순서 자동 판단
  const parts = normalized.split('-').map(p => parseInt(p, 10));
  if (parts.length === 3 && parts.every(p => !isNaN(p))) {
    let y, m, d;
    if (parts[0] > 31) {
      [y, m, d] = parts;
    } else if (parts[2] > 31) {
      y = parts[2];
      if (parts[0] <= 12) { m = parts[0]; d = parts[1]; }
      else                 { m = parts[1]; d = parts[0]; }
    }
    if (y && m && d) {
      const result = new Date(y, m - 1, d);
      if (!isNaN(result) && result.getFullYear() > 1900) return result;
    }
  }

  // 3-e. 최후 수단: JS Date 생성자 (KST 등 로케일 영향 있으나 폴백으로)
  const fallback = new Date(s);
  if (!isNaN(fallback) && fallback.getFullYear() > 1900) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return null;
}

// ============================================================
// startDate <= date <= endDate 인지 확인
//
// ● 날짜 비교 원칙:
//   모든 기간 비교는 시각을 제거한 날짜(YYYY-MM-DD) 단위로만 수행한다.
//   시작일 00:00:00 이상, 종료일의 날짜까지 포함(<=).
//
// ● 구현 방식: YYYYMMDD 정수 레이블 비교
//   - extractDate()가 항상 new Date(y, m, d) 형태(시각=0)를 반환하므로
//     getFullYear/getMonth/getDate 기준 정수 비교는 타임존 중립.
//   - formatDate(null) 반환 위험 없음, DST 영향 없음.
//   - startDate/endDate 는 parseDate()로 생성된 new Date(y,m,d) 이므로
//     동일 기준으로 정수가 일치하면 반드시 in-range로 판정됨.
// ============================================================
function isInRange(date, startDate, endDate) {
  if (!date || !startDate || !endDate) return false;
  // YYYYMMDD 정수 변환 (시각 성분 없음 — extractDate/parseDate 반환값 기준)
  const toNum = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const dNum = toNum(date);
  const sNum = toNum(startDate);
  const eNum = toNum(endDate);
  return dNum >= sNum && dNum <= eNum;
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
//
// 기준 컬럼: 최근발송일시
//   → 파싱 실패 시 신청일시로 폴백(fallback)
//   → 둘 다 실패한 행만 제외
// ============================================================
function getFilteredApplications(data, startDate, endDate) {
  return (data.APPLICATIONS || []).filter(row => {
    // 1차: 최근발송일시 파싱 시도
    let d = extractDate(row['최근발송일시']);
    // 2차 폴백: 최근발송일시 실패 시 신청일시 사용
    if (!d) d = extractDate(row['신청일시']);
    return d && isInRange(d, startDate, endDate);
  });
}

// ============================================================
// 날짜 파싱 진단 통계 계산
// → meta 진단 필드 4종 반환
//   total        : APPLICATIONS 전체 행 수
//   valid        : 날짜 파싱 성공 행 수 (최근발송일시 또는 신청일시)
//   invalid      : 날짜 파싱 실패 행 수 (양쪽 모두 실패)
//   outsideRange : 파싱 성공했으나 조회 기간 밖인 행 수
//
// 검증 공식:
//   total  == valid + invalid
//   valid  == (기간 내 건수) + outsideRange
// ============================================================
function calcDateParseStats(data, startDate, endDate) {
  const rows = data.APPLICATIONS || [];
  let valid = 0, invalid = 0, outsideRange = 0;

  rows.forEach(row => {
    // getFilteredApplications와 동일한 폴백 로직 사용
    const d = extractDate(row['최근발송일시']) || extractDate(row['신청일시']);

    if (!d) {
      invalid++;
      // 파싱 실패 행의 원본값 로그 기록 (디버깅용)
      Logger.log(`[날짜파싱실패] 최근발송일시='${row['최근발송일시']}' 신청일시='${row['신청일시']}'`);
    } else {
      valid++;
      // startDate/endDate가 있으면 기간 밖 여부도 체크
      if (startDate && endDate && !isInRange(d, startDate, endDate)) {
        outsideRange++;
      }
    }
  });

  return { total: rows.length, valid, invalid, outsideRange };
}

// ============================================================
// 1. total_agents: 회원마스터 전체 행 수
// ============================================================
function calcTotalAgents(data) {
  return (data.MEMBERS || []).length;
}

// ============================================================
// 2. participating_agents: 기간 내 고유 회원번호 수
//    getMemberIdValue() 사용으로 컬럼명 유연하게 처리
// ============================================================
function calcParticipatingAgents(data, startDate, endDate) {
  const rows = getFilteredApplications(data, startDate, endDate);
  const ids  = new Set(rows.map(r => getMemberIdValue(r)).filter(Boolean));
  return ids.size;
}

// ============================================================
// 3. repeat_agents: 기간 내 2건 이상 발송한 회원번호 수
// ============================================================
function calcRepeatAgents(data, startDate, endDate) {
  const rows     = getFilteredApplications(data, startDate, endDate);
  const countMap = {};
  rows.forEach(r => {
    const id = getMemberIdValue(r);
    if (id) countMap[id] = (countMap[id] || 0) + 1;
  });
  return Object.values(countMap).filter(c => c >= 2).length;
}

// ============================================================
// 4. partner_agent_participation: 제휴중개사 참여 현황 (버그 수정)
//
//    [수정 내용]
//    - PARTNERS 시트: '이실장 회원번호' 컬럼 사용 (getMemberIdValue로 자동 감지)
//    - APPLICATIONS 시트: '회원번호' 컬럼 사용 (동일 함수로 처리)
//    - 양쪽 모두 String().trim()으로 공백/타입 차이 제거
// ============================================================
function calcPartnerParticipation(data, startDate, endDate) {
  const partners  = data.PARTNERS || [];
  const appRows   = getFilteredApplications(data, startDate, endDate);

  // 기간 내 발송한 회원번호 Set (신청관리_원본데이터 기준)
  const activeIds = new Set(
    appRows.map(r => getMemberIdValue(r)).filter(Boolean)
  );

  // 제휴중개사 회원번호 목록 ('이실장 회원번호' 컬럼 자동 감지)
  const partnerIds = partners
    .map(r => getMemberIdValue(r))
    .filter(Boolean);

  // 제휴중개사 중 기간 내 활동한 수
  const activeCount = partnerIds.filter(id => activeIds.has(id)).length;

  Logger.log(`제휴중개사 매칭: 전체=${partnerIds.length}, 활동=${activeCount}, 발송IDs 샘플=${[...activeIds].slice(0,3)}, 파트너IDs 샘플=${partnerIds.slice(0,3)}`);

  return {
    total:  partnerIds.length,
    active: activeCount,
  };
}

// ============================================================
// 5. top10_agents: 기간 내 발송건수 상위 10개 중개사무소 (버그 수정)
//    제휴중개사 여부 판단도 getMemberIdValue()로 유연하게 처리
// ============================================================
function calcTop10Agents(data, startDate, endDate) {
  const rows = getFilteredApplications(data, startDate, endDate);

  // 제휴중개사 회원번호 Set 구성 (PARTNERS 시트 - '이실장 회원번호' 자동 감지)
  const partnerSet = new Set(
    (data.PARTNERS || []).map(r => getMemberIdValue(r)).filter(Boolean)
  );

  // 회원번호별 건수 집계
  const countMap = {};
  const nameMap  = {};
  rows.forEach(r => {
    const id   = getMemberIdValue(r);
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
  const bizDays   = countBusinessDays(campaignStart, today, holidaySet);
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
    ctr:        ctr,
  };
}

// ============================================================
// 12. offline_target_activity: 오프라인비치대상 참여 현황
//     (프론트엔드 섹션에서 제거됐지만 API 응답에는 유지)
// ============================================================
function calcOfflineActivity(data, startDate, endDate) {
  const offlineRows = data.OFFLINE || [];
  const appRows     = getFilteredApplications(data, startDate, endDate);
  const activeIds   = new Set(
    appRows.map(r => getMemberIdValue(r)).filter(Boolean)
  );

  const offlineIds  = offlineRows.map(r => getMemberIdValue(r)).filter(Boolean);
  const activeCount = offlineIds.filter(id => activeIds.has(id)).length;

  return {
    total_target: offlineIds.length,
    active_count: activeCount,
  };
}


// ============================================================
// [DEBUG] debugDateFilter()
// 앱스스크립트 편집기에서 직접 실행 -> 날짜 필터링 원인 진단
//
// 실행: 편집기 상단 함수 선택창 -> debugDateFilter -> 실행
// 로그: 편집기 하단 실행 로그 패널
//
// 출력 항목:
//   [환경]     시트 타임존, 기준 날짜 YYYYMMDD 정수값
//   [타임존검증] Date 셀에 대해 KST 포맷 vs .getDate() 결과 비교
//   [기간밖]   원본 셀 값 | extractDate 결과 | 비교 기준값 | 판정 결과
//   [기간내]   정상 샘플 5건
//   [요약]     전체/기간내/기간밖/파싱실패 정확한 건수
//   [진단포인트] 원인 가이드 4가지
// ============================================================
function debugDateFilter() {
  // 조회 기간 설정 (필요 시 수정 후 실행)
  const QUERY_START = '2026-06-15';
  const QUERY_END   = '2026-07-07';

  const tz        = getSheetTZ();
  const startDate = parseDate(QUERY_START);
  const endDate   = parseDate(QUERY_END);
  const data      = loadAllSheetData();
  const rows      = data.APPLICATIONS || [];

  // YYYYMMDD 정수 변환 헬퍼 (isInRange와 동일 로직)
  const toNum = function(d) { return d ? d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate() : 'null'; };

  Logger.log('========== debugDateFilter 시작 ==========');
  Logger.log('[환경] 시트 타임존(getSheetTZ): "' + tz + '"');
  Logger.log('[환경] KST_TZ 상수: "' + KST_TZ + '"');
  Logger.log('[환경] 조회 기간: ' + QUERY_START + ' ~ ' + QUERY_END);
  Logger.log('[환경] startDate YYYYMMDD: ' + toNum(startDate) + ' (' + formatDate(startDate) + ')');
  Logger.log('[환경] endDate   YYYYMMDD: ' + toNum(endDate)   + ' (' + formatDate(endDate)   + ')');
  Logger.log('[환경] 전체 행 수: ' + rows.length);
  Logger.log('------------------------------------------------------------');

  // 타임존 검증: 첫 번째 Date 객체 셀을 여러 방식으로 출력
  var tzChecked = false;
  for (var i = 0; i < Math.min(rows.length, 30); i++) {
    var rawSent = rows[i]['\ucd5c\uadfc\ubc1c\uc1a1\uc77c\uc2dc'];
    if (rawSent instanceof Date) {
      Logger.log('[타임존검증] 최근발송일시 Date 샘플 (행' + (i+2) + '):');
      Logger.log('  원본 Date.toString()             : ' + rawSent.toString());
      Logger.log('  .getFullYear/Month/Date (UTC기준): ' + rawSent.getFullYear() + '-' + (rawSent.getMonth()+1) + '-' + rawSent.getDate());
      try {
        Logger.log('  Utilities.formatDate(KST_TZ)     : ' + Utilities.formatDate(rawSent, KST_TZ, 'yyyy-MM-dd HH:mm:ss'));
        Logger.log('  Utilities.formatDate(tz)         : ' + Utilities.formatDate(rawSent, tz, 'yyyy-MM-dd HH:mm:ss'));
      } catch(fe) {
        Logger.log('  Utilities.formatDate 오류        : ' + fe.message);
      }
      var exResult = extractDate(rawSent);
      Logger.log('  extractDate() 최종결과           : ' + formatDate(exResult) + ' (YYYYMMDD: ' + toNum(exResult) + ')');
      tzChecked = true;
      break;
    }
  }
  if (!tzChecked) {
    Logger.log('[타임존검증] Date 객체 셀 없음 -> 최근발송일시가 문자열이거나 비어있음');
  }
  Logger.log('------------------------------------------------------------');

  var inCnt = 0, outCnt = 0, nullCnt = 0;

  rows.forEach(function(row, idx) {
    var rawSent = row['\ucd5c\uadfc\ubc1c\uc1a1\uc77c\uc2dc'];
    var rawApp  = row['\uc2e0\uccad\uc77c\uc2dc'];
    var rawType = Object.prototype.toString.call(rawSent);

    var dSent  = extractDate(rawSent);
    var dFinal = dSent || extractDate(rawApp);
    var usedCol = dSent ? '\ucd5c\uadfc\ubc1c\uc1a1\uc77c\uc2dc' : (dFinal ? '\uc2e0\uccad\uc77c\uc2dc(\ud3f4\ubc31)' : 'null');

    if (!dFinal) {
      nullCnt++;
      if (nullCnt <= 3) {
        Logger.log('[파싱실패] 행' + (idx+2) + ' | 최근발송일시="' + String(rawSent).substring(0,30) + '" | 신청일시="' + String(rawApp).substring(0,30) + '"');
      }
      return;
    }

    var inRange = isInRange(dFinal, startDate, endDate);

    if (!inRange && outCnt < 10) {
      // 기간 밖 샘플: 원본 셀 값 | extractDate 결과 | 비교에 사용된 시작/종료 기준값 | 판정 결과
      var rawStr  = String(rawSent).substring(0, 40);
      var verdict = toNum(dFinal) + ' NOT IN [' + toNum(startDate) + '~' + toNum(endDate) + '] -> 기간밖';
      Logger.log('[기간밖] 행' + (idx+2) + '\n' +
        '  원본셀값   : "' + rawStr + '" (JS타입: ' + rawType + ')\n' +
        '  extractDate: ' + formatDate(dFinal) + ' (YYYYMMDD: ' + toNum(dFinal) + ')\n' +
        '  비교기준   : start=' + formatDate(startDate) + '(' + toNum(startDate) + ') ~ end=' + formatDate(endDate) + '(' + toNum(endDate) + ')\n' +
        '  판정결과   : ' + verdict + '\n' +
        '  사용컬럼   : ' + usedCol);
      outCnt++;
    } else if (inRange && inCnt < 5) {
      // 기간 내 샘플
      var rawStr2 = String(rawSent).substring(0, 40);
      Logger.log('[기간내] 행' + (idx+2) + ' | "' + rawStr2 + '" -> extractDate=' + formatDate(dFinal) + ' | 사용컬럼=' + usedCol);
      inCnt++;
    }
  });

  // 정확한 집계 (전체 순회)
  var totalOut = 0, totalIn = 0;
  rows.forEach(function(row) {
    var d = extractDate(row['\ucd5c\uadfc\ubc1c\uc1a1\uc77c\uc2dc']) || extractDate(row['\uc2e0\uccad\uc77c\uc2dc']);
    if (!d) return;
    if (isInRange(d, startDate, endDate)) totalIn++;
    else totalOut++;
  });

  Logger.log('------------------------------------------------------------');
  Logger.log('[요약] 전체=' + rows.length + ' | 파싱성공=' + (rows.length - nullCnt) + ' | 파싱실패=' + nullCnt);
  Logger.log('[요약] 기간내=' + totalIn + ' | 기간밖=' + totalOut);
  Logger.log('------------------------------------------------------------');
  Logger.log('[진단포인트]');
  Logger.log('1. 타임존검증에서 KST 포맷 vs .getDate() 결과가 다르면 타임존 버그 -> getSheetTZ() 확인');
  Logger.log('2. 기간밖 행의 YYYYMMDD가 startDate보다 작으면 전날로 오판 (UTC vs KST)');
  Logger.log('3. 사용컬럼=신청일시(폴백)이면 최근발송일시 파싱 실패 -> 신청일시가 기간 이전');
  Logger.log('4. getSheetTZ()가 "UTC" 또는 빈 문자열이면 KST_TZ 상수("Asia/Seoul") 폴백 확인');
}
