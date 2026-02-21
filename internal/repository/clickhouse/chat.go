package clickhouse

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
)

type Repository struct {
	conn clickhouse.Conn
}

func NewRepository(conn clickhouse.Conn) *Repository {
	return &Repository{
		conn: conn,
	}
}

// Chat methods
func (r *Repository) CreateChat(ctx context.Context, chat *entity.Chat) error {
	query := `
        INSERT INTO chat.chat (id, name, created_at) 
        VALUES (?, ?, ?)
    `

	return r.conn.Exec(ctx, query,
		chat.ID,
		chat.Name,
		chat.CreatedAt,
	)
}

func (r *Repository) ChatExists(ctx context.Context, id uuid.UUID) (bool, error) {
	query := `
        SELECT count() 
        FROM chat.chat 
        WHERE id = ?
    `

	var count uint64
	row := r.conn.QueryRow(ctx, query, id)
	if err := row.Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check chat existence: %w", err)
	}

	return count > 0, nil
}

func (r *Repository) GetChat(ctx context.Context, id uuid.UUID) (*entity.Chat, error) {
	query := `
        SELECT id, name, created_at 
        FROM chat.chat 
        WHERE id = ? 
        LIMIT 1
    `

	var chat entity.Chat
	row := r.conn.QueryRow(ctx, query, id)
	if err := row.Scan(&chat.ID, &chat.Name, &chat.CreatedAt); err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}

	return &chat, nil
}

// Message methods
func (r *Repository) CreateMessage(ctx context.Context, message *entity.Message) error {
	query := `
        INSERT INTO chat.message (id, chat_id, question, answer, created_at) 
        VALUES (?, ?, ?, ?, ?)
    `

	return r.conn.Exec(ctx, query,
		message.ID,
		message.ChatID,
		message.Question,
		message.Answer,
		message.CreatedAt,
	)
}

func (r *Repository) GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	query := `
        SELECT id, chat_id, question, answer, created_at 
        FROM chat.message 
        WHERE chat_id = ? 
        ORDER BY created_at DESC LIMIT 30
    `

	rows, err := r.conn.Query(ctx, query, chatID)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}
	defer rows.Close()

	var messages []*entity.Message
	for rows.Next() {
		var msg entity.Message
		if err := rows.Scan(&msg.ID, &msg.ChatID, &msg.Question, &msg.Answer, &msg.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}
