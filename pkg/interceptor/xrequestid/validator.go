package xrequestid

import "github.com/google/uuid"

type validator func(string) bool

func DefaultValidator(xRequestID string) bool {
	id, err := uuid.Parse(xRequestID)
	return err == nil && id.String() == xRequestID
}
