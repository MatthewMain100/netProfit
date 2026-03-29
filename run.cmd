@echo off
setlocal
echo Repository layout check:
echo backend  = %~dp0backend
echo frontend = %~dp0frontend
echo database = %~dp0database
echo docs     = %~dp0docs
if not exist "%~dp0backend" (
  echo Missing required directory: backend
  exit /b 1
)
if not exist "%~dp0frontend" (
  echo Missing required directory: frontend
  exit /b 1
)
if not exist "%~dp0database" (
  echo Missing required directory: database
  exit /b 1
)
if not exist "%~dp0docs" (
  echo Missing required directory: docs
  exit /b 1
)
echo.
echo This repository snapshot stores the repository layout, SQL artifacts and interface materials.
echo Use backend\migrate.js and backend\seed_demo_events.js to prepare the local database contour.
