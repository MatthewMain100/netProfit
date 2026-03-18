# Net Profit 2.0

Платформа финансового учета и аналитики:
- двойная запись (ledger),
- event log + audit,
- CQRS read-model,
- Finance Center,
- Report Builder,
- Operations 2.0,
- Period Close Wizard,
- Planning/What-if,
- Data Quality,
- ABAC/RLS,
- Attachments,
- UI prefs и режимы Director/Accountant.

## Быстрый старт (локально, без Docker)

1. Убедитесь, что запущены:
- PostgreSQL на `localhost:5433`
- Redis на `localhost:6379`

2. Backend:
```powershell
cd d:\mattew\app\backend
npm install
npm run migrate
npm run seed:demo
npm run rebuild
```

3. Запуск всего стенда:
```powershell
cd d:\mattew\app
.\run.ps1
```

Откроется:
- Frontend: `http://localhost:5173`
- API health: `http://localhost:4000/health`

## Docker (опционально)
```powershell
cd d:\mattew\app
docker compose up -d
```

Контейнеры поднимают:
- Postgres `5433`
- Redis `6379`

## Скрипты backend

```powershell
npm run dev            # API (watch)
npm run worker         # очереди (imports/reports/quality/projections)
npm run rebuild        # rebuild projections from domain_events
npm run seed:demo      # demo events seed
npm run migrate        # apply SQL migrations
npm run migrate:status # migrations status
```

## Ключевые API 2.0

- `GET /dashboard/finance-center`
- `POST /reports/run`
- `GET/POST/PATCH/DELETE /reports/templates`
- `GET /operations/v2`
- `GET/POST/PATCH/DELETE /operations/views`
- `POST /periods/:id/precheck`
- `GET /periods/:id/protocol?format=html|pdf`
- `POST /scenarios/run`
- `POST /scenarios/:id/apply`
- `GET /quality/issues`
- `POST /quality/recalculate`
- `POST /imports/preview`
- `POST /imports/start`
- `GET /imports/:id/status`
- `GET /imports/:id/report`
- `GET/POST/PATCH/DELETE /access/policies`
- `POST /access/test-user`
- `POST /attachments/upload`
- `GET /operations/:id/attachments`
- `GET /attachments/:id/sign`
- `GET /attachments/:id/download`
- `DELETE /attachments/:id`
- `GET /ui/prefs`
- `PATCH /ui/prefs`
- `GET /feature-flags`
- `PATCH /feature-flags/:key` (admin)

## Feature flags

Флаги хранятся в `feature_flags`.
Основные ключи:
- `finance_center`
- `report_builder`
- `ops_v2`
- `period_wizard`
- `planning`
- `quality`
- `import_v2`
- `abac_rls`
- `attachments`
- `director_mode`

## Демо доступ
- `admin@local / admin123`

## Переменные окружения backend
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_REQUIRED`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `ATTACHMENTS_DIR`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
