#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
하이마트 쿠폰 신청관리 엑셀 → 구글 시트 자동 업로더
============================================================
파일명 패턴: 하이마트_쿠폰_신청관리_리스트YYYYMMDD_HHMMSS.xlsx

동작 순서:
  1. 다운로드 폴더를 watchdog으로 감시
  2. 위 패턴의 .xlsx 파일이 생성되면 감지
  3. 파일 다운로드 완료(크기 안정화) 확인 후 파싱
  4. 개인정보 컬럼 제외하고 지정 컬럼만 추출
  5. 구글 시트 '신청관리_원본데이터' 탭을 전체 교체
  6. 처리 완료 알림(Windows 토스트 + 콘솔 로그)
  7. 중복 처리 방지를 위해 처리된 파일명 기록
============================================================
"""

import os
import re
import json
import time
import logging
import subprocess
from datetime import datetime
from pathlib import Path

import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ============================================================
# ★ 설정값 — 이 부분만 수정하세요 ★
# ============================================================

# 감시할 다운로드 폴더 경로
WATCH_FOLDER = r"C:\Users\proptier\Downloads"

# 구글 서비스 계정 JSON 키 파일 경로
# (구글 클라우드 콘솔에서 발급한 키 파일을 이 경로에 놓으세요)
SERVICE_ACCOUNT_KEY = r"C:\project\himart\watcher\service_account_key.json"

# 구글 스프레드시트 ID (URL의 /d/ 뒤 부분)
SPREADSHEET_ID = "1DqtrYVJBveCYvV9b_3y2SZRe2A6LGGpWujfhbHJFWdY"

# 업로드 대상 시트(탭) 이름
SHEET_NAME = "신청관리_원본데이터"

# 처리된 파일명을 기록하는 JSON 파일 경로 (자동 생성됨)
PROCESSED_FILES_DB = r"C:\project\himart\watcher\processed_files.json"

# 로그 파일 경로
LOG_FILE = r"C:\project\himart\watcher\watcher.log"

# 파일명 패턴 (정규식)
# 예: 하이마트_쿠폰_신청관리_리스트20260707_083012.xlsx
FILE_PATTERN = re.compile(
    r"^하이마트_쿠폰_신청관리_리스트\d{8}_\d{6}\.xlsx$"
)

# 파일 크기 안정화 확인 설정
STABILITY_CHECK_INTERVAL = 2   # 초 단위로 크기 비교 간격
STABILITY_CHECK_ATTEMPTS  = 5  # 최대 시도 횟수 (합계 최대 10초 대기)

# ============================================================
# 엑셀 컬럼 설정
# ============================================================

# 엑셀에서 읽을 컬럼명 (실제 엑셀 헤더명과 일치해야 함)
EXCEL_COLUMNS_TO_READ = [
    "신청번호",
    "회원번호",
    "중개업소명",
    "대표자명",
    "중개업소 소재지",   # 엑셀에서는 공백 있음
    "신청구분",
    "신청경로",
    "신청일시",
    "최근발송일시",
]

# 구글 시트에 저장할 헤더명 (엑셀 컬럼 → 시트 컬럼 매핑)
# 순서도 이 순서로 업로드됨
COLUMN_MAPPING = {
    "신청번호":       "신청번호",
    "회원번호":       "회원번호",
    "중개업소명":     "중개업소명",
    "대표자명":       "대표자명",
    "중개업소 소재지": "중개업소소재지",   # 시트에서는 공백 없음
    "신청구분":       "신청구분",
    "신청경로":       "신청경로",
    "신청일시":       "신청일시",
    "최근발송일시":   "최근발송일시",
}

# 시트 헤더 행 (업로드 시 1행으로 사용)
SHEET_HEADERS = list(COLUMN_MAPPING.values()) + ["_내부_업데이트일시"]

# ============================================================
# 로깅 설정
# ============================================================

def setup_logging():
    """로그 파일과 콘솔에 동시에 출력하도록 로거 설정"""
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

    logger = logging.getLogger("himart_watcher")
    logger.setLevel(logging.DEBUG)

    # 포맷: 날짜시각 [레벨] 메시지
    fmt = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # 파일 핸들러 (UTF-8, 매일 롤오버 대신 단순 append)
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    # 콘솔 핸들러
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


logger = setup_logging()

# ============================================================
# 처리된 파일 기록 관리
# ============================================================

def load_processed_files() -> set:
    """이미 처리한 파일명 목록을 JSON에서 불러옴"""
    if not os.path.exists(PROCESSED_FILES_DB):
        return set()
    try:
        with open(PROCESSED_FILES_DB, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except Exception as e:
        logger.warning(f"처리 기록 파일 읽기 실패 (초기화): {e}")
        return set()


def save_processed_file(filename: str):
    """처리 완료한 파일명을 JSON에 추가 저장"""
    processed = load_processed_files()
    processed.add(filename)
    os.makedirs(os.path.dirname(PROCESSED_FILES_DB), exist_ok=True)
    with open(PROCESSED_FILES_DB, "w", encoding="utf-8") as f:
        json.dump(sorted(processed), f, ensure_ascii=False, indent=2)


# ============================================================
# 파일 완전 다운로드 확인 (크기 안정화)
# ============================================================

def wait_for_file_stable(filepath: str) -> bool:
    """
    파일 크기가 일정 시간 동안 변하지 않으면 다운로드 완료로 판단.
    True 반환 시 처리 시작, False 반환 시 건너뜀.
    """
    logger.info(f"파일 안정화 대기 중: {os.path.basename(filepath)}")
    prev_size = -1
    stable_count = 0

    for attempt in range(STABILITY_CHECK_ATTEMPTS):
        time.sleep(STABILITY_CHECK_INTERVAL)
        try:
            curr_size = os.path.getsize(filepath)
        except FileNotFoundError:
            logger.warning("파일 안정화 확인 중 파일이 사라짐")
            return False

        if curr_size == prev_size and curr_size > 0:
            stable_count += 1
            if stable_count >= 2:   # 연속 2회 동일하면 안정
                logger.info(f"파일 안정화 완료 ({curr_size:,} bytes)")
                return True
        else:
            stable_count = 0
        prev_size = curr_size
        logger.debug(f"안정화 확인 {attempt+1}/{STABILITY_CHECK_ATTEMPTS}: {curr_size:,} bytes")

    logger.warning("파일 안정화 확인 타임아웃 — 그래도 처리 시도")
    return True


# ============================================================
# 엑셀 파싱 및 컬럼 추출
# ============================================================

def parse_excel(filepath: str) -> list[list]:
    """
    엑셀 파일을 읽고 지정 컬럼만 추출하여 행 리스트로 반환.
    날짜/시각은 문자열로 변환.
    개인정보 컬럼은 포함하지 않음.
    """
    logger.info(f"엑셀 파일 파싱 시작: {os.path.basename(filepath)}")

    # 헤더 행 자동 감지 (0-indexed, 기본 0행)
    df_raw = pd.read_excel(filepath, header=0, dtype=str, engine="openpyxl")

    logger.debug(f"엑셀 전체 컬럼: {df_raw.columns.tolist()}")
    logger.info(f"엑셀 전체 행 수: {len(df_raw)}")

    # 실제 존재하는 컬럼만 선택 (없는 컬럼은 경고 후 빈 문자열로 대체)
    available = df_raw.columns.tolist()
    missing = [c for c in EXCEL_COLUMNS_TO_READ if c not in available]
    if missing:
        logger.warning(f"엑셀에 없는 컬럼 (빈값으로 대체): {missing}")

    # 존재하는 컬럼만 추출 + 없는 컬럼은 빈 열 추가
    df = pd.DataFrame()
    for col in EXCEL_COLUMNS_TO_READ:
        if col in df_raw.columns:
            df[col] = df_raw[col]
        else:
            df[col] = ""

    # NaN → 빈 문자열 변환
    df = df.fillna("")

    # 컬럼명 변환 (엑셀 → 시트 헤더명)
    df = df.rename(columns=COLUMN_MAPPING)

    # 업로드 시각 컬럼 추가
    upload_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    df["_내부_업데이트일시"] = upload_time

    # 빈 행 제거 (신청번호가 비어있는 행)
    df = df[df["신청번호"].str.strip() != ""]
    df = df.reset_index(drop=True)

    logger.info(f"필터링 후 유효 행 수: {len(df)}")

    # 리스트-오브-리스트 형태로 변환 (gspread 업로드용)
    rows = df.values.tolist()

    # 모든 값을 문자열로 보장 (숫자/날짜 타입 혼입 방지)
    rows = [[str(v).strip() if v else "" for v in row] for row in rows]

    return rows


# ============================================================
# 구글 시트 인증 및 업로드
# ============================================================

def get_gspread_client():
    """서비스 계정 JSON 키로 gspread 클라이언트 생성"""
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_KEY, scopes=scopes
    )
    return gspread.authorize(creds)


def upload_to_sheets(rows: list[list]) -> int:
    """
    구글 시트 '신청관리_원본데이터' 탭을 전체 교체.
    전략: 헤더 행 유지 → 데이터 영역 전체 삭제 → 새 데이터 일괄 삽입
    반환: 업로드된 행 수
    """
    logger.info("구글 시트 접속 중…")
    client = get_gspread_client()
    ss = client.open_by_key(SPREADSHEET_ID)
    ws = ss.worksheet(SHEET_NAME)

    # 1. 현재 시트 크기 확인
    existing = ws.get_all_values()
    existing_row_count = len(existing)

    # 2. 헤더 행 확인/업데이트
    current_header = existing[0] if existing else []
    if current_header != SHEET_HEADERS:
        logger.info(f"헤더 행 업데이트: {SHEET_HEADERS}")
        ws.update("A1", [SHEET_HEADERS])
    else:
        logger.debug("헤더 행 일치 — 그대로 유지")

    # 3. 기존 데이터 행 삭제 (헤더 이후 전체 클리어)
    if existing_row_count > 1:
        clear_range = f"A2:{chr(64 + len(SHEET_HEADERS))}{max(existing_row_count, 2)}"
        ws.batch_clear([clear_range])
        logger.info(f"기존 데이터 {existing_row_count - 1}행 삭제 완료")

    # 4. 새 데이터 일괄 업로드
    if rows:
        ws.update("A2", rows, value_input_option="USER_ENTERED")
        logger.info(f"구글 시트 업로드 완료: {len(rows)}행")
    else:
        logger.warning("업로드할 데이터가 없습니다.")

    return len(rows)


# ============================================================
# Windows 데스크톱 알림
# ============================================================

def show_windows_notification(title: str, message: str):
    """
    PowerShell을 이용해 Windows 토스트 알림 표시.
    실패해도 예외를 던지지 않고 로그만 남김.
    """
    try:
        ps_script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$n = New-Object System.Windows.Forms.NotifyIcon; "
            "$n.Icon = [System.Drawing.SystemIcons]::Information; "
            "$n.Visible = $true; "
            f"$n.ShowBalloonTip(6000, '{title}', '{message}', "
            "[System.Windows.Forms.ToolTipIcon]::Info); "
            "Start-Sleep -Seconds 7; "
            "$n.Dispose()"
        )
        subprocess.Popen(
            ["powershell", "-WindowStyle", "Hidden", "-Command", ps_script],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as e:
        logger.debug(f"토스트 알림 실패 (무시): {e}")


# ============================================================
# 파일 처리 메인 로직
# ============================================================

def process_file(filepath: str):
    """
    엑셀 파일 1개를 파싱하고 구글 시트에 업로드하는 전체 흐름.
    에러가 나도 예외를 상위로 전파하지 않고 로그에 기록.
    """
    filename = os.path.basename(filepath)
    logger.info(f"{'='*50}")
    logger.info(f"처리 시작: {filename}")

    # 이미 처리한 파일인지 확인
    processed = load_processed_files()
    if filename in processed:
        logger.info(f"이미 처리된 파일 — 건너뜀: {filename}")
        return

    try:
        # 1. 파일 완전 다운로드 대기
        if not wait_for_file_stable(filepath):
            logger.error("파일 안정화 실패 — 처리 중단")
            return

        # 2. 엑셀 파싱
        rows = parse_excel(filepath)
        if not rows:
            logger.warning("파싱 결과 데이터 없음 — 업로드 건너뜀")
            save_processed_file(filename)
            return

        # 3. 구글 시트 업로드
        uploaded_count = upload_to_sheets(rows)

        # 4. 처리 완료 기록
        save_processed_file(filename)

        # 5. 알림
        msg = f"{uploaded_count:,}건 업로드 완료"
        logger.info(f"✅ {msg} — {filename}")
        show_windows_notification("하이마트 시트 업로드 완료", msg)

    except FileNotFoundError as e:
        logger.error(f"파일 없음: {e}")
    except gspread.exceptions.APIError as e:
        logger.error(f"구글 시트 API 오류: {e}")
    except Exception as e:
        logger.exception(f"예상치 못한 오류 발생: {e}")

    logger.info(f"처리 종료: {filename}")
    logger.info(f"{'='*50}")


# ============================================================
# Watchdog 이벤트 핸들러
# ============================================================

class ExcelFileHandler(FileSystemEventHandler):
    """다운로드 폴더에서 파일 생성/이동 이벤트 처리"""

    def _is_target_file(self, path: str) -> bool:
        """파일명이 감시 패턴에 맞는지 확인"""
        return FILE_PATTERN.match(os.path.basename(path)) is not None

    def on_created(self, event):
        """새 파일이 생성되었을 때"""
        if not event.is_directory and self._is_target_file(event.src_path):
            logger.info(f"새 파일 감지 (created): {event.src_path}")
            process_file(event.src_path)

    def on_moved(self, event):
        """
        파일이 이동(rename)되었을 때 — 브라우저가 임시 파일명으로
        저장 후 최종 파일명으로 rename하는 경우 처리
        """
        if not event.is_directory and self._is_target_file(event.dest_path):
            logger.info(f"새 파일 감지 (moved): {event.dest_path}")
            process_file(event.dest_path)


# ============================================================
# 시작 시 기존 미처리 파일 스캔
# ============================================================

def scan_existing_files():
    """
    프로그램 시작 시 다운로드 폴더를 스캔하여
    아직 처리하지 않은 대상 파일이 있으면 즉시 처리.
    """
    logger.info("기존 파일 스캔 중…")
    processed = load_processed_files()
    found = 0

    for fname in sorted(os.listdir(WATCH_FOLDER)):
        if FILE_PATTERN.match(fname) and fname not in processed:
            fpath = os.path.join(WATCH_FOLDER, fname)
            logger.info(f"미처리 파일 발견: {fname}")
            process_file(fpath)
            found += 1

    if found == 0:
        logger.info("처리할 기존 파일 없음")


# ============================================================
# 메인 실행
# ============================================================

def main():
    logger.info("=" * 60)
    logger.info("하이마트 쿠폰 신청관리 업로더 시작")
    logger.info(f"감시 폴더: {WATCH_FOLDER}")
    logger.info(f"스프레드시트 ID: {SPREADSHEET_ID}")
    logger.info("=" * 60)

    # 서비스 계정 키 파일 존재 확인
    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        logger.error(
            f"서비스 계정 키 파일을 찾을 수 없습니다: {SERVICE_ACCOUNT_KEY}\n"
            "setup_guide.md를 참고하여 키 파일을 준비해주세요."
        )
        return

    # 감시 폴더 존재 확인
    if not os.path.exists(WATCH_FOLDER):
        logger.error(f"감시 폴더가 없습니다: {WATCH_FOLDER}")
        return

    # 시작 시 기존 미처리 파일 처리
    scan_existing_files()

    # watchdog 옵저버 시작
    event_handler = ExcelFileHandler()
    observer = Observer()
    observer.schedule(event_handler, WATCH_FOLDER, recursive=False)
    observer.start()
    logger.info(f"파일 감시 시작 — 새 파일 대기 중...")

    try:
        while True:
            time.sleep(5)
            if not observer.is_alive():
                logger.error("Observer가 종료됨 — 재시작 시도")
                observer.start()
    except KeyboardInterrupt:
        logger.info("사용자 중단 요청 (Ctrl+C)")
    finally:
        observer.stop()
        observer.join()
        logger.info("하이마트 쿠폰 업로더 종료")


if __name__ == "__main__":
    main()
