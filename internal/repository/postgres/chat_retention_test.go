package postgres

import (
	"context"
	"errors"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/pkg/chatcrypto"
	"model-gate/internal/pkg/chatcrypto/cryptotest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in: a disposable retention_test database with the fresh chat changelog applied.
func TestChatRetentionPostgres(t *testing.T) {
	dsn := os.Getenv("CHAT_RETENTION_TEST_DSN")
	if dsn == "" {
		t.Skip("disposable PostgreSQL fixture required")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port <= 10000 || cfg.ConnConfig.Database != "retention_test" || cfg.ConnConfig.User != "retention_test" {
		t.Fatal("disposable retention_test endpoint required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	const owner = 90101
	const other = 90102
	if _, err = pool.Exec(ctx, `INSERT INTO chat.site_user (id,email) VALUES ($1,'owner@example.test'),($2,'other@example.test')`, owner, other); err != nil {
		t.Fatal(err)
	}
	keyfile, keys := cryptotest.New(t)
	r := NewRepository(pool, keys)
	newChat := func(user int) *entity.Chat {
		return &entity.Chat{ID: uuid.New(), UserID: &user, Name: "Test", CreatedAt: time.Now()}
	}
	var wg sync.WaitGroup
	results := make(chan error, 16)
	for range 16 {
		wg.Go(func() { results <- r.CreateChat(ctx, newChat(owner)) })
	}
	wg.Wait()
	close(results)
	created, limited := 0, 0
	for result := range results {
		if result == nil {
			created++
		} else if errors.Is(result, repository.ErrChatLimitReached) {
			limited++
		} else {
			t.Fatal(result)
		}
	}
	if created != 10 || limited != 6 {
		t.Fatalf("created %d, limited %d", created, limited)
	}
	otherChat := newChat(other)
	if err = r.CreateChat(ctx, otherChat); err != nil {
		t.Fatal(err)
	}
	chats, err := r.GetChatsByUserID(ctx, owner)
	if err != nil || len(chats) != 10 {
		t.Fatalf("owner list: %d, %v", len(chats), err)
	}
	id := chats[0].ID
	if _, err = pool.Exec(ctx, `UPDATE chat.chat SET expires_at=statement_timestamp()+INTERVAL '1 minute' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	sent := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Hour)
	if err = r.WithChatLock(ctx, id, func(ctx context.Context) error { return r.RecordMessageActivity(ctx, id, sent) }); err != nil {
		t.Fatal(err)
	}
	checkDeadline := func(expected time.Time) {
		t.Helper()
		var got time.Time
		if err := pool.QueryRow(ctx, `SELECT expires_at FROM chat.chat WHERE id=$1`, id).Scan(&got); err != nil || !got.Equal(expected) {
			t.Fatalf("expiry %v, want %v (%v)", got, expected, err)
		}
	}
	checkDeadline(sent.Add(720 * time.Hour))
	chats[0].Name = "Renamed"
	if err = r.UpdateChat(ctx, chats[0]); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := pool.QueryRow(ctx, "SELECT name FROM chat.chat WHERE id=$1", id).Scan(&stored); err != nil || len(stored) < 10 || stored[:10] != "azchat:v1:" {
		t.Fatal("renamed title is not encrypted at rest", err)
	}
	if _, err = r.GetChatForOwner(ctx, id, other); !errors.Is(err, repository.ErrChatAccessDenied) {
		t.Fatal("foreign title accessible", err)
	}
	_, wrong := cryptotest.New(t)
	if _, err = NewRepository(pool, wrong).GetChatForOwner(ctx, id, owner); !errors.Is(err, chatcrypto.ErrUnreadable) {
		t.Fatal("wrong key did not reject stored title", err)
	}
	reloaded, err := chatcrypto.Load(keyfile)
	if err != nil {
		t.Fatal(err)
	}
	if chat, err := NewRepository(pool, reloaded).GetChatForOwner(ctx, id, owner); err != nil || chat.Name != "Renamed" {
		t.Fatal("title not restored with separate key", err)
	}
	if err = r.RecordMessageActivity(ctx, id, sent.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	checkDeadline(sent.Add(720 * time.Hour))
	if _, err = pool.Exec(ctx, `UPDATE chat.chat SET expires_at=statement_timestamp()-INTERVAL '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = r.GetChatForOwner(ctx, id, owner); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expired chat accessible: %v", err)
	}
	if err = r.CreateChat(ctx, newChat(owner)); err != nil {
		t.Fatalf("expired slot not reusable: %v", err)
	}
	expired, err := r.ExpiredChatsAfter(ctx, repository.ChatExpiry{}, 10)
	if err != nil || len(expired) != 1 || expired[0].ID != id {
		t.Fatalf("expiry scan: %d, %v", len(expired), err)
	}
	if err = r.WithChatLock(ctx, id, func(ctx context.Context) error {
		ready, err := r.IsExpiredChat(ctx, expired[0])
		if err != nil || !ready {
			return fmt.Errorf("expiry recheck: %v, %w", ready, err)
		}
		return r.DeleteChat(ctx, id, owner)
	}); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM chat.chat WHERE id=$1`, id).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("expired row not removed")
	}
}
