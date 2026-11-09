package postgres

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/pkg/chatcrypto"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool    *pgxpool.Pool
	storage *chatcrypto.Keyring
}

func NewRepository(pool *pgxpool.Pool, storage *chatcrypto.Keyring) *Repository {
	return &Repository{pool: pool, storage: storage}
}

func chatNameScope(chatID uuid.UUID, userID int) string {
	return fmt.Sprintf("postgres/chat/name/%s/%d", chatID, userID)
}

func (r *Repository) CreateChat(ctx context.Context, chat *entity.Chat) error {
	const chatLimit = 10
	if chat.UserID == nil {
		return fmt.Errorf("chat owner required")
	}
	name, err := r.storage.Seal(chatNameScope(chat.ID, *chat.UserID), chat.Name)
	if err != nil {
		return err
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	// Serialize quota checks across service replicas for the same account.
	var owner int
	if err := tx.QueryRow(ctx, `SELECT id FROM chat.site_user WHERE id = $1 AND email IS NOT NULL FOR UPDATE`, *chat.UserID).Scan(&owner); err != nil {
		return err
	}
	query := `
		INSERT INTO chat.chat (id, name, created_at, user_id)
		SELECT $1, $2, $3, $4
		WHERE (SELECT COUNT(*) FROM chat.chat WHERE user_id = $4 AND expires_at > statement_timestamp()) < $5
	`

	inserted, err := tx.Exec(ctx, query, chat.ID, name, chat.CreatedAt, owner, chatLimit)
	if err != nil {
		return fmt.Errorf("failed to create chat: %w", err)
	}

	if inserted.RowsAffected() == 0 {
		return repository.ErrChatLimitReached
	}
	return tx.Commit(ctx)
}

func (r *Repository) ChatExists(ctx context.Context, id uuid.UUID) (bool, error) {
	query := `
		SELECT count(*)
		FROM chat.chat
		WHERE id = $1 AND expires_at > statement_timestamp()
	`

	var count int64
	if err := r.queries(ctx).QueryRow(ctx, query, id).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check chat existence: %w", err)
	}

	return count > 0, nil
}

func (r *Repository) GetChatForOwner(ctx context.Context, id uuid.UUID, userID int) (*entity.Chat, error) {
	query := `
		SELECT id, name, created_at, user_id
		FROM chat.chat
		WHERE id = $1 AND expires_at > statement_timestamp()
		LIMIT 1
	`

	var chat entity.Chat
	if err := r.queries(ctx).QueryRow(ctx, query, id).Scan(&chat.ID, &chat.Name, &chat.CreatedAt, &chat.UserID); err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}
	if chat.UserID == nil || *chat.UserID != userID {
		return nil, repository.ErrChatAccessDenied
	}
	if err := r.openChatName(&chat, userID); err != nil {
		return nil, err
	}

	return &chat, nil
}

func (r *Repository) openChatName(chat *entity.Chat, userID int) error {
	name, err := r.storage.Open(chatNameScope(chat.ID, userID), chat.Name)
	if err != nil {
		return err
	}
	chat.Name = name
	return nil
}

func (r *Repository) UpdateChat(ctx context.Context, chat *entity.Chat) error {
	if chat.UserID == nil {
		return repository.ErrChatAccessDenied
	}
	name, err := r.storage.Seal(chatNameScope(chat.ID, *chat.UserID), chat.Name)
	if err != nil {
		return err
	}
	query := `
		UPDATE chat.chat
		SET name = $2, updated_at = $4
		WHERE id = $1 AND user_id = $3
	`

	_, err = r.queries(ctx).Exec(ctx, query, chat.ID, name, chat.UserID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update chat: %w", err)
	}

	return nil
}

func (r *Repository) RecordMessageActivity(ctx context.Context, chatID uuid.UUID, sentAt time.Time) error {
	query := `
		UPDATE chat.chat
		SET expires_at = GREATEST(expires_at, LEAST($2::timestamptz, statement_timestamp()) + INTERVAL '720 hours'),
		    updated_at = GREATEST(updated_at, LEAST($2::timestamptz, statement_timestamp()))
		WHERE id = $1
	`

	_, err := r.queries(ctx).Exec(ctx, query, chatID, sentAt)
	if err != nil {
		return fmt.Errorf("failed to update chat updated at: %w", err)
	}

	return nil
}

func (r *Repository) GetChatsByUserID(ctx context.Context, userID int) ([]*entity.Chat, error) {
	query := `
		SELECT id, name, created_at, user_id
		FROM chat.chat
		WHERE user_id = $1 AND expires_at > statement_timestamp()
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
		if err := r.openChatName(&chat, userID); err != nil {
			return nil, err
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
