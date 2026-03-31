@echo off
set PORT=4000
set DATABASE_URL=postgres://netprofit:1234567890@localhost:5433/netprofit
set REDIS_URL=redis://127.0.0.1:6379
set REDIS_REQUIRED=false
start "backend" cmd /k "cd /d %~dp0backend && npm run dev"
start "worker" cmd /k "cd /d %~dp0backend && npm run worker"
start "frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
