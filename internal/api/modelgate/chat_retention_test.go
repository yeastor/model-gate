package modelgate

import (
	"context"
	"io"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

type retentionCheck bool

func (retentionCheck) ExpiredChatsAfter(context.Context, repository.ChatExpiry, int) ([]repository.ChatExpiry, error) {
	return nil, nil
}
func (c retentionCheck) IsExpiredChat(context.Context, repository.ChatExpiry) (bool, error) {
	return bool(c), nil
}

func TestPurgeExpiredChatRechecksExpiryAndRequiresRuntimeAck(t *testing.T) {
	api, chats, _, messages := accessAPI(accessAuth{})
	id, userID := uuid.New(), 42
	chats.chats[id] = &entity.Chat{ID: id, UserID: &userID}
	chat := repository.ChatExpiry{ID: id, UserID: userID}
	var calls atomic.Int32
	var confirm atomic.Bool
	secret := strings.Repeat("t", 32)
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/conversation/expire" || r.Header.Get("X-Category-Token") != secret {
			w.WriteHeader(403)
			return
		}
		if !confirm.Load() {
			w.WriteHeader(503)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer runtime.Close()
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", runtime.URL)
	t.Setenv("CATEGORY_INTERNAL_TOKEN", secret)
	ctx := context.Background()
	if err := api.purgeExpiredChat(ctx, retentionCheck(false), chat); err != nil || calls.Load() != 0 || messages.writes != 0 {
		t.Fatal("a renewed chat was touched")
	}
	if err := api.purgeExpiredChat(ctx, retentionCheck(true), chat); err == nil || messages.writes != 0 || chats.chats[id] == nil {
		t.Fatal("unconfirmed purge must be retried")
	}
	confirm.Store(true)
	if err := api.purgeExpiredChat(ctx, retentionCheck(true), chat); err != nil || messages.writes != 1 || chats.chats[id] != nil {
		t.Fatal("confirmed cleanup did not remove history and metadata")
	}
}
