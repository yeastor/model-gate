package postgres

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestChatLockCoordinatesRepositoriesAndUsesOneConnection(t *testing.T) {
	dsn := os.Getenv("CHAT_LOCK_TEST_DSN")
	if dsn == "" {
		t.Skip("opt-in local database lock test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	firstPool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer firstPool.Close()
	secondPool, err := pgxpool.NewWithConfig(ctx, config.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer secondPool.Close()
	first, second := NewRepository(firstPool), NewRepository(secondPool)
	id := uuid.New() // No persistent table rows are created or changed.
	entered, release, secondEntered := make(chan struct{}), make(chan struct{}), make(chan struct{})
	results := make(chan error, 2)
	var once sync.Once
	defer once.Do(func() { close(release) })
	go func() {
		results <- first.WithChatLock(ctx, id, func(lockCtx context.Context) error {
			// This must use the transaction, not wait for another pooled connection.
			var value int
			if err := first.queries(lockCtx).QueryRow(lockCtx, "SELECT 1").Scan(&value); err != nil {
				return err
			}
			close(entered)
			select {
			case <-release:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("first repository never acquired its lock")
	}
	go func() {
		results <- second.WithChatLock(ctx, id, func(lockCtx context.Context) error {
			close(secondEntered)
			var value int
			return second.queries(lockCtx).QueryRow(lockCtx, "SELECT 1").Scan(&value)
		})
	}()
	select {
	case <-secondEntered:
		t.Fatal("another repository bypassed the chat lock")
	case <-time.After(150 * time.Millisecond):
	}
	once.Do(func() { close(release) })
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("chat lock did not release")
		}
	}
	select {
	case <-secondEntered:
	default:
		t.Fatal("waiting action never executed")
	}
}
