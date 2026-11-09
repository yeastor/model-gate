package postgres

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) ErasureChatIDs(ctx context.Context, userID int) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, "SELECT id FROM chat.chat WHERE user_id=$1 ORDER BY id", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *Repository) OwnsErasureChat(ctx context.Context, id uuid.UUID, userID int) (bool, error) {
	var owned bool
	err := r.queries(ctx).QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM chat.chat WHERE id=$1 AND user_id=$2)", id, userID).Scan(&owned)
	return owned, err
}
