package clickhouse

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/pkg/chatcrypto"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
)

type Repository struct {
	conn    clickhouse.Conn
	storage *chatcrypto.Keyring
}

func NewRepository(conn clickhouse.Conn, storage *chatcrypto.Keyring) *Repository {
	return &Repository{
		conn:    conn,
		storage: storage,
	}
}

func messageScope(message *entity.Message, field string) string {
	return "clickhouse/message/" + field + "/" + message.ChatID.String() + "/" + message.ID.String()
}

func (r *Repository) openMessage(message *entity.Message) error {
	question, err := r.storage.Open(messageScope(message, "question"), message.Question)
	if err != nil {
		return err
	}
	answer, err := r.storage.Open(messageScope(message, "answer"), message.Answer)
	if err != nil {
		return err
	}
	message.Question, message.Answer = question, answer
	return nil
}

func (r *Repository) CreateMessage(ctx context.Context, message *entity.Message) error {
	var count uint64
	if err := r.conn.QueryRow(ctx, "SELECT count() FROM chat.message WHERE chat_id = ? AND id = ?", message.ChatID, message.ID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	question, err := r.storage.Seal(messageScope(message, "question"), message.Question)
	if err != nil {
		return err
	}
	answer, err := r.storage.Seal(messageScope(message, "answer"), message.Answer)
	if err != nil {
		return err
	}
	query := `
            INSERT INTO chat.message (id, chat_id, question, answer, category, created_at)
	        VALUES (?, ?, ?, ?, ?, fromUnixTimestamp64Milli(?))
	    `

	return r.conn.Exec(ctx, query,
		message.ID,
		message.ChatID,
		question,
		answer,
		message.Category,
		message.CreatedAt.UnixMilli(),
	)
}

func (r *Repository) GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	query := `
	        SELECT m.id, any(m.chat_id) AS chat_id, any(m.question) AS question, any(m.answer) AS answer, any(m.category) AS category, min(m.created_at) AS created_at
	        FROM chat.message AS m
	        WHERE m.chat_id = ? GROUP BY m.id
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
		if err := r.openMessage(&msg); err != nil {
			return nil, err
		}
		messages = append(messages, &msg)
	}

	return messages, rows.Err()
}

var _ repository.ClickhouseChatRepository = (*Repository)(nil)

func (r *Repository) GetAllMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	rows, err := r.conn.Query(ctx, `SELECT m.id, any(m.chat_id) AS chat_id, any(m.question) AS question, any(m.answer) AS answer, any(m.category) AS category, min(m.created_at) AS created_at
        FROM chat.message AS m WHERE m.chat_id = ? GROUP BY m.id ORDER BY created_at ASC, id ASC LIMIT 10001`, chatID)
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
		if err := r.openMessage(&message); err != nil {
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
