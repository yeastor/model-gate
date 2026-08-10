package postgres

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RelChatUserRepository struct {
	pool *pgxpool.Pool
}

func NewRelChatUserRepository(pool *pgxpool.Pool) *RelChatUserRepository {
	return &RelChatUserRepository{pool: pool}
}

func (r *RelChatUserRepository) AddUserToChat(ctx context.Context, rel *entity.RelChatUser) error {
	query := `
		INSERT INTO chat.rel_chat_user (user_id, chat_id)
		VALUES ($1, $2)
	`

	_, err := r.pool.Exec(ctx, query, rel.UserID, rel.ChatID)
	if err != nil {
		return fmt.Errorf("failed to add user to chat: %w", err)
	}

	return nil
}

func (r *RelChatUserRepository) GetChatsByUserID(ctx context.Context, userID int) ([]uuid.UUID, error) {
	query := `
		SELECT chat_id
		FROM chat.rel_chat_user
		WHERE user_id = $1
	`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get chats by user id: %w", err)
	}
	defer rows.Close()

	var chatIDs []uuid.UUID
	for rows.Next() {
		var chatID uuid.UUID
		if err := rows.Scan(&chatID); err != nil {
			return nil, fmt.Errorf("failed to scan chat id: %w", err)
		}
		chatIDs = append(chatIDs, chatID)
	}

	return chatIDs, nil
}

func (r *RelChatUserRepository) GetUsersByChatID(ctx context.Context, chatID uuid.UUID) ([]int, error) {
	query := `
		SELECT user_id
		FROM chat.rel_chat_user
		WHERE chat_id = $1
	`

	rows, err := r.pool.Query(ctx, query, chatID)
	if err != nil {
		return nil, fmt.Errorf("failed to get users by chat id: %w", err)
	}
	defer rows.Close()

	var userIDs []int
	for rows.Next() {
		var userID int
		if err := rows.Scan(&userID); err != nil {
			return nil, fmt.Errorf("failed to scan user id: %w", err)
		}
		userIDs = append(userIDs, userID)
	}

	return userIDs, nil
}

var _ repository.RelChatUserRepository = (*RelChatUserRepository)(nil)
