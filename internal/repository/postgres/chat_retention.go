package postgres

import (
	"context"
	"model-gate/internal/domain/repository"
)

func (r *Repository) ExpiredChatsAfter(ctx context.Context, after repository.ChatExpiry, limit int) ([]repository.ChatExpiry, error) {
	rows, err := r.queries(ctx).Query(ctx, `SELECT id, user_id, expires_at FROM chat.chat
		WHERE user_id IS NOT NULL AND expires_at <= statement_timestamp() AND (expires_at, id) > ($1, $2)
		ORDER BY expires_at, id LIMIT $3`, after.ExpiresAt, after.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var chats []repository.ChatExpiry
	for rows.Next() {
		var chat repository.ChatExpiry
		if err := rows.Scan(&chat.ID, &chat.UserID, &chat.ExpiresAt); err != nil {
			return nil, err
		}
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

func (r *Repository) IsExpiredChat(ctx context.Context, chat repository.ChatExpiry) (bool, error) {
	var expired bool
	err := r.queries(ctx).QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chat.chat
		WHERE id = $1 AND user_id = $2 AND expires_at <= statement_timestamp())`, chat.ID, chat.UserID).Scan(&expired)
	return expired, err
}
