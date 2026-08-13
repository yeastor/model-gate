package middleware

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type authCookieKey struct{}
type refererKey struct{}

var authCookieContextKey authCookieKey
var refererContextKey refererKey

const cookieMetadataKey = "grpcgateway-cookie"
const refererMetadataKey = "grpcgateway-referer"

func SetAuthCookie(ctx context.Context, value string) context.Context {
	return context.WithValue(ctx, authCookieContextKey, value)
}

func GetAuthCookie(ctx context.Context) (string, bool) {
	val, ok := ctx.Value(authCookieContextKey).(string)
	return val, ok
}

func GetReferer(ctx context.Context) (string, bool) {
	val, ok := ctx.Value(refererContextKey).(string)
	return val, ok
}

func UnaryServerInterceptor(cookieName string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		ctx = populateAuthCookie(ctx, cookieName)
		ctx = populateReferer(ctx)
		return handler(ctx, req)
	}
}

func populateAuthCookie(ctx context.Context, cookieName string) context.Context {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx
	}

	values := md.Get(cookieMetadataKey)
	for _, header := range values {
		for _, part := range strings.Split(header, ";") {
			part = strings.TrimSpace(part)
			key, value, found := strings.Cut(part, "=")
			if found && key == cookieName && value != "" {
				return SetAuthCookie(ctx, value)
			}
		}
	}

	return ctx
}

func populateReferer(ctx context.Context) context.Context {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx
	}

	values := md.Get(refererMetadataKey)
	if len(values) == 0 || values[0] == "" {
		return ctx
	}

	return context.WithValue(ctx, refererContextKey, values[0])
}
