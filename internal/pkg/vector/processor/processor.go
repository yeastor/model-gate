package processor

import (
	"context"
)

type Question struct {
	Question   string
	VariantID  string
	CategoryID string
}

type PointId interface {
	String() string
}

type VectorAnswer interface {
	GetPayload() map[string]string
	GetScore() float32
	GetId() PointId
}

type Answer struct {
	payload map[string]string
	score   float32
	id      PointId
}

func (a Answer) GetPayload() map[string]string {
	return a.payload
}

func (a Answer) GetScore() float32 {
	return a.score
}

func (a Answer) GetId() PointId {
	return a.id
}

var _ VectorAnswer = (*Answer)(nil)

func NewAnswer(payload map[string]string, score float32, id PointId) *Answer {
	return &Answer{payload: payload, score: score, id: id}
}

type Processor interface {
	GetAnswer(ctx context.Context, question *Question) ([]VectorAnswer, error)
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
