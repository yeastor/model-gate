package cookie

import (
	"context"
	"encoding/json"
	"io"
	"model-gate/internal/api/middleware"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	dcHttp "model-gate/pkg/http"
	"net/http"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type MetadataCookieProvider struct {
	httpClient  dcHttp.Client
	userInfoURL string
	cookieName  string
}

func NewMetadataCookieProvider(httpClient dcHttp.Client, options usecase.AuthOptions) *MetadataCookieProvider {
	return &MetadataCookieProvider{
		httpClient:  httpClient,
		userInfoURL: options.GetAuthUserInfoURL(),
		cookieName:  options.GetAuthCookieName(),
	}
}

func (p *MetadataCookieProvider) IsTokenExist(ctx context.Context) (bool, error) {
	val, ok := middleware.GetAuthCookie(ctx)
	return ok && val != "", nil
}

type authMeResponse struct {
	OK   bool `json:"ok"`
	User struct {
		ID     int    `json:"id"`
		Email  string `json:"email"`
		Status string `json:"status"`
	} `json:"user"`
}

func (p *MetadataCookieProvider) GetAuthUserId(ctx context.Context) (*entity.User, error) {
	cookieValue, ok := middleware.GetAuthCookie(ctx)
	if !ok || cookieValue == "" {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.userInfoURL, nil)
	if err != nil {
		return nil, status.Error(codes.Unavailable, "authentication service misconfigured")
	}
	req.Header.Set("Cookie", p.cookieName+"="+cookieValue)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, status.Error(codes.Unavailable, "authentication service unavailable")
	}
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024+1))
	closeErr := resp.Body.Close()
	if readErr != nil || closeErr != nil {
		return nil, status.Error(codes.Unavailable, "invalid authentication response")
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}
	if resp.StatusCode != http.StatusOK || len(body) > 64*1024 {
		return nil, status.Error(codes.Unavailable, "authentication service unavailable")
	}

	var response authMeResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, status.Error(codes.Unavailable, "invalid authentication response")
	}

	if !response.OK || response.User.ID <= 0 || response.User.Email == "" || response.User.Status != "active" {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}

	return &entity.User{
		ID:    response.User.ID,
		Email: response.User.Email,
	}, nil
}
