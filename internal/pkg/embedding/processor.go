package embedding

import "context"

type Processor interface {
	GetEmbedding(ctx context.Context, question *EmbQuestion) (*EmbAnswer, error)
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

type SearchResult interface {
}

type EmbQuestion struct {
	Question string
}

type EmbAnswer struct {
	Vector []float32
}

type Options interface {
	GetEmbeddingUrl() string
}
