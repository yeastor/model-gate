package postgres

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"

	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

func (r *UserRepository) CreateUser(ctx context.Context, user *entity.User) error {
	query := `
		INSERT INTO chat.user (id, email)
		VALUES ($1, $2)
	`

	_, err := r.pool.Exec(ctx, query, user.ID, user.Email)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (r *UserRepository) UserExists(ctx context.Context, id int) (bool, error) {
	query := `
		SELECT count(*)
		FROM chat.user
		WHERE id = $1
	`

	var count int64
	if err := r.pool.QueryRow(ctx, query, id).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check user existence: %w", err)
	}

	return count > 0, nil
}

func (r *UserRepository) GetUser(ctx context.Context, id int) (*entity.User, error) {
	query := `
		SELECT id, email
		FROM chat.user
		WHERE id = $1
		LIMIT 1
	`

	var user entity.User
	if err := r.pool.QueryRow(ctx, query, id).Scan(&user.ID, &user.Email); err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

var _ repository.UserRepository = (*UserRepository)(nil)
