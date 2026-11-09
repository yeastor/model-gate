package modelgate

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"model-gate/internal/api/middleware"
	"model-gate/internal/domain/entity"
	"model-gate/internal/pkg/guided"
	"model-gate/pkg/utils"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"
)

type guidedRequest struct {
	feedbackTranscript json.RawMessage
	ProtocolVersion    int             `json:"protocolVersion,omitempty"`
	TurnID             string          `json:"turnId,omitempty"`
	Conversation       json.RawMessage `json:"conversation,omitempty"`
	LaunchHint         json.RawMessage `json:"launchHint,omitempty"`
	Mode               string          `json:"mode,omitempty"`
	CategoryID         string          `json:"categoryId,omitempty"`
	VariantID          string          `json:"variantId,omitempty"`
	ID                 string          `json:"id"`
	Question           string          `json:"question"`
	Guided             *guided.State   `json:"guided,omitempty"`
	Resume             bool            `json:"resume,omitempty"`
}

// RegisterGuidedHTTP leaves the existing protobuf API unchanged.
func (api *API) RegisterGuidedHTTP(mux *runtime.ServeMux, cookieName string, engine *guided.Runtime) error {
	handler := func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			managementError(w, codes.PermissionDenied)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
				managementError(w, codes.PermissionDenied)
				return
			}
		}
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			managementError(w, codes.Unauthenticated)
			return
		}
		ctx := middleware.SetAuthCookie(r.Context(), cookie.Value)
		user, err := api.authenticatedUser(ctx)
		if err != nil {
			managementError(w, status.Code(err))
			return
		}
		var request guidedRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&request); err != nil {
			managementError(w, codes.InvalidArgument)
			return
		}
		if decoder.Decode(new(any)) != io.EOF {
			managementError(w, codes.InvalidArgument)
			return
		}
		request.Mode = ""
		if r.URL.Path == "/model/chat/conversation" {
			request.Mode = "chat"
		}
		id, err := uuid.Parse(request.ID)
		if err != nil || utf8.RuneCountInString(request.Question) > 10000 {
			managementError(w, codes.InvalidArgument)
			return
		}
		bundleURL := os.Getenv("APP_CATEGORY_RUNTIME_URL")
		if request.ProtocolVersion == 2 {
			bundleURL = conversationRuntimeURL()
			if bundleURL == "" {
				managementError(w, codes.Unavailable)
				return
			}
			if !request.Resume {
				if _, err := uuid.Parse(request.TurnID); err != nil {
					managementError(w, codes.InvalidArgument)
					return
				}
			}
		} else if request.ProtocolVersion != 0 {
			managementError(w, codes.InvalidArgument)
			return
		}
		if engine == nil && bundleURL == "" {
			managementError(w, codes.Unavailable)
			return
		}
		var response *guided.Response
		err = api.chatRepo.WithChatLock(ctx, id, func(lockCtx context.Context) error {
			chat, err := api.ownedChat(lockCtx, id, user.GetID())
			if err != nil {
				return err
			}
			if request.ProtocolVersion == 2 {
				if err = api.flushConversationHistory(lockCtx, id, user.GetID()); err != nil {
					return err
				}
			}
			if request.ProtocolVersion == 2 && request.Guided != nil {
				var action struct {
					Kind string `json:"kind"`
				}
				if err := json.Unmarshal(request.Guided.Native, &action); err == nil && action.Kind == "submit_feedback" {
					messages, err := api.messageListUseCase.ExportMessages(lockCtx, id)
					if err != nil {
						return err
					}
					transcript := make([]map[string]any, 0, len(messages)*2)
					for _, message := range messages {
						if message.Question != "" {
							transcript = append(transcript, map[string]any{"text": message.Question, "direction": 1})
						}
						if message.Answer != "" {
							transcript = append(transcript, map[string]any{"text": message.Answer, "direction": 2})
						}
					}
					request.feedbackTranscript, err = json.Marshal(transcript)
					if err != nil {
						return err
					}
				}
			}
			if bundleURL != "" {
				response, err = bundleResponse(lockCtx, bundleURL, os.Getenv("CATEGORY_INTERNAL_TOKEN"), strconv.Itoa(user.GetID()), request)
			} else {
				response, err = engine.RespondFromEntry(lockCtx, request.Question, request.Guided, request.CategoryID, request.VariantID)
			}
			if err != nil {
				return err
			}
			if request.ProtocolVersion == 2 {
				if err = api.deliverConversationHistory(lockCtx, bundleURL, strconv.Itoa(user.GetID()), request.ID, response.HistoryEnvelope); err != nil {
					return err
				}
				response.HistoryEnvelope = nil
				if request.Resume {
					return nil
				}
			} else if request.Resume {
				return nil
			}
			question := strings.TrimSpace(request.Question)
			if question == "" {
				question = "Уточнение ситуации"
			}
			if chat.Name == "New chat" {
				chat.Name = utils.GenerateChatName(question)
				if engine != nil {
					if stage, ok := engine.Bundle.Stages[response.Guided.CategoryID+"."+response.Guided.StageID]; ok {
						chat.Name = stage.Name
					}
				}
				if err = api.chatRepo.UpdateChat(lockCtx, chat); err != nil {
					return err
				}
			}
			content := response.Answer.Content
			if response.Status == "question" {
				content += "\n[Уточнение; выберите ответ в чате]"
			}
			if request.ProtocolVersion != 2 {
				message := entity.NewMessage(id, question, content, response.Answer.Category.ID)
				if err = api.addMessageUseCase.AddMessage(lockCtx, message); err != nil {
					return err
				}
				if strings.TrimSpace(request.Question) != "" {
					return api.chatRepo.RecordMessageActivity(lockCtx, id, message.CreatedAt)
				}
			}
			return nil
		})
		if err != nil {
			managementError(w, status.Code(err))
			return
		}
		_ = json.NewEncoder(w).Encode(response)
	}
	for _, route := range []string{"/model/chat/guided", "/model/chat/conversation"} {
		if err := mux.HandlePath(http.MethodPost, route, handler); err != nil {
			return err
		}
	}
	return nil
}
