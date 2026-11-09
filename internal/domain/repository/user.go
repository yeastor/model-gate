package repository

import (
	"context"
	"errors"
	"model-gate/internal/domain/entity"
)

var ErrUserErased = errors.New("chat user erased")

type UserRepository interface {
	CreateUser(ctx context.Context, user *entity.User) error
	UserExists(ctx context.Context, id int) (bool, error)
	GetUser(ctx context.Context, id int) (*entity.User, error)
}
