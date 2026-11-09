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
		INSERT INTO chat.site_user (id, email)
		VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
		WHERE chat.site_user.email IS NOT NULL
		  AND chat.site_user.email IS DISTINCT FROM EXCLUDED.email
	`

	result, err := r.pool.Exec(ctx, query, user.ID, user.Email)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}
	if result.RowsAffected() == 0 {
		var erased bool
		if err := r.pool.QueryRow(ctx, "SELECT email IS NULL FROM chat.site_user WHERE id=$1", user.ID).Scan(&erased); err != nil {
			return err
		}
		if erased {
			return repository.ErrUserErased
		}
	}

	return nil
}

func (r *UserRepository) DisableErasedUser(ctx context.Context, userID int) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO chat.site_user (id, email) VALUES ($1, NULL)
		ON CONFLICT (id) DO UPDATE SET email=NULL`, userID)
	return err
}

func (r *UserRepository) UserExists(ctx context.Context, id int) (bool, error) {
	query := `
		SELECT count(*)
		FROM chat.site_user
		WHERE id = $1 AND email IS NOT NULL
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
		FROM chat.site_user
		WHERE id = $1 AND email IS NOT NULL
		LIMIT 1
	`

	var user entity.User
	if err := r.pool.QueryRow(ctx, query, id).Scan(&user.ID, &user.Email); err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

var _ repository.UserRepository = (*UserRepository)(nil)
