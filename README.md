# Net Profit 2.0

Платформа финансового учета и аналитики для расчета чистой прибыли предприятия.

## Состав репозитория

- `backend/` - серверная часть на Node.js: API, очереди, сценарии пересчета, миграции и сиды.
- `frontend/` - клиентская часть на React/Vite: страницы, модули аналитики и интерфейсы учетного контура.
- `database/` - SQL-снимки для восстановления демонстрационного и live-контура.
- `docs/` - регламенты по репозиторию, диаграммы проектирования и скриншоты интерфейса.

## Ключевые возможности

- двойная запись (`ledger`);
- журнал событий и аудит;
- Finance Center;
- Report Builder;
- Operations 2.0;
- Period Close Wizard;
- Planning / What-if;
- Data Quality;
- ABAC / RLS;
- Attachments;
- пользовательские настройки интерфейса.

## Структура кода

- `backend/src/` - сервер, worker, модули и инфраструктурные компоненты.
- `backend/scripts/` - миграции, сиды, пересчет проекций, smoke-проверки.
- `backend/db/` - миграции, базовая схема и наборы данных.
- `frontend/src/` - страницы, компоненты, API-обвязка и стили.
- `docs/diagrams/` - диаграммы для второй главы отчета.
- `docs/screenshots/` - скриншоты модулей системы.

## Быстрый старт

1. Убедиться, что доступны:
- PostgreSQL на `localhost:5433`
- Redis на `localhost:6379`

2. Подготовить backend:
```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run migrate
npm run seed:demo
npm run rebuild
```

3. Подготовить frontend:
```powershell
cd frontend
npm install
```

4. Запустить весь стенд из корня репозитория:
```powershell
.\run.ps1
```

Откроются:
- Frontend: `http://localhost:5173`
- API health: `http://localhost:4000/health`

## Docker

```powershell
docker compose up -d
```

Контейнеры поднимают:
- Postgres `5433`
- Redis `6379`

## Репозиторий и версионирование

- `main` - стабильный контур;
- `develop` - интеграционная ветка;
- `feature/*` - развитие функциональности;
- `fix/*` - исправления;
- `hotfix/*` - срочные правки стабильной версии.

Семантическая версия: `MAJOR.MINOR.PATCH`.
Текущий стабильный ориентир: `v2.0.2`.

Подробности:
- [ветвление](docs/repository/branching-model.md)
- [совместная работа](docs/repository/collaboration-model.md)
- [рабочая директория](docs/repository/working-directory.md)
- [модель версионности](docs/repository/versioning-model.md)

## Материалы для отчета

- диаграммы проектирования: [docs/diagrams/README.md](docs/diagrams/README.md)
- скриншоты интерфейса: [docs/screenshots/README.md](docs/screenshots/README.md)
- changelog: [CHANGELOG.md](CHANGELOG.md)
