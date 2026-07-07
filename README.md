# 하이마트 제휴 대시보드

이실장 × 하이마트 쿠폰 프로모션 실적 관리 대시보드입니다.

## 파일 구조

```
himart/
├── index.html      # 메인 HTML (시맨틱 구조)
├── style.css       # 스타일시트 (다크 테마, 반응형)
├── app.js          # 메인 스크립트 (데이터 fetch, 차트, 렌더링)
└── apps_script/
    └── Code.gs     # Google Apps Script 백엔드
```

## GitHub Pages 배포 방법

### 1. GitHub 저장소 생성
```bash
git init
git add .
git commit -m "feat: 하이마트 제휴 대시보드 초기 배포"
git remote add origin https://github.com/{사용자명}/{저장소명}.git
git push -u origin main
```

### 2. GitHub Pages 설정
1. GitHub 저장소 → **Settings** 탭
2. 좌측 사이드바 → **Pages**
3. **Source** → `Deploy from a branch` 선택
4. **Branch** → `main` 선택, 폴더 → `/ (root)` 선택
5. **Save** 클릭

### 3. 배포 URL 확인
약 1~2분 후 아래 URL에서 확인:
```
https://{사용자명}.github.io/{저장소명}/
```

## 로컬 테스트 방법

CORS 이슈 없이 로컬에서 테스트하려면 간단한 HTTP 서버가 필요합니다:

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code: Live Server 확장 사용
```

그 다음 브라우저에서 `http://localhost:8080` 접속

## 데이터 소스

- **백엔드**: Google Apps Script Web App
- **API URL**: `https://script.google.com/macros/s/AKfycby5MF-6W4T_.../exec`
- **파라미터**: `?start=YYYY-MM-DD&end=YYYY-MM-DD`

## 주요 기능

| 기능 | 설명 |
|---|---|
| 기간 조회 | start/end 날짜 파라미터로 원하는 기간 조회 |
| 기간 비교 | 두 기간의 주요 지표를 나란히 비교 (증감 ▲▼) |
| 섹션 1 | 중개사무소 참여 현황 KPI + TOP10 테이블 |
| 섹션 2 | 월간 목표 달성 진행바 + 주차별 차트 (Chart.js) |
| 섹션 3 | 알림톡/GA4 통계 + 신청구분/경로 스택바 |
| 섹션 4 | 오프라인 비치 대상 활동률 |
| 반응형 | 모바일/태블릿/데스크탑 완전 지원 |
