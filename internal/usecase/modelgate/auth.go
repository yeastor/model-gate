package modelgate

import (
	"context"
	"model-gate/internal/domain/usecase"
)

type AuthUseCase struct {
	authProvider usecase.AuthProvider
}

func NewAuthUseCase(authProvider usecase.AuthProvider) *AuthUseCase {
	return &AuthUseCase{
		authProvider: authProvider,
	}
}

func (u *AuthUseCase) IsTokenExist(ctx context.Context) (bool, error) {
	return u.authProvider.IsTokenExist(ctx)
}

var _ usecase.Auth = (*AuthUseCase)(nil)
