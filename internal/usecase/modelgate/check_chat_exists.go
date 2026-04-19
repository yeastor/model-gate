package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"

	"github.com/google/uuid"
)

type CheckChatExistsUseCase struct {
	chatRepo repository.ChatRepository
}

func NewCheckChatExistsUseCase(chatRepo repository.ChatRepository) *CheckChatExistsUseCase {
	return &CheckChatExistsUseCase{chatRepo: chatRepo}
}

func (u CheckChatExistsUseCase) CheckExist(ctx context.Context, chatID uuid.UUID) (bool, error) {
	exists, err := u.chatRepo.ChatExists(ctx, chatID)
	if err != nil {
		return false, fmt.Errorf("failed to check chat existence: %w", err)
	}

	return exists, nil
}

var _ usecase.CheckChatExistsUseCase = (*CheckChatExistsUseCase)(nil)
