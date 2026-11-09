package modelgate

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"model-gate/internal/domain/entity"
)

func TestManagementRequiresSessionOwnerAndConfirmation(t *testing.T) {
	owner, other := 5, 6
	for _, operation := range []string{"rename", "delete", "export"} {
		for _, test := range []struct {
			name   string
			cookie bool
			userID *int
			origin string
			code   int
		}{
			{"guest", false, &owner, "", 401},
			{"foreign", true, &other, "", 403},
			{"unowned", true, nil, "", 403},
			{"cross origin", true, &owner, "https://evil.example", 403},
		} {
			t.Run(operation+" "+test.name, func(t *testing.T) {
				api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
				id := uuid.New()
				chats.chats[id] = &entity.Chat{ID: id, UserID: test.userID, Name: "before"}
				mux := runtime.NewServeMux()
				if err := api.RegisterManagementHTTP(mux, "session"); err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest("POST", "http://chat.test/model/chat/"+operation,
					strings.NewReader(`{"id":"`+id.String()+`","name":"after","confirm":true}`))
				if test.cookie {
					request.Header.Set("Cookie", "session=verified-in-auth-stub")
				}
				request.Header.Set("Origin", test.origin)
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, request)
				if response.Code != test.code {
					t.Fatalf("expected %d, got %d", test.code, response.Code)
				}
				if chats.chats[id].Name != "before" || messages.reads+messages.writes != 0 {
					t.Fatal("unauthorized side effect")
				}
			})
		}
	}
}

func TestManagementRenameExportAndDelete(t *testing.T) {
	owner := 5
	api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
	id := uuid.New()
	chats.chats[id] = &entity.Chat{ID: id, UserID: &owner, Name: "before"}
	messages.exported = make([]*entity.Message, 35)
	for i := range messages.exported {
		messages.exported[i] = &entity.Message{Question: "question", Answer: "answer"}
	}
	mux := runtime.NewServeMux()
	if err := api.RegisterManagementHTTP(mux, "session"); err != nil {
		t.Fatal(err)
	}
	call := func(operation, body string, expected int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest("POST", "http://chat.test/model/chat/"+operation, strings.NewReader(body))
		request.Header.Set("Cookie", "session=verified-in-auth-stub")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != expected {
			t.Fatalf("%s: expected %d, got %d: %s", operation, expected, response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private data may be cached")
		}
		return response
	}
	for _, name := range []string{"", strings.Repeat("x", 101), "bad\nname"} {
		body, err := json.Marshal(managementRequest{ID: id.String(), Name: name})
		if err != nil {
			t.Fatal(err)
		}
		call("rename", string(body), 400)
	}
	call("rename", `{"id":"`+id.String()+`","name":"Renamed"}`, 200)
	if chats.chats[id].Name != "Renamed" {
		t.Fatal("name not persisted")
	}
	export := call("export", `{"id":"`+id.String()+`"}`, 200)
	var payload struct {
		Message []map[string]any `json:"message"`
	}
	if err := json.Unmarshal(export.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Message) != 70 {
		t.Fatal("export truncated to viewport history")
	}
	call("delete", `{"id":"`+id.String()+`"}`, 400)
	call("delete", `{"id":"`+id.String()+`","confirm":false}`, 400)
	if messages.writes != 0 {
		t.Fatal("deleted without confirmation")
	}
	messages.deleteErr = errors.New("clickhouse unavailable")
	call("delete", `{"id":"`+id.String()+`","confirm":true}`, 503)
	if chats.chats[id] == nil {
		t.Fatal("lost chat metadata after failed purge")
	}
	messages.deleteErr = nil
	call("delete", `{"id":"`+id.String()+`","confirm":true}`, 200)
	if chats.chats[id] != nil {
		t.Fatal("chat still exists")
	}
	call("export", `{"id":"`+id.String()+`"}`, 404)
	call("rename", `{"id":"`+id.String()+`","name":"Resurrect"}`, 404)
	call("delete", `{"id":"`+id.String()+`","confirm":true}`, 404)
	call("rename", `{"id":"invalid","name":"name"}`, 400)
	call("export", `{"id":"`+id.String()+`","user_id":6}`, 400)
}
