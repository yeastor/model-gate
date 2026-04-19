package repository

import (
	"context"
	"model-gate/internal/domain/entity"

	"github.com/google/uuid"
)

type ChatRepository interface {
	CreateChat(ctx context.Context, chat *entity.Chat) error
	ChatExists(ctx context.Context, id uuid.UUID) (bool, error)
	GetChat(ctx context.Context, id uuid.UUID) (*entity.Chat, error)
}

type ClickhouseChatRepository interface {
	CreateMessage(ctx context.Context, message *entity.Message) error
	GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
}
