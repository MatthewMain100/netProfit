# Net Profit 2.0

Репозиторий проекта информационной системы расчета чистой прибыли для ООО "ЛогоСтекло".

## Состав репозитория

- `backend/` - серверные скрипты, миграции, схема БД и демо-наполнение.
- `frontend/` - контур клиентской части и материалы по интерфейсу.
- `database/` - восстановительные SQL-снимки и выгрузки для демонстрационного контура.
- `docs/` - проектная документация, модель ветвления и скриншоты интерфейса.

## Рабочая директория

Текущая структура отражает модульный принцип организации проекта:

- `backend/db/migrations/` - миграции схемы.
- `backend/db/schema/` - базовая схема БД.
- `backend/db/seeds/` - стартовые и тестовые данные.
- `database/restores/` - SQL-снимки для восстановления демонстрационной среды.
- `docs/screenshots/` - зафиксированные состояния пользовательского интерфейса.
- `docs/repository/` - регламент по ветвлению, совместной работе и версионности.

## Модули платформы

- Finance Center
- Report Builder
- Operations 2.0
- Period Close Wizard
- Planning / What-if
- Data Quality
- Import
- Catalogs
- Audit
- Users
- Access Control

## Модель ветвления

В репозитории используется следующая схема:

- `main` - стабильный контур.
- `develop` - интеграционная ветка.
- `feature/*` - развитие функциональности.
- `fix/*` - исправления и выравнивание документации.
- `hotfix/*` - срочные корректировки стабильного контура.

Подробности вынесены в [docs/repository/branching-model.md](docs/repository/branching-model.md).

## Совместная работа

Правила сопровождения репозитория и проверки изменений описаны в
[docs/repository/collaboration-model.md](docs/repository/collaboration-model.md).

## Версионность

Для проекта используется схема `MAJOR.MINOR.PATCH`.
Описание зафиксировано в [docs/repository/versioning-model.md](docs/repository/versioning-model.md).

## Регламент рабочей директории

Назначение каталогов и правила размещения артефактов описаны в
[docs/repository/working-directory.md](docs/repository/working-directory.md).

## Запуск служебных сценариев

Корневые сценарии `run.ps1` и `run.cmd` используются для подготовки локального контура и проверки состава рабочих каталогов. Серверные SQL- и seed-сценарии находятся в каталоге `backend/`.

## Визуальные материалы

Скриншоты интерфейса собраны в каталоге `docs/screenshots/` и покрывают ключевые модули демонстрационного контура:

- `00_login.png`
- `01_home.png`
- `02_finance-center.png`
- `05_operations-v2.png`
- `06_report-builder.png`
- `07_period-wizard.png`
- `08_planning.png`
- `09_quality.png`
- `10_import.png`
- `15_access-control.png`

Полный индекс экранов доступен в [docs/screenshots/README.md](docs/screenshots/README.md).
