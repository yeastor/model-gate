package cookie

import (
	"context"
	"model-gate/internal/api/middleware"
)

type MetadataCookieProvider struct{}

func NewMetadataCookieProvider() *MetadataCookieProvider {
	return &MetadataCookieProvider{}
}

func (p *MetadataCookieProvider) IsTokenExist(ctx context.Context) (bool, error) {
	val, ok := middleware.GetAuthCookie(ctx)
	return ok && val != "", nil
}
