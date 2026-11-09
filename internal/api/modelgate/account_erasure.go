package modelgate

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
)

type erasureUsers interface {
	DisableErasedUser(context.Context, int) error
}

type erasureChats interface {
	ErasureChatIDs(context.Context, int) ([]uuid.UUID, error)
	OwnsErasureChat(context.Context, uuid.UUID, int) (bool, error)
}

func (api *API) RegisterAccountErasureHTTP(mux *runtime.ServeMux, token string) error {
	return mux.HandlePath(http.MethodPost, "/internal/account-erasure", func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		w.Header().Set("Cache-Control", "no-store")
		credentials := r.Header.Values("X-Account-Erasure-Token")
		if len(token) < 32 || len(credentials) != 1 || subtle.ConstantTimeCompare([]byte(credentials[0]), []byte(token)) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var input struct {
			UserID int32 `json:"userId"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || input.UserID <= 0 || decoder.Decode(new(any)) != io.EOF {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
		defer cancel()
		if err := api.eraseAccountChats(ctx, int(input.UserID)); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func (api *API) eraseAccountChats(ctx context.Context, userID int) error {
	users, userOK := api.userRepo.(erasureUsers)
	chats, chatOK := api.chatRepo.(erasureChats)
	if !userOK || !chatOK || api.messageListUseCase == nil {
		return errors.New("account erasure storage unavailable")
	}
	if err := users.DisableErasedUser(ctx, userID); err != nil {
		return err
	}
	ids, err := chats.ErasureChatIDs(ctx, userID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := api.chatRepo.WithChatLock(ctx, id, func(lockCtx context.Context) error {
			owned, err := chats.OwnsErasureChat(lockCtx, id, userID)
			if err != nil || !owned {
				return err
			}
			if os.Getenv("APP_CONVERSATION_RUNTIME_URL") == "" && os.Getenv("APP_CATEGORY_RUNTIME_URL") == "" {
				return errors.New("conversation erasure runtime unavailable")
			}
			if err := removeConversationState(lockCtx, id, userID, "expire"); err != nil {
				return err
			}
			if err := api.messageListUseCase.DeleteMessages(lockCtx, id); err != nil {
				return err
			}
			return api.chatRepo.DeleteChat(lockCtx, id, userID)
		}); err != nil {
			return err
		}
	}
	return nil
}
