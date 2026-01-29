package http

import "context"

type EmptyLogger struct {
}

func NewEmptyLogger() *EmptyLogger {
	return &EmptyLogger{}
}

func (logger *EmptyLogger) DebugContext(ctx context.Context, msg string, args ...any) {

}

func (logger *EmptyLogger) Debug(message string, args ...any) {

}

func (logger *EmptyLogger) InfoContext(ctx context.Context, msg string, args ...any) {

}

func (logger *EmptyLogger) Info(message string, args ...any) {

}

func (logger *EmptyLogger) Error(message string, args ...any) {

}

func (logger *EmptyLogger) ErrorContext(ctx context.Context, msg string, args ...any) {

}

func (logger *EmptyLogger) Warn(message string, args ...any) {

}

func (logger *EmptyLogger) WarnContext(ctx context.Context, msg string, args ...any) {

}

var _ Logger = (*EmptyLogger)(nil)
