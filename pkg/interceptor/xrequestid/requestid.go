package xrequestid

import (
	"context"

	"github.com/google/uuid"
	"google.golang.org/grpc/metadata"
)

const DefaultKey = "x-request-id"

func HandleRequestID(ctx context.Context, validator validator) string {
	mb, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return NewRequestID()
	}

	header, ok := mb[DefaultKey]
	if !ok {
		return NewRequestID()
	}

	requestID := header[0]
	if requestID == "" {
		return NewRequestID()
	}

	if !validator(requestID) {
		return NewRequestID()
	}

	return requestID
}

func NewRequestID() string {
	return uuid.NewString()
}
