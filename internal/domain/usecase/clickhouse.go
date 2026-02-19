package usecase

import (
	"context"
	"model-gate/internal/domain/entity"

	"github.com/google/uuid"
)

type ClickHouseUseCase interface {
	AddMessage(ctx context.Context, message *entity.Message) error
	AddChat(ctx context.Context, chatID uuid.UUID, chatName string) error
	CheckExist(ctx context.Context, chatID uuid.UUID) (b bool, err error)
	MessageList(ctx context.Context, chatID uuid.UUID) (message []*entity.Message, err error)
}
