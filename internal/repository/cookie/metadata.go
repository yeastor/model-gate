package cookie

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"model-gate/internal/api/middleware"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	dcHttp "model-gate/pkg/http"
	"net/http"
	"strconv"
	"strings"
)

type MetadataCookieProvider struct {
	httpClient  dcHttp.Client
	loginDomain string
	cookieName  string
	env         string
}

func NewMetadataCookieProvider(httpClient dcHttp.Client, options usecase.AuthOptions) *MetadataCookieProvider {
	return &MetadataCookieProvider{
		httpClient:  httpClient,
		loginDomain: options.GetAuthLoginDomain(),
		cookieName:  options.GetAuthCookieName(),
		env:         options.GetEnv(),
	}
}

func (p *MetadataCookieProvider) IsTokenExist(ctx context.Context) (bool, error) {
	val, ok := middleware.GetAuthCookie(ctx)
	return ok && val != "", nil
}

type authMeResponse struct {
	OK   bool `json:"ok"`
	User struct {
		ID    int    `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
}

func (p *MetadataCookieProvider) GetAuthUserId(ctx context.Context) (*entity.User, error) {
	cookieValue, ok := middleware.GetAuthCookie(ctx)
	if !ok || cookieValue == "" {
		return nil, fmt.Errorf("auth cookie not found in context")
	}

	if p.env == "dev" {
		const prefix = "test-user-"
		if strings.HasPrefix(cookieValue, prefix) {
			return parseTestUser(cookieValue[len(prefix):])
		}
	}

	url := p.loginDomain + "/api/auth/me"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create auth request: %w", err)
	}
	req.Header.Set("Cookie", p.cookieName+"="+cookieValue)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("auth request failed: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read auth response: %w", err)
	}

	var response authMeResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to parse auth response: %w", err)
	}

	if !response.OK {
		return nil, fmt.Errorf("user not authenticated")
	}

	return &entity.User{
		ID:    response.User.ID,
		Email: response.User.Email,
	}, nil
}

func parseTestUser(payload string) (*entity.User, error) {
	idStr, email, found := strings.Cut(payload, ":")
	if !found || idStr == "" || email == "" {
		return nil, fmt.Errorf("invalid test user format, expected test-user-{id}:{email}")
	}

	id, err := strconv.Atoi(idStr)
	if err != nil {
		return nil, fmt.Errorf("invalid test user id: %w", err)
	}

	return &entity.User{
		ID:    id,
		Email: email,
	}, nil
}
