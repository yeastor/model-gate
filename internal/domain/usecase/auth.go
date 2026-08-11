package usecase

import (
	"context"
	"model-gate/internal/domain/entity"
)

type Auth interface {
	IsTokenExist(ctx context.Context) (bool, error)
	GetAuthUserId(ctx context.Context) (*entity.User, error)
}

type AuthProvider interface {
	IsTokenExist(ctx context.Context) (bool, error)
	GetAuthUserId(ctx context.Context) (*entity.User, error)
}

type AuthOptions interface {
	GetAuthCookieName() string
	GetAuthFreeMessageLimit() int
	GetAuthLoginDomain() string
	GetEnv() string
}
