package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"

	"log/slog"
)

type ChatListUseCase struct {
	authUseCase usecase.Auth
	chatRepo    repository.ChatRepository
	logger      *slog.Logger
}

func NewChatListUseCase(
	authUseCase usecase.Auth,
	chatRepo repository.ChatRepository,
	logger *slog.Logger,
) *ChatListUseCase {
	return &ChatListUseCase{
		authUseCase: authUseCase,
		chatRepo:    chatRepo,
		logger:      logger,
	}
}

func (u *ChatListUseCase) ChatList(ctx context.Context) ([]*entity.Chat, error) {
	user, err := u.authUseCase.GetAuthUserId(ctx)
	if err != nil {
		u.logger.DebugContext(ctx, "user not authenticated for chat list", "error", err)
		return []*entity.Chat{}, nil
	}

	chats, err := u.chatRepo.GetChatsByUserID(ctx, user.GetID())
	if err != nil {
		return nil, fmt.Errorf("failed to get chats by user id: %w", err)
	}

	return chats, nil
}

var _ usecase.ChatListUseCase = (*ChatListUseCase)(nil)
