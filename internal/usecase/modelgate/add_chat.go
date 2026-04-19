package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
	"time"

	"github.com/google/uuid"
)

type AddChatUseCase struct {
	chatRepo repository.ChatRepository
}

func NewAddChatUseCase(chatRepo repository.ChatRepository) *AddChatUseCase {
	return &AddChatUseCase{chatRepo: chatRepo}
}

func (u AddChatUseCase) AddChat(ctx context.Context, chatID uuid.UUID, chatName string) error {
	chat := &entity.Chat{
		ID:        chatID,
		Name:      chatName,
		CreatedAt: time.Now(),
	}

	if err := u.chatRepo.CreateChat(ctx, chat); err != nil {
		return fmt.Errorf("failed to create chat: %w", err)
	}

	return nil
}

var _ usecase.AddChatUseCase = (*AddChatUseCase)(nil)
