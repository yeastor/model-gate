package repository

import (
	"context"
	"errors"
	"model-gate/internal/domain/entity"
	"time"

	"github.com/google/uuid"
)

var ErrChatLimitReached = errors.New("chat limit reached")
var ErrChatAccessDenied = errors.New("chat access denied")

type ChatRepository interface {
	WithChatLock(ctx context.Context, id uuid.UUID, action func(context.Context) error) error
	DeleteChat(ctx context.Context, id uuid.UUID, userID int) error
	CreateChat(ctx context.Context, chat *entity.Chat) error
	ChatExists(ctx context.Context, id uuid.UUID) (bool, error)
	GetChatForOwner(ctx context.Context, id uuid.UUID, userID int) (*entity.Chat, error)
	UpdateChat(ctx context.Context, chat *entity.Chat) error
	RecordMessageActivity(ctx context.Context, chatID uuid.UUID, sentAt time.Time) error
	GetChatsByUserID(ctx context.Context, userID int) ([]*entity.Chat, error)
}

type ClickhouseChatRepository interface {
	GetAllMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
	DeleteMessagesByChatID(ctx context.Context, chatID uuid.UUID) error
	CreateMessage(ctx context.Context, message *entity.Message) error
	GetMessagesByChatID(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
}
