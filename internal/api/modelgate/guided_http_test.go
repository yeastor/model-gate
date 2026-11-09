package modelgate

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"model-gate/internal/domain/entity"
	formatted "model-gate/internal/pkg/formater/answer"
	"model-gate/internal/pkg/guided"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGuidedHTTPRequiresOwnerAndRestoresWithoutWriting(t *testing.T) {
	engine, err := guided.Load("../../../data/guided-runtime.json", nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	owner, other := 5, 6
	for _, test := range []struct {
		name   string
		cookie bool
		owner  *int
		origin string
		resume bool
		code   int
	}{
		{"guest", false, &owner, "", false, 401}, {"foreign", true, &other, "", false, 403},
		{"unowned", true, nil, "", false, 403}, {"cross origin", true, &owner, "https://other.test", false, 403},
		{"owner", true, &owner, "", false, 200}, {"resume", true, &owner, "", true, 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
			id := uuid.New()
			chats.chats[id] = &entity.Chat{ID: id, UserID: test.owner, Name: "before"}
			mux := runtime.NewServeMux()
			if err := api.RegisterGuidedHTTP(mux, "session", engine); err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(guidedRequest{ID: id.String(), Question: "Начать", Guided: &guided.State{CategoryID: "dps", StageID: "protocol"}, Resume: test.resume})
			request := httptest.NewRequest("POST", "http://chat.test/model/chat/guided", strings.NewReader(string(body)))
			if test.cookie {
				request.Header.Set("Cookie", "session=verified-in-auth-stub")
			}
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != test.code {
				t.Fatalf("expected %d got %d: %s", test.code, response.Code, response.Body.String())
			}
			expectedWrites := 0
			if test.code == 200 && !test.resume {
				expectedWrites = 1
			}
			if messages.writes != expectedWrites {
				t.Fatalf("writes %d expected %d", messages.writes, expectedWrites)
			}
		})
	}
}

func TestGuidedHTTPArticleEntryAndResume(t *testing.T) {
	engine := &guided.Runtime{Bundle: guided.Bundle{
		Version:    strings.Repeat("b", 64),
		Categories: []formatted.Category{{ID: "article", Name: "Article category"}},
		Rows: map[string]formatted.Payload{
			"article_variant": {Category: formatted.Category{ID: "article"}, Stage: formatted.Stage{ID: "stage"}},
		},
		Stages: map[string]guided.Stage{
			"article.stage": {CategoryID: "article", StageID: "stage", Name: "Article situation", Nodes: map[string]guided.Node{
				"": {Status: "question", Question: "Confirm the circumstance?", Field: "fact"},
			}},
		},
	}}
	for _, test := range []struct {
		name      string
		variantID string
		resume    bool
		status    string
	}{
		{"initial entry", "article_variant", false, "question"},
		{"restore controls", "article_variant", true, "question"},
		{"unavailable entry", "missing", false, "entry_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			owner := 5
			api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
			id := uuid.New()
			chats.chats[id] = &entity.Chat{ID: id, UserID: &owner, Name: "New chat"}
			mux := runtime.NewServeMux()
			if err := api.RegisterGuidedHTTP(mux, "session", engine); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(guidedRequest{ID: id.String(), Question: "Article title", CategoryID: "wrong-category", VariantID: test.variantID, Resume: test.resume})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "http://chat.test/model/chat/guided", strings.NewReader(string(body)))
			request.Header.Set("Cookie", "session=verified-in-auth-stub")
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != 200 {
				t.Fatalf("entry request failed: %d %s", response.Code, response.Body.String())
			}
			var result guided.Response
			if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Status != test.status || len(result.Guided.Context) != 0 || result.Answer.VariantID != "" {
				t.Fatalf("entry response did not ask before advice: %+v", result)
			}
			if test.status == "question" && (result.Guided.EntryVariantID != test.variantID || result.Guided.CategoryID != "article") {
				t.Fatalf("HTTP contract lost exact entry: %+v", result.Guided)
			}
			expectedWrites := 1
			if test.resume {
				expectedWrites = 0
			}
			if messages.writes != expectedWrites {
				t.Fatalf("history writes: got %d want %d", messages.writes, expectedWrites)
			}
		})
	}
}

func TestConversationRouteUsesNormalModeAndChecksOwnership(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "owner", true: "foreign"}[foreign], func(t *testing.T) {
			called := false
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body["mode"] != "chat" {
					t.Errorf("normal route mode = %v", body["mode"])
				}
				json.NewEncoder(w).Encode(guided.Response{Status: "answer", Answer: guided.Answer{Content: "Normal answer", Category: formatted.Category{ID: "pps"}, Next: []guided.Next{}}})
			}))
			defer backend.Close()
			t.Setenv("APP_CATEGORY_RUNTIME_URL", backend.URL)
			t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("x", 32))
			owner, other := 5, 6
			api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
			id := uuid.New()
			chatOwner := &owner
			if foreign {
				chatOwner = &other
			}
			chats.chats[id] = &entity.Chat{ID: id, UserID: chatOwner, Name: "Article title"}
			mux := runtime.NewServeMux()
			if err := api.RegisterGuidedHTTP(mux, "session", nil); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "http://chat.test/model/chat/conversation", strings.NewReader(`{"id":"`+id.String()+`","question":"New question"}`))
			req.Header.Set("Cookie", "session=verified-in-auth-stub")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			expected := 200
			if foreign {
				expected = 403
			}
			if rec.Code != expected {
				t.Fatalf("HTTP %d: %s", rec.Code, rec.Body.String())
			}
			if foreign && (called || messages.writes != 0) {
				t.Fatal("foreign chat reached runtime or wrote history")
			}
			if !foreign && (!called || messages.writes != 1 || chats.chats[id].Name != "Article title") {
				t.Fatal("normal turn lost history or existing article title")
			}
		})
	}
}
