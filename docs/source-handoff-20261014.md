# Передача исходников 14.10.2026

Ветка `codex/site-chat-integration-20261014` предназначена для анализа и ручного
объединения программистом. Push не является развёртыванием или юридической приёмкой.

## Связанные репозитории

- `mujlok/payload_cms`: сайт, сессия, оболочка, `/api/chat/*`, SQL-миграция.
- `yeastor/model-gate`: этот backend, проверка сессии/владельца и guided-runtime.
- `yeastor/model-front-chat`: Angular, кнопки уточнений, PDF и embedded UI.
- `yeastor/model-nginx`: маршрутизация API на основном домене.
- `yeastor/model-category-document-generator`: дополнительный шаблон/ссылка документа.

Основные ветки и серверы в рамках этой передачи не изменяются.

## База данных

Перед запуском обновлённого backend проверить существующую PostgreSQL-схему и
применить `docker/chat/postgres/002-unified-users.sql` из репозитория сайта после
резервного копирования. Она обеспечивает `chat.site_user`, `chat.chat.user_id`,
`updated_at`, индекс и внешний ключ. Не назначать старые диалоги пользователям по
совпадению числовых ID; legacy-таблицы оставлены отдельно.

Удаление диалога очищает ClickHouse и PostgreSQL. Это не распределённая атомарная
транзакция двух БД; не считать её таковой. SQL advisory lock не требует новой таблицы.

## Guided-runtime: код и данные отдельно

Код: `internal/pkg/guided/runtime.go`, HTTP: `internal/api/modelgate/guided_http.go`.
Таблица: `data/guided-runtime.json`, исключена из Git (больше лимита обычного GitHub
blob). Это подготовленные сценарии/ответы, не дамп пользовательской переписки и не
веса нейросети. Её передавать отдельным проверенным артефактом с SHA-256.

При запуске `main.go` читает файл по `APP_GUIDED_DATA_PATH`. В контейнере файл надо
монтировать read-only по выбранному пути: Dockerfile переносит в runtime только
бинарный файл, не JSON. `APP_GUIDED_STAGE_COLLECTION` задаёт Qdrant-коллекцию
навигационных профилей; её данные и embedding model также поставляются отдельно.
Если путь не задан, guided endpoint возвращает unavailable: текущий Angular UI
обращается к этому endpoint, поэтому для полного сценарного чата файл необходим.

Факты `true`, `false`, явный `null` и отсутствие ответа различаются. Qdrant помогает
выбрать ситуацию, но не подтверждает факты. State содержит версию пакета; устаревшие
или неизвестные состояния отклоняются. Состояние уточнений сейчас хранится в
localStorage браузера по `chat_id`, не в отдельной PostgreSQL-таблице. Поэтому на
другом устройстве сохраняется история, но ответы на уточнения могут потребовать
повторного ввода.

Сборщик текущего локального пакета: `export-guided-runtime.mjs` в workspace
`C:/Users/mujlo/Documents/Codex/2026-10-14/task`, с `category-runtime.mjs` и
`dps-local-pilot.mjs`. Он использует существующие next-question графы, исходные
варианты ответов/identity mappings и отдельные review-пакеты. Этот workspace и
его исходные данные не заменяются выдуманными значениями и не публикуются целиком
как часть backend Git. Для повторного экспорта требуется отдельный source bundle.

Нормы `/laws/...`, таблица сценариев и Qdrant-данные должны соответствовать версии
источников. Место хранения файлов (SATA/NVMe) не является частью контракта runtime.

## Проверки

`go build .` проверяет основной executable. Focused tests: API, cookie, repositories,
vector processor и guided. Тесты guided требуют отдельный JSON по указанному пути.
Live gRPC и PostgreSQL lock tests opt-in; при обычной проверке не включать их через
environment. `go test ./...` имеет старые проблемы с note/mocks, описанные в AGENTS.md.
