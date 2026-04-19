package usecase

import (
	"context"
	"model-gate/internal/domain/entity"

	"github.com/google/uuid"
)

type AddChatUseCase interface {
	AddChat(ctx context.Context, chatID uuid.UUID, chatName string) error
}

type CheckChatExistsUseCase interface {
	CheckExist(ctx context.Context, chatID uuid.UUID) (bool, error)
}

type AddMessageUseCase interface {
	AddMessage(ctx context.Context, message *entity.Message) error
}

type MessageListUseCase interface {
	MessageList(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error)
}
