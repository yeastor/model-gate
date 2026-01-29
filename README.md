# MSA Template

Шаблонная структура для go микросервиса.

## Установка

### 1. Копирование проекта.

a. Используя утилиту [gonew](https://go.dev/blog/gonew)

Перейти в директорию с проектами, выполнить команды (model-gate - заменить на название своего проекта):

```bash
  go install golang.org/x/tools/cmd/gonew@latest
  gonew gitlab.direct-credit.ru/go/msa-template direct-credit.ru/model-gate
```

b. Просто клонировать проект

```bash
    git clone https://gitlab.direct-credit.ru/dc/golang/msa-template.git
```

2. Проверям, что все работает, для этого из папки проекта
   Выполнить:

```bash
go generate
```

Должны собраться wire_gen и pbшки и swagger

3. Переименовать internal/server/dto/model-gate.proto
4. Пойти в main.go в инструкциях go:generate переименовать model-gate.proto
5. Поискать вхождение: model-gate и MyBestService my_best_service
   заменить на своё

6. Удалить internal/pkg/dbconn/dbconn.go если не используется

## Сборка и запуск

Из корня проекта

```bash
docker build -f build/Dockerfile . -t model-gate:1.0 --build-arg APP_NAME="model-gate" --build-arg CI_JOB_USER=ykupriyanov --build-arg CI_JOB_TOKEN=[your gitlab token]
```

```bash
docker run --rm -d --name model-gate \
-e LOG_LEVEL=info \
-e GRPC_PORT=8073 \
-e HTTP_PORT=8074 \
-e ENV_APP=dev \
-p8074:8074
model-gate:1.0 ./ model-gate serve
```

Проверка

Note create

```bash
curl --location 'http://127.0.0.1:8074/note/create' \
--header 'X-Request-Id: someRequestId' \
--header 'Content-Type: application/json' \
--data '{
  "title": "Новая заметка",
  "body": "Текст новой заметки с описанием"
}'
```

Note get

```bash
curl --location --request GET 'http://127.0.0.1:8074/note/get-by-uuid/1564bf25-57ef-4b22-be2c-9ebe051919fc' \
--header 'X-Request-Id: someRequestId' \
--header 'Content-Type: application/json' \
--data '{
  "title": "Новая заметка",
  "body": "Текст новой заметки с описанием"
}'
```

Health check

```
http://127.0.0.1:8074/healthz/l
```

### Linter

#### Windows

```shell
powershell -command "docker run --rm -v$(pwd):/app -w /app golangci/golangci-lint:v1.61.0-alpine golangci-lint run"
```

#### Linux

```shell
docker run --rm -v$(pwd):/app -w /app golangci/golangci-lint:latest golangci-lint run
```

### WRK

Смотри доку на https://wiki.mvideo.ru/display/FNTH/wrk

Запуск локально

#### Linux

create

```shell
docker run --rm -v $(pwd):/data skandyla/wrk -s wrk/note-create.lua -t5 -c10 -d30  http://127.0.0.1:8074/note/create
```

get

```shell
docker run --rm -v$(pwd):/data skandyla/wrk -s wrk/note-get.lua -t5 -c10 -d30  http://127.0.0.1:8074/note/get-by-uuid/1564bf25-57ef-4b22-be2c-9ebe051919fc
```

#### Windows

create

```shell
powershell -command "docker run --rm -v$(pwd):/data skandyla/wrk -s wrk/note-create.lua -t5 -c10 -d30  http://host.docker.internal:8074/note/create"
```

get

```shell
powershell -command "docker run --rm -v$(pwd):/data skandyla/wrk -s wrk/note-get.lua -t5 -c10 -d30  http://host.docker.internal:8074/note/get-by-uuid/5de45028-d575-4111-81e7-898e6ea79da6"
```

## Debug in docker

1. Изменить`CI_JOB_USER` an `CI_JOB_TOKEN` в Docker debug.run
2. Нажать "play" напротив `Docker debug`. Дождаться успешного старта.
3. Нажать жука напротив `Start docker debug`.

В случае проблем, см.
доку https://blog.jetbrains.com/go/2020/05/06/debugging-a-go-application-inside-a-docker-container/