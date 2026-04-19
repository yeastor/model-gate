package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
)

type AddMessageUseCase struct {
	chatRepo repository.ClickhouseChatRepository
}

func NewAddMessageUseCase(chatRepo repository.ClickhouseChatRepository) *AddMessageUseCase {
	return &AddMessageUseCase{chatRepo: chatRepo}
}

func (u AddMessageUseCase) AddMessage(ctx context.Context, message *entity.Message) error {
	if err := u.chatRepo.CreateMessage(ctx, message); err != nil {
		return fmt.Errorf("failed to save message: %w", err)
	}

	return nil
}

var _ usecase.AddMessageUseCase = (*AddMessageUseCase)(nil)
