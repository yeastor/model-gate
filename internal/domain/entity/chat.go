package entity

import (
	"time"

	"github.com/google/uuid"
)

type Chat struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
}

type Message struct {
	ID        uuid.UUID
	ChatID    uuid.UUID
	Question  string
	Answer    string
	CreatedAt time.Time
}

func NewMessage(chatID uuid.UUID, question string, answer string) *Message {
	return &Message{
		ID:        uuid.New(),
		CreatedAt: time.Now(),
		ChatID:    chatID, Question: question, Answer: answer}
}

type Answer struct {
	Content string
}

type Question struct {
	ChatID   uuid.UUID
	Question string
}
