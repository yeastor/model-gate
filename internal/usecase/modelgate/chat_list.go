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
	authUseCase     usecase.Auth
	chatRepo        repository.ChatRepository
	relChatUserRepo repository.RelChatUserRepository
	logger          *slog.Logger
}

func NewChatListUseCase(
	authUseCase usecase.Auth,
	chatRepo repository.ChatRepository,
	relChatUserRepo repository.RelChatUserRepository,
	logger *slog.Logger,
) *ChatListUseCase {
	return &ChatListUseCase{
		authUseCase:     authUseCase,
		chatRepo:        chatRepo,
		relChatUserRepo: relChatUserRepo,
		logger:          logger,
	}
}

func (u *ChatListUseCase) ChatList(ctx context.Context) ([]*entity.Chat, error) {
	user, err := u.authUseCase.GetAuthUserId(ctx)
	if err != nil {
		u.logger.DebugContext(ctx, "user not authenticated for chat list", "error", err)
		return []*entity.Chat{}, nil
	}

	chatIDs, err := u.relChatUserRepo.GetChatsByUserID(ctx, user.GetID())
	if err != nil {
		return nil, fmt.Errorf("failed to get chats by user id: %w", err)
	}

	chats := make([]*entity.Chat, 0, len(chatIDs))
	for _, chatID := range chatIDs {
		chat, err := u.chatRepo.GetChat(ctx, chatID)
		if err != nil {
			return nil, fmt.Errorf("failed to get chat: %w", err)
		}
		chats = append(chats, chat)
	}

	return chats, nil
}

var _ usecase.ChatListUseCase = (*ChatListUseCase)(nil)
