package repository

import (
	"context"
	"model-gate/internal/domain/entity"
)

type UserRepository interface {
	CreateUser(ctx context.Context, user *entity.User) error
	UserExists(ctx context.Context, id int) (bool, error)
	GetUser(ctx context.Context, id int) (*entity.User, error)
}
