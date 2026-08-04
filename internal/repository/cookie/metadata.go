package cookie

import (
	"context"
	"strings"

	"google.golang.org/grpc/metadata"
)

const cookieMetadataKey = "grpcgateway-cookie"

type MetadataCookieProvider struct{}

func NewMetadataCookieProvider() *MetadataCookieProvider {
	return &MetadataCookieProvider{}
}

func (p *MetadataCookieProvider) IsTokenExist(ctx context.Context, name string) (bool, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return false, nil
	}

	values := md.Get(cookieMetadataKey)
	for _, header := range values {
		for _, part := range strings.Split(header, ";") {
			part = strings.TrimSpace(part)
			key, value, found := strings.Cut(part, "=")
			if found && key == name {
				return value != "", nil
			}
		}
	}

	return false, nil
}
