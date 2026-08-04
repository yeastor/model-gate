package modelgate

import (
	"context"
	"model-gate/internal/domain/usecase"
)

type AuthUseCase struct {
	authProvider usecase.AuthProvider
	cookieName   string
}

func NewAuthUseCase(authProvider usecase.AuthProvider, options usecase.AuthOptions) *AuthUseCase {
	return &AuthUseCase{
		authProvider: authProvider,
		cookieName:   options.GetAuthCookieName(),
	}
}

func (u *AuthUseCase) IsTokenExist(ctx context.Context) (bool, error) {
	return u.authProvider.IsTokenExist(ctx, u.cookieName)
}

var _ usecase.Auth = (*AuthUseCase)(nil)
