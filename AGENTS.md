# AGENTS.md

This file is for coding agents working in `model-gate`.

## Scope

- Applies to the entire repository.
- No existing root `AGENTS.md` was present when this file was created.
- No Cursor rules were found in `.cursor/rules/` or `.cursorrules`.
- No Copilot rules were found in `.github/copilot-instructions.md`.

## Repository overview

- Language: Go.
- Module path: `model-gate`.
- Declared Go version: `1.26` in `go.mod`.
- Entry point: `main.go`.
- Main directories:
    - `internal/api`: gRPC and HTTP transport handlers.
    - `internal/domain`: entities, repository interfaces, use case interfaces, converters, stubs.
    - `internal/usecase`: orchestration and business flow.
    - `internal/repository`: infrastructure adapters.
    - `internal/pkg`: internal reusable packages.
    - `internal/injection`: Google Wire dependency wiring.
    - `pkg`: generated protobuf/gateway code plus shared packages.
    - `swagger`: generated OpenAPI output.

## Repo caveats

- The repo still has stale template leftovers from an older "note" service.
- `README.md` is partly generic template documentation and is not fully reliable.
- `internal/domain/stub/note.go` references `entity.Note`, which no longer exists.
- `internal/usecase/modelgate/chat_test.go` references a missing `internal/domain/repository/mocks` package.
- Because of those leftovers, broad build and test commands currently fail before your changes are evaluated.
- Prefer validating the real application path first when you only need runtime confidence.

## Setup commands

- Install generators and linter tools: `make install-dep`
- Download modules: `go mod download`
- If `golangci-lint` reports it was built with an older Go version, reinstall it with a toolchain matching `go.mod`.

## Build commands

- Build the main service binary: `go build -o application .`
- Build every package: `go build ./...`
- Run without a build artifact: `go run .`
- Build the Docker image: `docker build -f build/Dockerfile . -t model-gate:local`
- Current status: `go build -o application .` succeeds.
- Current status: `go build ./...` fails because `internal/domain/stub/note.go` still references removed note entities.

## Lint and format commands

- Primary lint command: `make lint`
- Direct lint command: `golangci-lint run ./...`
- Format touched files: `gofmt -w path/to/file.go`
- Format the whole module: `go fmt ./...`
- Current status: `make lint` fails locally if `golangci-lint` was built with Go `1.23` while the module targets Go
  `1.26`.

## Test commands

- Run all tests: `go test ./...`
- Run one package: `go test ./internal/usecase/modelgate`
- Run one named test: `go test ./internal/usecase/modelgate -run '^TestService_Create_Positive$' -count=1`
- List tests in a package: `go test ./internal/usecase/modelgate -list .`
- Run verbose package tests: `go test -v ./internal/usecase/modelgate`
- Current status: the existing test package fails to set up because of stale note-template references and the missing
  mocks package.

## Code generation

- After edit `.proto` file, always run `go generate ./...`
- Regenerate protobuf, gateway, validation, swagger, and Wire outputs: `go generate ./...`
- Regenerate Wire only: `make injection`
- `make gen-note-api` is legacy template scaffolding; do not use it unless you are intentionally reviving the old note
  API.

## Generated files

- Treat these as generated outputs, not hand-edited source:
    - `pkg/modelgate/*.pb.go`
    - `pkg/modelgate/*.pb.gw.go`
    - `pkg/modelgate/*validate.go`
    - `pkg/modelgate/*grpc.pb.go`
    - `pkg/healthcheck/pb/*.go`
    - `internal/injection/wire_gen.go`
    - `swagger/**/*.json`
- Edit source inputs such as `api/**/*.proto` and `internal/injection/wire.go`, then regenerate.

## Code style guidelines

- Use `gofmt`; do not hand-format around it.
- Keep packages lowercase and short.
- Follow existing package names like `config`, `clickhouse`, `embedding`, and `processor`.
- Use `PascalCase` for exported types, functions, and methods.
- Use `camelCase` for unexported names.
- Keep common acronyms uppercase in exported identifiers: `API`, `HTTP`, `GRPC`, `UUID`, `ID`.
- Constructors are consistently named `NewX(...)`.
- Factories are named `Factory` and commonly expose `GetProcessor` or `GetModelProcessor` methods.
- Small behavior interfaces are preferred over large catch-all interfaces.
- When a concrete type is intended to satisfy an interface, add `var _ Interface = (*Impl)(nil)`.
- Pass `context.Context` as the first parameter for request-scoped work.
- Do not store `context.Context` inside structs; `containedctx` is enabled.
- Keep transport code in `internal/api`, domain contracts in `internal/domain`, orchestration in `internal/usecase`, and
  external IO in `internal/repository` or package adapters.
- Keep dependency assembly in `internal/injection`; do not rebuild deep dependency graphs inside handlers.
- Prefer explicit option interfaces for config-backed dependencies.
- Prefer early returns for validation failures and error branches.
- Wrap errors with `fmt.Errorf("...: %w", err)` when you add context.
- Use `errors.Is` or `errors.As` for wrapped error checks.
- Sentinel errors should use `ErrXxx` naming.
- Error strings should be lowercase and should not end with punctuation.
- Outside startup code, return errors instead of calling `panic` or `log.Fatal`.
- `main.go` currently uses `panic` and `log.Fatal` during startup; treat that as startup-only behavior, not
  package-level guidance.
- Check returned errors from `Close`, `Scan`, HTTP calls, SQL operations, and type assertions.
- Avoid `init` functions; `gochecknoinits` is enabled.
- Avoid package-level globals where practical; `gochecknoglobals` is enabled.
- Avoid naked returns.
- Avoid ambiguous `nil, nil` returns.
- Prefer named constants over magic numbers; `mnd` is enabled.
- Keep line lengths reasonable; `lll` is enabled.
- If you add `nolint`, make it specific and explain why; `nolintlint` enforces both.
- Comments are sparse; add them only when code would otherwise be non-obvious.
- If you add doc comments, end them with a period because `godot` is enabled.
- Keep imports ordered cleanly; `decorder` is enabled.
- Use import aliases only when they clarify collisions or meaning, e.g. `desc`, `dcHttp`, `processorvector`.
- Prefer standard library types unless an external API requires something else.
- Use pointers for shared mutable state or optional objects; return plain values for small immutable data when that
  keeps code simpler.
- In tests, use the standard `testing` package and `stretchr/testify/assert`, matching existing usage.

## Additional repo conventions

- Configuration is loaded through `caarlos0/env` with nested structs and `envPrefix` tags in `config/config.go`.
- Logging is centered on `log/slog`; prefer structured log fields over string concatenation when touching existing
  logging code.
- UUID handling uses `github.com/google/uuid`; keep `UUID` and `ID` capitalization consistent.
- Repositories typically accept domain entities and return wrapped infrastructure errors.
- Use the existing package boundaries before adding new top-level packages.
- Generated gRPC and gateway types live under `pkg/modelgate` and `pkg/healthcheck/pb`; keep transport adapters thin
  around them.
- Some comments and identifiers still reference `note`; treat those as leftovers unless your task is explicitly to
  remove them.
- Prefer validating the main service path with `go build -o application .` when broad package checks are blocked by
  stale files.
- If you add new tests, keep them focused and runnable with `go test ./path/to/pkg -run '^TestName$' -count=1`.
- Keep new code ASCII unless an existing file already requires another character set.

## Editing guidance

- Read surrounding files before editing; some areas still contain stale note-template code.
- Do not "clean up" unrelated template leftovers unless your task requires it.
- Do not hand-edit generated protobuf, gateway, swagger, or Wire output.
- If you change proto files or dependency wiring, regenerate outputs before finishing.
- Avoid reading `.env`; `opencode.json` explicitly denies that path.
- Prefer minimal, surgical changes that match existing boundaries and naming.
