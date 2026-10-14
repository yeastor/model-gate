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

func (r *Repository) GetAllMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	rows, err := r.conn.Query(ctx, `SELECT id, chat_id, question, answer, category, created_at
        FROM chat.message WHERE chat_id = ? ORDER BY created_at ASC, id ASC LIMIT 10001`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]*entity.Message, 0)
	for rows.Next() {
		var message entity.Message
		if err := rows.Scan(&message.ID, &message.ChatID, &message.Question, &message.Answer, &message.Category, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, &message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(messages) > 10000 {
		return nil, fmt.Errorf("chat export exceeds 10000 exchanges")
	}
	return messages, nil
}

func (r *Repository) DeleteMessagesByChatID(ctx context.Context, chatID uuid.UUID) error {
	// Wait for the mutation before acknowledging removal, not just for its enqueue.
	return r.conn.Exec(ctx, `ALTER TABLE chat.message DELETE WHERE chat_id = ? SETTINGS mutations_sync = 2`, chatID)
}
