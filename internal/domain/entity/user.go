package entity

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
