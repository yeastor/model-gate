package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
	"slices"

	"github.com/google/uuid"
)

type MessageListUseCase struct {
	chatRepo repository.ClickhouseChatRepository
}

func NewMessageListUseCase(chatRepo repository.ClickhouseChatRepository) *MessageListUseCase {
	return &MessageListUseCase{chatRepo: chatRepo}
}

func (u MessageListUseCase) MessageList(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	messages, err := u.chatRepo.GetMessagesByChatID(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	slices.Reverse(messages)

	return messages, nil
}

var _ usecase.MessageListUseCase = (*MessageListUseCase)(nil)

func (u MessageListUseCase) ExportMessages(ctx context.Context, chatID uuid.UUID) ([]*entity.Message, error) {
	return u.chatRepo.GetAllMessagesByChatID(ctx, chatID)
}

func (u MessageListUseCase) DeleteMessages(ctx context.Context, chatID uuid.UUID) error {
	return u.chatRepo.DeleteMessagesByChatID(ctx, chatID)
}
