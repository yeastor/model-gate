package processor

import (
	"context"
)

const ChatMethodPath = "api/chat"

type Question struct {
	Question string
}

type Answer struct {
	Content string
}

type Processor interface {
	GetAnswer(ctx context.Context, question *Question) (*Answer, error)
}

type Logger interface {
	Debug(msg string, args ...any)
	DebugContext(ctx context.Context, msg string, args ...any)
	Info(msg string, args ...any)
	InfoContext(ctx context.Context, msg string, args ...any)
	Warn(msg string, args ...any)
	WarnContext(ctx context.Context, msg string, args ...any)
	Error(msg string, args ...any)
	ErrorContext(ctx context.Context, msg string, args ...any)
}
