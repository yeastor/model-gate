GOPATH:=$(shell go env GOPATH)

PHONY: install-dep
install-dep:
		@go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-grpc-gateway
		@go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2
		@go install google.golang.org/protobuf/cmd/protoc-gen-go
		@go install google.golang.org/grpc/cmd/protoc-gen-go-grpc
		@go install github.com/envoyproxy/protoc-gen-validate@latest
		@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

PHONY: lint
lint:
	golangci-lint run ./...


PHONY: injection
injection:
	wire gen ./internal/injection/wire.go


PHONY: gen-note-api
gen-note-api:
	mkdir -p pkg/note
	mkdir -p swagger/note
	protoc --proto_path api/note --proto_path api \
		--go_out=pkg/note --go_opt=paths=source_relative \
		--go-grpc_out=pkg/note --go-grpc_opt=paths=source_relative \
		--grpc-gateway_out=pkg/note --grpc-gateway_opt=paths=source_relative \
		--validate_out=paths=source_relative,lang=go:pkg/note \
		--openapiv2_out=./swagger/note \
		  api/note/note.proto
