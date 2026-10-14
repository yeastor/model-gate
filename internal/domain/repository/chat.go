package repository

import (
	"context"
	"model-gate/internal/domain/entity"

	"github.com/google/uuid"
)

type ChatRepository interface {
	WithChatLock(ctx context.Context, id uuid.UUID, action func(context.Context) error) error
	DeleteChat(ctx context.Context, id uuid.UUID, userID int) error
	CreateChat(ctx context.Context, chat *entity.Chat) error
	ChatExists(ctx context.Context, id uuid.UUID) (bool, error)
	GetChat(ctx context.Context, id uuid.UUID) (*entity.Chat, error)
	UpdateChat(ctx context.Context, chat *entity.Chat) error
	UpdateUpdatedAt(ctx context.Context, chatID uuid.UUID) error
	GetChatsByUserID(ctx context.Context, userID int) ([]*entity.Chat, error)
}

type ClickhouseChatRepository interface {
	GetAllMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
	DeleteMessagesByChatID(ctx context.Context, chatID uuid.UUID) error
	CreateMessage(ctx context.Context, message *entity.Message) error
	GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
}
