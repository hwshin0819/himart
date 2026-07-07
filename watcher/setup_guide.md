# 하이마트 쿠폰 업로더 — 완전 설정 가이드

## 목차
1. Python 설치
2. 라이브러리 설치
3. 구글 서비스 계정 설정 (가장 중요!)
4. 스크립트 설정값 수정
5. 테스트 실행
6. 자동 시작 등록 (로그인 시 자동 실행)

---

## 1. Python 설치

### 설치 방법
1. [https://www.python.org/downloads/](https://www.python.org/downloads/) 접속
2. **"Download Python 3.12.x"** 버튼 클릭
3. 설치 파일 실행 시 반드시 **☑ Add Python to PATH** 체크!
4. **Install Now** 클릭

### 설치 확인
```
Win + R → cmd → 입력 후 Enter
python --version
```
`Python 3.12.x` 가 보이면 성공

---

## 2. 라이브러리 설치

명령 프롬프트(cmd)를 **관리자 권한**으로 열고 아래 명령어 실행:

```bash
pip install watchdog pandas openpyxl gspread google-auth
```

### 각 라이브러리 역할
| 라이브러리 | 역할 |
|---|---|
| `watchdog` | 폴더 파일 변화 감시 |
| `pandas` | 엑셀 파일 파싱 및 컬럼 추출 |
| `openpyxl` | pandas의 xlsx 엔진 |
| `gspread` | 구글 스프레드시트 API 연동 |
| `google-auth` | 구글 서비스 계정 인증 |

---

## 3. 구글 서비스 계정 설정 ⭐ (필수)

### 3-1. 구글 클라우드 프로젝트 생성

1. [https://console.cloud.google.com](https://console.cloud.google.com) 접속 (구글 계정 로그인)
2. 상단 프로젝트 드롭다운 → **"새 프로젝트"** 클릭
3. 프로젝트 이름: `himart-dashboard` → **만들기**

### 3-2. Google Sheets API 활성화

1. 좌측 메뉴 → **"API 및 서비스"** → **"라이브러리"**
2. 검색창에 `Google Sheets API` 입력
3. **Google Sheets API** 클릭 → **"사용 설정"** 클릭
4. 동일하게 `Google Drive API`도 검색하여 **"사용 설정"**

### 3-3. 서비스 계정 생성

1. 좌측 메뉴 → **"API 및 서비스"** → **"사용자 인증 정보"**
2. 상단 **"+ 사용자 인증 정보 만들기"** → **"서비스 계정"** 클릭
3. 서비스 계정 이름: `himart-uploader` → **"만들고 계속하기"**
4. 역할 선택: **"편집자"** → **"계속"** → **"완료"**

### 3-4. JSON 키 파일 다운로드

1. 방금 만든 서비스 계정 클릭 (이메일 형식: `himart-uploader@himart-dashboard.iam.gserviceaccount.com`)
2. 상단 **"키"** 탭 클릭
3. **"키 추가"** → **"새 키 만들기"** → **JSON** 선택 → **"만들기"**
4. JSON 파일이 다운로드됨 → 아래 경로에 저장:
   ```
   C:\project\himart\watcher\service_account_key.json
   ```

> ⚠️ **이 JSON 파일은 절대 공개하거나 git에 올리지 마세요!**

### 3-5. 스프레드시트에 서비스 계정 공유

1. [구글 스프레드시트](https://docs.google.com/spreadsheets/d/1DqtrYVJBveCYvV9b_3y2SZRe2A6LGGpWujfhbHJFWdY) 열기
2. 우측 상단 **"공유"** 버튼 클릭
3. 서비스 계정 이메일 입력:
   ```
   himart-uploader@himart-dashboard.iam.gserviceaccount.com
   ```
   (실제 이메일은 JSON 파일 내 `client_email` 값)
4. 역할: **"편집자"** 선택
5. **"보내기"** 클릭 (알림 메일은 체크 해제해도 됨)

---

## 4. 스크립트 설정값 확인

`watcher.py` 상단의 설정값이 아래와 맞는지 확인:

```python
WATCH_FOLDER         = r"C:\Users\proptier\Downloads"       # 다운로드 폴더
SERVICE_ACCOUNT_KEY  = r"C:\project\himart\watcher\service_account_key.json"
SPREADSHEET_ID       = "1DqtrYVJBveCYvV9b_3y2SZRe2A6LGGpWujfhbHJFWdY"
SHEET_NAME           = "신청관리_원본데이터"
```

다운로드 폴더 경로 확인 방법:
```
탐색기 → 다운로드 폴더 → 주소창 클릭 → 전체 경로 복사
```

---

## 5. 테스트 실행

cmd에서:
```bash
python C:\project\himart\watcher\watcher.py
```

정상 실행 시 아래 메시지가 표시됨:
```
2026-07-07 08:30:00 [INFO] 하이마트 쿠폰 신청관리 업로더 시작
2026-07-07 08:30:00 [INFO] 감시 폴더: C:\Users\proptier\Downloads
2026-07-07 08:30:01 [INFO] 기존 파일 스캔 중…
2026-07-07 08:30:01 [INFO] 처리할 기존 파일 없음
2026-07-07 08:30:01 [INFO] 파일 감시 시작 — 새 파일 대기 중...
```

---

## 6. 자동 시작 등록 (로그인 시 자동 실행) ⭐

### 방법: Windows 작업 스케줄러 (권장)

**관리자 권한** cmd에서 아래 명령어 한 번만 실행:

```batch
schtasks /create ^
  /tn "HimartWatcher" ^
  /tr "C:\project\himart\watcher\run_watcher.bat" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /f
```

#### 등록 확인
```batch
schtasks /query /tn "HimartWatcher"
```

#### 수동으로 지금 실행
```batch
schtasks /run /tn "HimartWatcher"
```

#### 등록 삭제 (더 이상 자동 실행 안 하려면)
```batch
schtasks /delete /tn "HimartWatcher" /f
```

---

### 대안: 시작프로그램 폴더에 바로가기 등록

1. `Win + R` → `shell:startup` 입력 → Enter
2. 시작프로그램 폴더가 열림
3. `run_watcher.bat`의 **바로가기** 복사해서 이 폴더에 붙여넣기

---

## 7. 로그 확인

```
C:\project\himart\watcher\watcher.log
```

실시간 로그 보기 (PowerShell):
```powershell
Get-Content C:\project\himart\watcher\watcher.log -Wait -Tail 30
```

---

## 8. 처리된 파일 목록 확인

```
C:\project\himart\watcher\processed_files.json
```

특정 파일을 다시 처리하고 싶으면 이 파일에서 해당 파일명을 삭제하면 됩니다.

---

## 9. 문제 해결

| 오류 메시지 | 원인 | 해결 방법 |
|---|---|---|
| `ModuleNotFoundError: No module named 'watchdog'` | 라이브러리 미설치 | `pip install watchdog pandas openpyxl gspread google-auth` |
| `서비스 계정 키 파일을 찾을 수 없습니다` | JSON 파일 경로 오류 | JSON 파일 경로 확인 |
| `gspread.exceptions.APIError: 403` | 스프레드시트 공유 안 됨 | 3-5단계에서 서비스 계정 이메일 공유 확인 |
| `KeyError: '신청번호'` | 엑셀 컬럼명 불일치 | 로그의 "엑셀 전체 컬럼" 줄 확인 후 `EXCEL_COLUMNS_TO_READ` 수정 |
| 파일이 감지 안 됨 | 파일명 패턴 불일치 | 실제 파일명과 `FILE_PATTERN` 정규식 비교 |
