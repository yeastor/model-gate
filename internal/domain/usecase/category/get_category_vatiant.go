package category

import (
	"context"
	"model-gate/internal/domain/usecase"
)

type GetCategoryVariantUseCase interface {
	Invoke(ctx context.Context, question *usecase.Question) (*usecase.Answer, error)
}

type CategoryVariantUseCaseOptions interface {
	GetStrategyCategoryMinScore() float32
	GetStrategyCategoryMaxCount() int
	GetCategoryVectorModelName() string
	GetCategoryVectorCollection() string
}

type CategoryVariant struct {
	name string
	id   string
}

func (variant CategoryVariant) getName() string {
	return variant.name
}

func (variant CategoryVariant) getId() string {
	return variant.id
}
