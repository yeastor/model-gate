package modelgate

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"model-gate/internal/domain/entity"
	"model-gate/internal/pkg/guided"
	"os"
	"strconv"
	"strings"
	"time"
)

func conversationRuntimeURL() string {
	if os.Getenv("CONVERSATION_STATE_V2") != "true" {
		return ""
	}
	return os.Getenv("APP_CONVERSATION_RUNTIME_URL")
}
func (api *API) deliverConversationHistory(ctx context.Context, base, userID, chatID string, e *guided.HistoryEnvelope) error {
	if e == nil {
		return nil
	}
	id, err := uuid.Parse(e.MessageID)
	if err != nil {
		return fmt.Errorf("invalid history identity")
	}
	chat, err := uuid.Parse(chatID)
	if err != nil {
		return err
	}
	at, err := time.Parse(time.RFC3339Nano, e.CreatedAt)
	if err != nil {
		return err
	}
	if err = api.addMessageUseCase.AddMessage(ctx, &entity.Message{ID: id, ChatID: chat, Question: e.Question, Answer: e.Answer, Category: e.Category, CreatedAt: at}); err != nil {
		return err
	}
	// A recovered turn uses its original timestamp, never the time history was read.
	if isUserMessage(e) {
		if err = api.chatRepo.RecordMessageActivity(ctx, chat, at); err != nil {
			return err
		}
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := categoryRuntimeCall(ctx, base, os.Getenv("CATEGORY_INTERNAL_TOKEN"), "/conversation/ack", map[string]string{"userId": userID, "id": chatID, "turnId": e.TurnID}, &ack); err != nil {
		return err
	}
	if !ack.OK {
		return fmt.Errorf("history acknowledgement missing")
	}
	return nil
}
func isUserMessage(e *guided.HistoryEnvelope) bool {
	if e.UserMessage != nil {
		return *e.UserMessage
	}
	// Older runtimes omit the flag and may persist a generated placeholder.
	return strings.TrimSpace(e.Question) != "" && e.Question != "Уточнение ситуации"
}
func (api *API) flushConversationHistory(ctx context.Context, chatID uuid.UUID, userID int) error {
	base := conversationRuntimeURL()
	if base == "" {
		return nil
	}
	trusted := strconv.Itoa(userID)
	var pending struct {
		Envelope *guided.HistoryEnvelope `json:"historyEnvelope"`
	}
	if err := categoryRuntimeCall(ctx, base, os.Getenv("CATEGORY_INTERNAL_TOKEN"), "/conversation/pending", map[string]string{"userId": trusted, "id": chatID.String()}, &pending); err != nil {
		return err
	}
	return api.deliverConversationHistory(ctx, base, trusted, chatID.String(), pending.Envelope)
}
func deleteConversationState(ctx context.Context, chatID uuid.UUID, userID int) error {
	if conversationRuntimeURL() == "" {
		return nil
	}
	return removeConversationState(ctx, chatID, userID, "delete")
}
func removeConversationState(ctx context.Context, chatID uuid.UUID, userID int, operation string) error {
	base := os.Getenv("APP_CONVERSATION_RUNTIME_URL")
	if base == "" {
		base = os.Getenv("APP_CATEGORY_RUNTIME_URL")
	}
	if base == "" {
		return nil
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := categoryRuntimeCall(ctx, base, os.Getenv("CATEGORY_INTERNAL_TOKEN"), "/conversation/"+operation, map[string]string{"userId": strconv.Itoa(userID), "id": chatID.String()}, &ack); err != nil {
		return err
	}
	if !ack.OK {
		return fmt.Errorf("state removal acknowledgement missing")
	}
	return nil
}
