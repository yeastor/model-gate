package logruswithrequestid

import (
	"context"
	"log/slog"
	"model-gate/config"
	"model-gate/pkg/dclogger"
	"model-gate/pkg/interceptor/xrequestid"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

const healthL = "/healthcheck.HealthCheckService/LivenessProbe"
const healthR = "/healthcheck.HealthCheckService/ReadinessProbe"

func UnaryServerInterceptor(cfg *config.Config) grpc.UnaryServerInterceptor {
	logLevel, err := cfg.GetLogLevel()
	if err != nil {
		panic("invalid request log level")
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	return requestLogger(logger)
}

func requestLogger(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		now := time.Now()
		xRequestID := xrequestid.FromContext(ctx)

		if info.FullMethod == healthL || info.FullMethod == healthR {
			return handler(ctx, req)
		}

		res, err := handler(ctx, req)
		level := slog.LevelInfo
		if err != nil {
			level = slog.LevelError
		}
		logger.Log(ctx, level, "handled request",
			dclogger.XRequestIDField, xRequestID,
			"method", info.FullMethod,
			"code", status.Code(err).String(),
			"duration_ms", time.Since(now).Milliseconds())

		return res, err
	}
}
