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
	"strings"
	"unicode/utf8"
)

type guidedRequest struct {
	CategoryID string        `json:"categoryId,omitempty"`
	ID         string        `json:"id"`
	Question   string        `json:"question"`
	Guided     *guided.State `json:"guided,omitempty"`
	Resume     bool          `json:"resume,omitempty"`
}

// RegisterGuidedHTTP leaves the existing protobuf API unchanged.
func (api *API) RegisterGuidedHTTP(mux *runtime.ServeMux, cookieName string, engine *guided.Runtime) error {
	return mux.HandlePath(http.MethodPost, "/model/chat/guided", func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
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
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&request); err != nil {
			managementError(w, codes.InvalidArgument)
			return
		}
		if decoder.Decode(new(any)) != io.EOF {
			managementError(w, codes.InvalidArgument)
			return
		}
		id, err := uuid.Parse(request.ID)
		if err != nil || utf8.RuneCountInString(request.Question) > 10000 {
			managementError(w, codes.InvalidArgument)
			return
		}
		if engine == nil {
			managementError(w, codes.Unavailable)
			return
		}
		var response *guided.Response
		err = api.chatRepo.WithChatLock(ctx, id, func(lockCtx context.Context) error {
			chat, err := api.ownedChat(lockCtx, id, user.GetID())
			if err != nil {
				return err
			}
			response, err = engine.Respond(lockCtx, request.Question, request.Guided, request.CategoryID)
			if err != nil {
				return status.Error(codes.InvalidArgument, "invalid guided request or unavailable search")
			}
			if request.Resume {
				return nil
			}
			question := strings.TrimSpace(request.Question)
			if question == "" {
				question = "Уточнение ситуации"
			}
			if chat.Name == "New chat" {
				chat.Name = utils.GenerateChatName(question)
				if stage, ok := engine.Bundle.Stages[response.Guided.CategoryID+"."+response.Guided.StageID]; ok {
					chat.Name = stage.Name
				}
				if err = api.chatRepo.UpdateChat(lockCtx, chat); err != nil {
					return err
				}
			}
			content := response.Answer.Content
			if response.Status == "question" {
				content += "\n[Уточнение; выберите ответ в чате]"
			}
			if err = api.addMessageUseCase.AddMessage(lockCtx, entity.NewMessage(id, question, content, response.Answer.Category.ID)); err != nil {
				return err
			}
			return api.chatRepo.UpdateUpdatedAt(lockCtx, id)
		})
		if err != nil {
			managementError(w, status.Code(err))
			return
		}
		_ = json.NewEncoder(w).Encode(response)
	})
}
