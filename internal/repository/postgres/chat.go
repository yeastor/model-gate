package postgres

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"

	"github.com/google/uuid"
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

	_, err := r.pool.Exec(ctx, query, chat.ID, chat.Name, chat.CreatedAt, chat.UserID)
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
	if err := r.pool.QueryRow(ctx, query, id).Scan(&count); err != nil {
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
	if err := r.pool.QueryRow(ctx, query, id).Scan(&chat.ID, &chat.Name, &chat.CreatedAt, &chat.UserID); err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}

	return &chat, nil
}

func (r *Repository) UpdateChat(ctx context.Context, chat *entity.Chat) error {
	query := `
		UPDATE chat.chat
		SET user_id = $2
		WHERE id = $1
	`

	_, err := r.pool.Exec(ctx, query, chat.ID, chat.UserID)
	if err != nil {
		return fmt.Errorf("failed to update chat: %w", err)
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

	rows, err := r.pool.Query(ctx, query, userID)
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

	return chats, nil
}

var _ repository.ChatRepository = (*Repository)(nil)
