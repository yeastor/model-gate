package modelgate

import (
	"bytes"
	"context"
	"errors"
	"model-gate/internal/pkg/chatcrypto"
	"model-gate/internal/repository/postgres"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"

	ch "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func verifyChatDatabaseRestore(t *testing.T, ctx context.Context, dsn string, conn ch.Conn, gateKeyFile string,
	chatID uuid.UUID, question, answer, title string,
) {
	t.Helper()
	pgID, chID := os.Getenv("GA_E2E_PG_CONTAINER"), os.Getenv("GA_E2E_CH_CONTAINER")
	if pgID == "" && chID == "" {
		return
	}
	idPattern := regexp.MustCompile(`^[a-f0-9]{64}$`)
	for _, id := range []string{pgID, chID} {
		if !idPattern.MatchString(id) {
			t.Fatal("isolated backup container ID required")
		}
		label, err := exec.CommandContext(ctx, "docker", "inspect", "--format", `{{index .Config.Labels "aiz.test"}}`, id).Output()
		if err != nil || strings.TrimSpace(string(label)) != "chat-encryption" {
			t.Fatal("backup fixture not isolated", err)
		}
	}

	docker := func(input []byte, args ...string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Stdin = bytes.NewReader(input)
		raw, err := cmd.Output()
		if err != nil {
			t.Fatalf("disposable logical backup command failed (%s): %v", args[0], err)
		}
		return raw
	}
	dump := docker(nil, "exec", pgID, "pg_dump", "-U", "ga_test", "-d", "ga_test", "-n", "chat", "--no-owner", "--no-privileges")
	if !bytes.Contains(dump, []byte("azchat:v1:")) || bytes.Contains(dump, []byte(title)) {
		t.Fatal("plaintext in PostgreSQL dump or missing encrypted data")
	}
	docker(nil, "exec", pgID, "createdb", "-U", "ga_test", "ga_restore")
	docker(dump, "exec", "-i", pgID, "psql", "-U", "ga_test", "-d", "ga_restore", "-v", "ON_ERROR_STOP=1")
	restoreDSN := strings.Replace(dsn, "/ga_test?", "/ga_restore?", 1)
	restore, err := pgxpool.New(ctx, restoreDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.Close()
	keys, err := chatcrypto.Load(gateKeyFile)
	if err != nil {
		t.Fatal(err)
	}
	const owner = 19
	if chat, err := postgres.NewRepository(restore, keys).GetChatForOwner(ctx, chatID, owner); err != nil || chat.Name != title {
		t.Fatal("restored PostgreSQL title unavailable with correct key", err)
	}
	if _, err := postgres.NewRepository(restore, nil).GetChatForOwner(ctx, chatID, owner); !errors.Is(err, chatcrypto.ErrKeyFile) {
		t.Fatal("restored PostgreSQL title readable without key", err)
	}

	clickhouse := func(input []byte, query string) []byte {
		return docker(input, "exec", "-i", chID, "clickhouse-client", "--user", "ga_test", "--password", "ga-isolated-test-only", "--query", query)
	}
	clickhouse(nil, "CREATE DATABASE chat_restore")
	clickhouse(nil, "CREATE TABLE chat_restore.message AS chat.message")
	native := clickhouse(nil, "SELECT * FROM chat.message FORMAT Native")
	if !bytes.Contains(native, []byte("azchat:v1:")) || bytes.Contains(native, []byte(question)) || bytes.Contains(native, []byte(answer)) {
		t.Fatal("plaintext in ClickHouse logical backup or missing encrypted data")
	}
	clickhouse(native, "INSERT INTO chat_restore.message FORMAT Native")
	var messageID uuid.UUID
	var storedQuestion, storedAnswer string
	if err := conn.QueryRow(ctx, "SELECT id,question,answer FROM chat_restore.message WHERE chat_id=?", chatID).Scan(&messageID, &storedQuestion, &storedAnswer); err != nil {
		t.Fatal(err)
	}
	binding := "/" + chatID.String() + "/" + messageID.String()
	for _, item := range []struct{ field, stored, want string }{
		{"question", storedQuestion, question}, {"answer", storedAnswer, answer},
	} {
		plain, err := keys.Open("clickhouse/message/"+item.field+binding, item.stored)
		if err != nil || plain != item.want {
			t.Fatal("restored ClickHouse content unavailable with correct key", err)
		}
	}
	t.Log("PostgreSQL dump and ClickHouse Native export contain encrypted data; isolated restore succeeds with separately loaded key")
}
