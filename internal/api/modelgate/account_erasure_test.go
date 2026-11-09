package modelgate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"model-gate/internal/domain/entity"
)

type erasureTestUsers struct {
	accessUsers
	disabled []int
}

func (r *erasureTestUsers) DisableErasedUser(_ context.Context, id int) error {
	r.disabled = append(r.disabled, id)
	return nil
}

type erasureTestChats struct{ accessChats }

func (r *erasureTestChats) ErasureChatIDs(_ context.Context, owner int) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	for id, chat := range r.chats {
		if chat.UserID != nil && *chat.UserID == owner {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (r *erasureTestChats) OwnsErasureChat(_ context.Context, id uuid.UUID, owner int) (bool, error) {
	chat := r.chats[id]
	return chat != nil && chat.UserID != nil && *chat.UserID == owner, nil
}

type erasureTestMessages struct {
	accessMessages
	deleted []uuid.UUID
}

func (r *erasureTestMessages) DeleteMessages(_ context.Context, id uuid.UUID) error {
	r.deleted = append(r.deleted, id)
	return nil
}

func TestAccountErasureRequiresMachineTokenAndRuntimeAcknowledgement(t *testing.T) {
	owner, other := 7, 8
	ownedID, otherID := uuid.New(), uuid.New()
	users := &erasureTestUsers{}
	chats := &erasureTestChats{accessChats{chats: map[uuid.UUID]*entity.Chat{
		ownedID: {ID: ownedID, UserID: &owner},
		otherID: {ID: otherID, UserID: &other},
	}}}
	messages := &erasureTestMessages{}
	api := &API{userRepo: users, chatRepo: chats, messageListUseCase: messages}
	mux := runtime.NewServeMux()
	token := strings.Repeat("e", 32)
	if err := api.RegisterAccountErasureHTTP(mux, token); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_CATEGORY_RUNTIME_URL", "")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", "")
	t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("r", 32))
	call := func(credential, body string) int {
		r := httptest.NewRequest(http.MethodPost, "/internal/account-erasure", strings.NewReader(body))
		if credential != "" {
			r.Header.Set("X-Account-Erasure-Token", credential)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w.Code
	}
	const body = `{"userId":7}`
	if call("", body) != http.StatusUnauthorized || call(token, `{"userId":7,"other":8}`) != http.StatusBadRequest || len(users.disabled) != 0 {
		t.Fatal("bad credentials or body reached storage")
	}
	if call(token, body) != http.StatusServiceUnavailable || len(messages.deleted) != 0 || chats.chats[ownedID] == nil {
		t.Fatal("missing runtime was treated as completed")
	}
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/conversation/expire" || r.Header.Get("X-Category-Token") != strings.Repeat("r", 32) {
			t.Error("unexpected runtime request")
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer peer.Close()
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", peer.URL)
	if call(token, body) != http.StatusNoContent || call(token, body) != http.StatusNoContent {
		t.Fatal("erasure not retryable")
	}
	if len(messages.deleted) != 1 || messages.deleted[0] != ownedID || chats.chats[ownedID] != nil || chats.chats[otherID] == nil {
		t.Fatal("erasure reached the wrong chat")
	}
}
