package entity

import "github.com/google/uuid"

type User struct {
	ID    int
	Email string
}

func (u *User) GetID() int {
	return u.ID
}

func (u *User) GetEmail() string {
	return u.Email
}

type RelChatUser struct {
	UserID int
	ChatID uuid.UUID
}
