package modelgate

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"model-gate/internal/domain/entity"
	"model-gate/internal/pkg/guided"
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
