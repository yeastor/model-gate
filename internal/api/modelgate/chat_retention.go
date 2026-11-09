package modelgate

import (
	"context"
	"log/slog"
	"model-gate/internal/domain/repository"
	"time"
)

// RunChatRetention removes expired state and history, then releases the metadata row.
// Until all steps succeed the expired row stays invisible and can be retried.
func (api *API) RunChatRetention(ctx context.Context, logger *slog.Logger) {
	const batchSize = 25
	store, ok := api.chatRepo.(repository.ChatRetentionRepository)
	if !ok {
		logger.Error("chat retention repository unavailable")
		return
	}
	var cursor repository.ChatExpiry
	for ctx.Err() == nil {
		readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		batch, err := store.ExpiredChatsAfter(readCtx, cursor, batchSize)
		cancel()
		if err != nil {
			logger.Warn("chat retention scan failed")
		}
		failures := 0
		for _, chat := range batch {
			if ctx.Err() != nil {
				return
			}
			itemCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := api.purgeExpiredChat(itemCtx, store, chat)
			cancel()
			if err != nil {
				failures++
			}
			cursor = chat
		}
		if failures > 0 {
			logger.Warn("chat retention cleanup pending retry", "count", failures)
		}
		if err == nil && len(batch) < batchSize {
			cursor = repository.ChatExpiry{}
		}
		timer := time.NewTimer(time.Minute)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (api *API) purgeExpiredChat(ctx context.Context, store repository.ChatRetentionRepository, chat repository.ChatExpiry) error {
	return api.chatRepo.WithChatLock(ctx, chat.ID, func(lockCtx context.Context) error {
		expired, err := store.IsExpiredChat(lockCtx, chat)
		if err != nil || !expired {
			return err
		}
		if err := removeConversationState(lockCtx, chat.ID, chat.UserID, "expire"); err != nil {
			return err
		}
		if err := api.messageListUseCase.DeleteMessages(lockCtx, chat.ID); err != nil {
			return err
		}
		return api.chatRepo.DeleteChat(lockCtx, chat.ID, chat.UserID)
	})
}
