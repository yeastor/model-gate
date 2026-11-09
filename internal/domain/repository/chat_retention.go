package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type ChatExpiry struct {
	ID        uuid.UUID
	UserID    int
	ExpiresAt time.Time
}

type ChatRetentionRepository interface {
	ExpiredChatsAfter(context.Context, ChatExpiry, int) ([]ChatExpiry, error)
	IsExpiredChat(context.Context, ChatExpiry) (bool, error)
}
