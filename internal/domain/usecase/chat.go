package usecase

import (
	"context"
)

type Chat interface {
	Chat(ctx context.Context, question *Question) (*Answer, error)
}

type Question struct {
	Question string
}

type Answer struct {
	Content string
}
