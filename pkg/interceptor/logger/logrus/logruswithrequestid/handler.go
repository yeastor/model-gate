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
)

const healthL = "/healthcheck.HealthCheckService/LivenessProbe"
const healthR = "/healthcheck.HealthCheckService/ReadinessProbe"

func UnaryServerInterceptor(cfg *config.Config) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		now := time.Now()
		xRequestID := xrequestid.FromContext(ctx)

		logLevel, err := cfg.GetLogLevel()
		if err != nil {
			panic("Failed to get log level" + err.Error())
		}

		logHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level: logLevel,
		})
		logger := slog.New(logHandler)

		if info.FullMethod == healthL || info.FullMethod == healthR {
			return handler(ctx, req)
		}

		res, err := handler(ctx, req)
		if err != nil {
			logger.Error(err.Error(),
				dclogger.XRequestIDField, xRequestID,
				"method", info.FullMethod,
				"req", req,
				"res", res,
				"duration", time.Since(now).Seconds())
		} else {
			logger.Info("Handled request",
				dclogger.XRequestIDField, xRequestID,
				"method", info.FullMethod,
				"req", req,
				"res", res,
				"duration", time.Since(now).Seconds())
		}

		return res, err
	}
}
