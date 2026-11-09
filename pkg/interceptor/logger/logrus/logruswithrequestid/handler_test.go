package logruswithrequestid

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"model-gate/pkg/interceptor/xrequestid"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestRequestLoggerOmitsSensitiveData(t *testing.T) {
	var logs bytes.Buffer
	logger := requestLogger(slog.New(slog.NewJSONHandler(&logs, nil)))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-request-id", "header-secret-marker"))
	info := &grpc.UnaryServerInfo{FullMethod: "/modelgate.ModelService/Chat"}
	for _, code := range []codes.Code{codes.OK, codes.PermissionDenied} {
		_, err := xrequestid.UnaryServerInterceptor()(ctx, "request-secret-marker", info, func(ctx context.Context, req any) (any, error) {
			return logger(ctx, req, info, func(context.Context, any) (any, error) {
				return "response-secret-marker", status.Error(code, "error-secret-marker")
			})
		})
		if status.Code(err) != code {
			t.Fatal("logger altered handler result")
		}
	}
	output := logs.String()
	if strings.Contains(output, "secret-marker") || !strings.Contains(output, `"code":"PermissionDenied"`) || !strings.Contains(output, `"code":"OK"`) {
		t.Fatal("request logger must log only technical fields")
	}
}
