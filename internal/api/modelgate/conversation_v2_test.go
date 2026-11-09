package modelgate

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/status"
	"model-gate/internal/domain/entity"
	"model-gate/internal/pkg/guided"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConversationV2HistoryRetryAndPublicEnvelope(t *testing.T) {
	owner := 5
	chatID := uuid.New()
	turnID := uuid.NewString()
	messageID := uuid.NewString()
	pending := true
	respondCalls, ackCalls := 0, 0
	envelope := &guided.HistoryEnvelope{TurnID: turnID, MessageID: messageID, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Question: "question", Answer: "actual delivered answer", Category: "pps"}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Category-Token") != strings.Repeat("x", 32) {
			t.Error("missing internal auth")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/conversation/pending":
			var e *guided.HistoryEnvelope
			if pending {
				e = envelope
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"historyEnvelope": e})
		case "/conversation/ack":
			ackCalls++
			pending = false
			_, _ = w.Write([]byte("{\"ok\":true}"))
		case "/respond":
			respondCalls++
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "answer", "conversation": map[string]any{"sessionId": "s", "revision": 1}, "presentation": map[string]any{"responseId": "stable", "kind": "full"}, "turn": map[string]any{"turnId": turnID, "messageId": messageID}, "answer": map[string]any{"content": "actual delivered answer", "category": map[string]string{"id": "pps"}}})
		default:
			t.Error("unexpected runtime route")
		}
	}))
	defer backend.Close()
	t.Setenv("CONVERSATION_STATE_V2", "true")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", backend.URL)
	t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("x", 32))
	api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
	chats.chats[chatID] = &entity.Chat{ID: chatID, UserID: &owner, Name: "existing"}
	mux := runtime.NewServeMux()
	if err := api.RegisterGuidedHTTP(mux, "session", nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		body, _ := json.Marshal(map[string]any{"protocolVersion": 2, "id": chatID.String(), "turnId": turnID, "question": "question", "guided": map[string]any{"context": map[string]any{}, "conversation": map[string]any{"sessionId": "s", "revision": 1}}})
		req := httptest.NewRequest("POST", "http://chat.test/model/chat/conversation", strings.NewReader(string(body)))
		req.Header.Set("Cookie", "session=auth-stub")
		result := httptest.NewRecorder()
		mux.ServeHTTP(result, req)
		if result.Code != 200 {
			t.Fatalf("%d %s", result.Code, result.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response["presentation"] == nil || response["conversation"] == nil || response["_historyEnvelope"] != nil {
			t.Fatalf("transport lost metadata/leaked envelope: %s", result.Body.String())
		}
	}
	if messages.writes != 1 || ackCalls != 1 || respondCalls != 2 {
		t.Fatalf("writes=%d ack=%d respond=%d", messages.writes, ackCalls, respondCalls)
	}
}

func TestConversationV2RejectsForeignBeforeRuntime(t *testing.T) {
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer backend.Close()
	t.Setenv("CONVERSATION_STATE_V2", "true")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", backend.URL)
	t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("x", 32))
	owner, foreign := 5, 6
	api, chats, _, _ := accessAPI(accessAuth{user: &entity.User{ID: owner}})
	id := uuid.New()
	chats.chats[id] = &entity.Chat{ID: id, UserID: &foreign}
	mux := runtime.NewServeMux()
	_ = api.RegisterGuidedHTTP(mux, "session", nil)
	req := httptest.NewRequest("POST", "http://chat.test/model/chat/conversation", strings.NewReader("{\"protocolVersion\":2,\"id\":\""+id.String()+"\",\"turnId\":\""+uuid.NewString()+"\",\"question\":\"test\"}"))
	req.Header.Set("Cookie", "session=auth-stub")
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != 403 || calls != 0 {
		t.Fatalf("code=%d runtime=%d", res.Code, calls)
	}
}
func TestCategoryV2PreservesConflictAndUnavailable(t *testing.T) {
	for _, code := range []int{409, 503} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code)
				_, _ = w.Write([]byte("{\"error\":\"STALE_STATE\"}"))
			}))
			defer backend.Close()
			err := categoryRuntimeCall(t.Context(), backend.URL, strings.Repeat("x", 32), "/respond", map[string]string{}, &map[string]any{})
			if err == nil || runtime.HTTPStatusFromCode(status.Code(err)) != code {
				t.Fatalf("incorrect status: %v", err)
			}
		})
	}
}

type deduplicatingMessages struct {
	seen     map[uuid.UUID]bool
	attempts int
}

func (m *deduplicatingMessages) AddMessage(_ context.Context, e *entity.Message) error {
	m.attempts++
	m.seen[e.ID] = true
	return nil
}
func TestConversationV2RecoversLostHistoryAck(t *testing.T) {
	owner := 5
	id := uuid.New()
	turn := uuid.NewString()
	pending := false
	acks := 0
	env := &guided.HistoryEnvelope{TurnID: turn, MessageID: uuid.NewString(), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Question: "q", Answer: "a", Category: "pps"}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/conversation/pending":
			var e *guided.HistoryEnvelope
			if pending {
				e = env
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"historyEnvelope": e})
		case "/conversation/ack":
			acks++
			if acks == 1 {
				w.WriteHeader(503)
				return
			}
			pending = false
			_, _ = w.Write([]byte("{\"ok\":true}"))
		case "/respond":
			pending = true
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "answer", "answer": map[string]any{"content": "a", "category": map[string]string{"id": "pps"}}, "_historyEnvelope": env})
		}
	}))
	defer backend.Close()
	t.Setenv("CONVERSATION_STATE_V2", "true")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", backend.URL)
	t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("x", 32))
	api, chats, _, _ := accessAPI(accessAuth{user: &entity.User{ID: owner}})
	chats.chats[id] = &entity.Chat{ID: id, UserID: &owner, Name: "existing"}
	messages := &deduplicatingMessages{seen: map[uuid.UUID]bool{}}
	api.addMessageUseCase = messages
	mux := runtime.NewServeMux()
	_ = api.RegisterGuidedHTTP(mux, "session", nil)
	for i, expected := range []int{503, 200} {
		req := httptest.NewRequest("POST", "http://chat.test/model/chat/conversation", strings.NewReader("{\"protocolVersion\":2,\"id\":\""+id.String()+"\",\"turnId\":\""+turn+"\",\"question\":\"q\"}"))
		req.Header.Set("Cookie", "session=auth-stub")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != expected {
			t.Fatalf("attempt %d expected %d got %d: %s", i, expected, res.Code, res.Body.String())
		}
	}
	if len(messages.seen) != 1 {
		t.Fatal("duplicate visible message")
	}
}
