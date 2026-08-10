package repository

import (
	"context"
	"model-gate/internal/domain/entity"

	"github.com/google/uuid"
)

type UserRepository interface {
	CreateUser(ctx context.Context, user *entity.User) error
	UserExists(ctx context.Context, id int) (bool, error)
	GetUser(ctx context.Context, id int) (*entity.User, error)
}

type RelChatUserRepository interface {
	AddUserToChat(ctx context.Context, rel *entity.RelChatUser) error
	GetChatsByUserID(ctx context.Context, userID int) ([]uuid.UUID, error)
	GetUsersByChatID(ctx context.Context, chatID uuid.UUID) ([]int, error)
}
