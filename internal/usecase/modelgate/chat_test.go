package modelgate

import (
	"context"
	"errors"
	"log/slog"
	"model-gate/internal/domain/repository/mocks"
	"model-gate/internal/domain/stub"
	"os"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
)

func getLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))
}

func TestService_Create_Positive(t *testing.T) {
	ctx := context.Background()
	noteStub := stub.NewNote()

	repository := mocks.NewNote(t)

	repository.
		On("Create", ctx, noteStub).
		Return(nil)

	service := NewService(repository, getLogger())
	err := service.Create(ctx, noteStub)
	assert.NoError(t, err)
}

func TestService_Create_Negative(t *testing.T) {
	ctx := context.Background()
	noteStub := stub.NewNote()

	repository := mocks.NewNote(t)

	repository.
		On("Create", ctx, noteStub).
		Return(errors.New("repository error"))

	service := NewService(repository, getLogger())
	err := service.Create(ctx, noteStub)
	assert.Error(t, err)
}

func TestService_GetByUUID_Positive(t *testing.T) {
	ctx := context.Background()
	noteStub := stub.NewNote()

	repository := mocks.NewNote(t)

	repository.
		On("GetByUUID", ctx, noteStub.UUID).
		Return(noteStub, nil)

	service := NewService(repository, getLogger())
	mock, err := service.GetByUUID(ctx, noteStub.UUID)
	assert.NoError(t, err)
	assert.True(t, reflect.DeepEqual(mock, noteStub))
}

func TestService_GetByUUID_Negative(t *testing.T) {
	ctx := context.Background()
	noteStub := stub.NewNote()

	repository := mocks.NewNote(t)

	repository.
		On("GetByUUID", ctx, noteStub.UUID).
		Return(nil, errors.New("repository error"))

	service := NewService(repository, getLogger())
	mock, err := service.GetByUUID(ctx, noteStub.UUID)
	assert.Error(t, err)
	assert.Nil(t, mock)
}
