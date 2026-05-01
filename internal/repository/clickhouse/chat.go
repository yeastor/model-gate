package clickhouse

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"

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

func (r *Repository) CreateMessage(ctx context.Context, message *entity.Message) error {
	query := `
	        INSERT INTO chat.message (id, chat_id, question, answer, category, created_at) 
	        VALUES (?, ?, ?, ?, ?, ?)
	    `

	return r.conn.Exec(ctx, query,
		message.ID,
		message.ChatID,
		message.Question,
		message.Answer,
		message.Category,
		message.CreatedAt,
	)
}

func (r *Repository) GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	query := `
	        SELECT id, chat_id, question, answer, category, created_at 
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
		if err := rows.Scan(&msg.ID, &msg.ChatID, &msg.Question, &msg.Answer, &msg.Category, &msg.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}

var _ repository.ClickhouseChatRepository = (*Repository)(nil)
