package dclogger

import (
	"context"
	"log/slog"
)

const XRequestIDField = "requestId"

type DcLogger interface {
	Debug(msg string, args ...any)
	DebugContext(ctx context.Context, msg string, args ...any)
	Info(msg string, args ...any)
	InfoContext(ctx context.Context, msg string, args ...any)
	Warn(msg string, args ...any)
	WarnContext(ctx context.Context, msg string, args ...any)
	Error(msg string, args ...any)
	ErrorContext(ctx context.Context, msg string, args ...any)
}

type Logger struct{}

func NewLogger(logHandler slog.Handler) DcLogger {
	return slog.New(logHandler)
}
