package usecase

import (
	"context"
)

type Chat interface {
	Chat(ctx context.Context, question *Question) (*Answer, error)
}

type Vector interface {
	Search(ctx context.Context, question *Question) (*Answer, error)
}

type Question struct {
	Question string
}

type View struct {
	Type     string
	ID       string
	Value    string
	Question string
}

type Next struct {
	QuestionText string
	View         []View
}

type Answer struct {
	Content string
	Next    []Next
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
