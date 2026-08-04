package usecase

import "context"

type Auth interface {
	IsTokenExist(ctx context.Context) (bool, error)
}

type AuthProvider interface {
	IsTokenExist(ctx context.Context, cookieName string) (bool, error)
}

type AuthOptions interface {
	GetAuthCookieName() string
	GetAuthFreeMessageLimit() int
	GetAuthLoginDomain() string
}
