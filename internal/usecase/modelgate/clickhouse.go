package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/repository/clickhouse"
	"time"

	"github.com/google/uuid"
)

type ClickHouseUseCase struct {
	chatRepo clickhouse.ChatRepository
}

func NewClickHouseUseCase(chatRepo clickhouse.ChatRepository) *ClickHouseUseCase {
	return &ClickHouseUseCase{chatRepo: chatRepo}
}

func (s ClickHouseUseCase) AddMessage(ctx context.Context, message *entity.Message) error {
	if err := s.chatRepo.CreateMessage(ctx, message); err != nil {
		return fmt.Errorf("failed to save message: %w", err)
	}
	return nil
}

func (s ClickHouseUseCase) AddChat(ctx context.Context, chatID uuid.UUID, chatName string) error {
	chat := &entity.Chat{
		ID:        chatID,
		Name:      chatName,
		CreatedAt: time.Now(),
	}

	if err := s.chatRepo.CreateChat(ctx, chat); err != nil {
		return fmt.Errorf("failed to create chat: %w", err)
	}

	return nil
}

func (s ClickHouseUseCase) CheckExist(ctx context.Context, chatID uuid.UUID) (b bool, err error) {
	// 1. Проверяем существование чата
	exists, err := s.chatRepo.ChatExists(ctx, chatID)
	if err != nil {
		return false, fmt.Errorf("failed to check chat existence: %w", err)
	}

	return exists, nil
}

func (s ClickHouseUseCase) MessageList(ctx context.Context, chatID uuid.UUID) (message []*entity.Message, err error) {
	messages, err := s.chatRepo.GetMessagesByChatID(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}
	return messages, nil
}

var _ usecase.ClickHouseUseCase = (*ClickHouseUseCase)(nil)
