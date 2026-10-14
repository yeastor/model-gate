package postgres

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) CreateChat(ctx context.Context, chat *entity.Chat) error {
	query := `
		INSERT INTO chat.chat (id, name, created_at, user_id)
		VALUES ($1, $2, $3, $4)
	`

	_, err := r.queries(ctx).Exec(ctx, query, chat.ID, chat.Name, chat.CreatedAt, chat.UserID)
	if err != nil {
		return fmt.Errorf("failed to create chat: %w", err)
	}

	return nil
}

func (r *Repository) ChatExists(ctx context.Context, id uuid.UUID) (bool, error) {
	query := `
		SELECT count(*)
		FROM chat.chat
		WHERE id = $1
	`

	var count int64
	if err := r.queries(ctx).QueryRow(ctx, query, id).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check chat existence: %w", err)
	}

	return count > 0, nil
}

func (r *Repository) GetChat(ctx context.Context, id uuid.UUID) (*entity.Chat, error) {
	query := `
		SELECT id, name, created_at, user_id
		FROM chat.chat
		WHERE id = $1
		LIMIT 1
	`

	var chat entity.Chat
	if err := r.queries(ctx).QueryRow(ctx, query, id).Scan(&chat.ID, &chat.Name, &chat.CreatedAt, &chat.UserID); err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}

	return &chat, nil
}

func (r *Repository) UpdateChat(ctx context.Context, chat *entity.Chat) error {
	query := `
		UPDATE chat.chat
		SET name = $2, updated_at = $4
		WHERE id = $1 AND user_id = $3
	`

	_, err := r.queries(ctx).Exec(ctx, query, chat.ID, chat.Name, chat.UserID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update chat: %w", err)
	}

	return nil
}

func (r *Repository) UpdateUpdatedAt(ctx context.Context, chatID uuid.UUID) error {
	query := `
		UPDATE chat.chat
		SET updated_at = $2
		WHERE id = $1
	`

	_, err := r.queries(ctx).Exec(ctx, query, chatID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update chat updated at: %w", err)
	}

	return nil
}

func (r *Repository) GetChatsByUserID(ctx context.Context, userID int) ([]*entity.Chat, error) {
	query := `
		SELECT id, name, created_at, user_id
		FROM chat.chat
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`

	rows, err := r.queries(ctx).Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get chats by user id: %w", err)
	}
	defer rows.Close()

	var chats []*entity.Chat
	for rows.Next() {
		var chat entity.Chat
		if err := rows.Scan(&chat.ID, &chat.Name, &chat.CreatedAt, &chat.UserID); err != nil {
			return nil, fmt.Errorf("failed to scan chat: %w", err)
		}
		chats = append(chats, &chat)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read chat list: %w", err)
	}
	return chats, nil
}

var _ repository.ChatRepository = (*Repository)(nil)

// Transaction-scoped advisory locks also coordinate different service replicas.
// The callback carries the transaction so pool exhaustion cannot deadlock it.
func (r *Repository) WithChatLock(ctx context.Context, id uuid.UUID, action func(context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin chat lock: %w", err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, id.String()); err != nil {
		return fmt.Errorf("acquire chat lock: %w", err)
	}
	if err := action(context.WithValue(ctx, chatTransactionKey{}, tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type chatTransactionKey struct{}

type chatQueries interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (r *Repository) queries(ctx context.Context) chatQueries {
	if tx, ok := ctx.Value(chatTransactionKey{}).(pgx.Tx); ok {
		return tx
	}
	return r.pool
}

func (r *Repository) DeleteChat(ctx context.Context, id uuid.UUID, userID int) error {
	// Called inside WithChatLock: the owner check, relationships and deletion share its transaction.
	query := r.queries(ctx)
	var legacyExists bool
	if err := query.QueryRow(ctx, "SELECT to_regclass('chat.rel_chat_user') IS NOT NULL").Scan(&legacyExists); err != nil {
		return err
	}
	if legacyExists {
		if _, err := query.Exec(ctx, `DELETE FROM chat.rel_chat_user WHERE chat_id = $1 AND EXISTS
            (SELECT 1 FROM chat.chat WHERE id = $1 AND user_id = $2)`, id, userID); err != nil {
			return err
		}
	}
	deleted, err := query.Exec(ctx, `DELETE FROM chat.chat WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if deleted.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return nil
}
