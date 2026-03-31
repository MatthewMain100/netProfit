$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

$env:PORT = '4000'
$env:DATABASE_URL = 'postgres://netprofit:1234567890@localhost:5433/netprofit'
$env:REDIS_URL = 'redis://127.0.0.1:6379'
$env:REDIS_REQUIRED = 'false'

Start-Process -FilePath 'npm' -ArgumentList 'run dev' -WorkingDirectory $backend
Start-Sleep -Seconds 2
Start-Process -FilePath 'npm' -ArgumentList 'run worker' -WorkingDirectory $backend
Start-Sleep -Seconds 1
Start-Process -FilePath 'npm' -ArgumentList 'run dev' -WorkingDirectory $frontend

Write-Output 'Backend, worker and frontend started.'
Write-Output 'Frontend: http://localhost:5173'
Write-Output 'API: http://localhost:4000/health'
Write-Output 'Worker: queue consumer started'
