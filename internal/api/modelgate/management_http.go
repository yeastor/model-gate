package modelgate

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"model-gate/internal/api/middleware"
)

type managementRequest struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Confirm bool   `json:"confirm"`
}

// Management uses the same principal and owner checks as the gRPC chat methods.
// These native HTTP routes avoid changing the existing protobuf contract.
func (api *API) RegisterManagementHTTP(mux *runtime.ServeMux, cookieName string) error {
	for _, operation := range []string{"rename", "delete", "export"} {
		if err := mux.HandlePath(http.MethodPost, "/model/chat/"+operation,
			func(w http.ResponseWriter, r *http.Request, _ map[string]string) {
				api.handleManagement(w, r, cookieName, operation)
			}); err != nil {
			return err
		}
	}
	return nil
}

func (api *API) handleManagement(w http.ResponseWriter, r *http.Request, cookieName, operation string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		managementError(w, codes.PermissionDenied)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host != r.Host || (parsed.Scheme != "http" && parsed.Scheme != "https") {
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
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	decoder.DisallowUnknownFields()
	var request managementRequest
	if err := decoder.Decode(&request); err != nil {
		managementError(w, codes.InvalidArgument)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		managementError(w, codes.InvalidArgument)
		return
	}
	id, err := uuid.Parse(request.ID)
	if err != nil {
		managementError(w, codes.InvalidArgument)
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	if operation == "rename" && (request.Name == "" || utf8.RuneCountInString(request.Name) > 100 || strings.ContainsFunc(request.Name, unicode.IsControl)) {
		managementError(w, codes.InvalidArgument)
		return
	}
	if operation == "delete" && !request.Confirm {
		managementError(w, codes.InvalidArgument)
		return
	}
	var response any = map[string]bool{"ok": true}
	err = api.chatRepo.WithChatLock(ctx, id, func(lockCtx context.Context) error {
		chat, err := api.ownedChat(lockCtx, id, user.GetID())
		if err != nil {
			return err
		}
		switch operation {
		case "rename":
			chat.Name = request.Name
			if err := api.chatRepo.UpdateChat(lockCtx, chat); err != nil {
				return err
			}
		case "delete":
			if err := api.messageListUseCase.DeleteMessages(lockCtx, id); err != nil {
				return err
			}
			if err := api.chatRepo.DeleteChat(lockCtx, id, user.GetID()); err != nil {
				return err
			}
		case "export":
			messages, err := api.messageListUseCase.ExportMessages(lockCtx, id)
			if err != nil {
				return err
			}
			items := make([]map[string]any, 0, len(messages)*2)
			for _, message := range messages {
				items = append(items, map[string]any{"text": message.Question, "direction": 1})
				items = append(items, map[string]any{"text": message.Answer, "direction": 2})
			}
			response = map[string]any{"chat": map[string]string{"id": id.String(), "name": chat.Name}, "message": items}
		}
		return nil
	})
	if err != nil {
		managementError(w, status.Code(err))
		return
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		return
	}
}

func managementError(w http.ResponseWriter, code codes.Code) {
	httpCode := runtime.HTTPStatusFromCode(code)
	if code == codes.Unknown {
		httpCode = http.StatusServiceUnavailable
	}
	w.WriteHeader(httpCode)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "code": code.String()})
}
