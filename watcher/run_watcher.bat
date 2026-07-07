@echo off
:: ============================================================
:: 하이마트 쿠폰 업로더 실행 배치 파일
:: 이 파일을 더블클릭하거나 시작프로그램에 등록하세요
:: ============================================================
chcp 65001 > nul

:: Python 경로 (설치 후 자동으로 PATH에 잡혀 있으면 그냥 python)
set PYTHON=python

:: 스크립트 경로
set SCRIPT=C:\project\himart\watcher\watcher.py

echo 하이마트 쿠폰 업로더를 시작합니다...
echo 로그: C:\project\himart\watcher\watcher.log
echo 종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.
echo.

%PYTHON% "%SCRIPT%"

:: 오류로 종료된 경우 5초 후 자동 재시작
echo.
echo 프로그램이 종료되었습니다. 5초 후 재시작...
timeout /t 5 /nobreak
goto :EOF
