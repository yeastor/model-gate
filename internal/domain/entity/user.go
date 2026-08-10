package entity

import "github.com/google/uuid"

type User struct {
	ID    int
	Email string
}

type RelChatUser struct {
	UserID int
	ChatID uuid.UUID
}
