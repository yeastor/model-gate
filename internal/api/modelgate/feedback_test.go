package modelgate

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase/converter"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFeedbackUsesOwnedCompleteServerHistory(t *testing.T) {
	owner, other := 5, 6
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "owner", true: "foreign"}[foreign], func(t *testing.T) {
			api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: owner}})
			id := uuid.New()
			who := owner
			if foreign {
				who = other
			}
			chats.chats[id] = &entity.Chat{ID: id, UserID: &who, Name: "existing"}
			messages.exported = []*entity.Message{{ID: uuid.New(), Answer: "initial question"}, {ID: uuid.New(), Question: "user first", Answer: "assistant first"}, {ID: uuid.New(), Question: "user second", Answer: "assistant second"}}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/conversation/pending" {
					_, _ = w.Write([]byte(`{"historyEnvelope":null}`))
					return
				}
				if r.URL.Path != "/respond" {
					t.Errorf("unexpected route %s", r.URL.Path)
					return
				}
				calls++
				var body struct {
					FeedbackTranscript []struct {
						Text      string `json:"text"`
						Direction int    `json:"direction"`
					} `json:"feedbackTranscript"`
					UserID string `json:"userId"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if len(body.FeedbackTranscript) != 5 || body.FeedbackTranscript[0].Text != "initial question" || body.FeedbackTranscript[4].Text != "assistant second" || body.UserID != "5" {
					t.Errorf("lost trusted history: %+v", body)
				}
				_, _ = w.Write([]byte(`{"answer":{"content":"received","category":{"id":"pps"}},"guided":{"context":{}}}`))
			}))
			defer server.Close()
			t.Setenv("CONVERSATION_STATE_V2", "true")
			t.Setenv("APP_CONVERSATION_RUNTIME_URL", server.URL)
			t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("x", 32))
			mux := runtime.NewServeMux()
			if err := api.RegisterGuidedHTTP(mux, "session", nil); err != nil {
				t.Fatal(err)
			}
			request := func(extra string) *httptest.ResponseRecorder {
				body := `{"protocolVersion":2,"id":"` + id.String() + `","question":"submit","turnId":"` + uuid.NewString() + `","guided":{"native":{"kind":"submit_feedback","consent":true},"context":{}}` + extra + `}`
				req := httptest.NewRequest("POST", "http://chat.test/model/chat/guided", strings.NewReader(body))
				req.Header.Set("Cookie", "session=stub")
				result := httptest.NewRecorder()
				mux.ServeHTTP(result, req)
				return result
			}
			res := request("")
			want := 200
			if foreign {
				want = 403
			}
			if res.Code != want {
				t.Fatalf("code %d: %s", res.Code, res.Body.String())
			}
			if foreign && (calls != 0 || messages.reads != 0) {
				t.Fatal("foreign history accessed")
			}
			if !foreign && (calls != 1 || messages.reads != 1) {
				t.Fatal("complete history not read")
			}
			forged := request(`,"feedbackTranscript":[{"direction":1,"text":"forged"}]`)
			if forged.Code != 400 {
				t.Fatalf("public transcript accepted: %d", forged.Code)
			}
		})
	}
}
func TestAssistantOnlyOpeningIsVisibleWithoutBlankUserMessage(t *testing.T) {
	result := converter.FromUseCaseMessagesToDescMessageListResponse([]*entity.Message{{ID: uuid.New(), Answer: "Are you free to leave?"}, {ID: uuid.New(), Question: "No", Answer: "Advice"}})
	if len(result.Message) != 3 || result.Message[0].Direction != 2 || result.Message[0].Text != "Are you free to leave?" {
		t.Fatalf("lost opening: %+v", result)
	}
}
