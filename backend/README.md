# Backend

Серверный контур проекта на Node.js.

## Состав

- `src/server.js` - HTTP API.
- `src/worker.js` - обработчик фоновых очередей.
- `src/modules/` - прикладные модули платформы.
- `src/infra/` - инфраструктурные компоненты, очереди, флаги и ABAC.
- `src/engine/` - движки расчетов и контроля качества.
- `scripts/` - миграции, пересчет проекций, сиды и служебные сценарии.
- `db/` - миграции, схема и наборы данных.

## Основные команды

```powershell
npm install
Copy-Item .env.example .env
npm run migrate
npm run seed:demo
npm run rebuild
npm run dev
```

## Переменные окружения

См. [`.env.example`](.env.example).
