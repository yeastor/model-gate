package category

import (
	"context"
	"errors"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/category"
	"model-gate/internal/pkg/vector/processor"
	converter2 "model-gate/internal/usecase/category/converter"
)

const TextChooseCategory = "Уточните категорию"

var ErrNoCategoryVariantFound = errors.New("no category variant found for question")

type GetCategoryVariantUseCase struct {
	vectorFactory *processor.Factory
	options       category.CategoryVariantUseCaseOptions
	logger        usecase.Logger
}

func NewGetCategoryVariantUseCase(vectorFactory *processor.Factory, options category.CategoryVariantUseCaseOptions, logger usecase.Logger) *GetCategoryVariantUseCase {
	return &GetCategoryVariantUseCase{vectorFactory: vectorFactory, options: options, logger: logger}
}

func (u GetCategoryVariantUseCase) Invoke(ctx context.Context, question *usecase.Question) (*usecase.Answer, error) {
	categoryChecked := make(map[string]bool)

	vQuestion := &processor.Question{Question: question.Question}
	vectorProcessor, err := u.vectorFactory.GetModelProcessor(u.options.GetCategoryVectorModelName(), u.options.GetCategoryVectorCollection())
	if err != nil {
		return nil, err
	}

	vAnswers, err := vectorProcessor.GetAnswer(ctx, vQuestion)
	if err != nil {
		return nil, err
	}

	if len(vAnswers) == 0 {
		return nil, ErrNoCategoryVariantFound
	}

	categoryVariantsAnswer := &usecase.Answer{
		Content: TextChooseCategory,
	}

	maxCats := u.options.GetStrategyCategoryMaxCount()
	i := 1
	for _, vAnswer := range vAnswers {
		if vAnswer.GetScore() >= u.options.GetStrategyCategoryMinScore() {
			next, err := converter2.FromProcessorVectorAnswerToUseCaseNext(u.logger, vAnswer.GetPayload(), categoryChecked)
			if err != nil {
				if errors.Is(err, converter2.ErrCategoryAlreadyChecked) {
					continue
				}
				return nil, err
			}

			next.View[0].Value = question.Question
			next.QuestionText = next.View[0].Question
			categoryChecked[next.View[0].CategoryID] = true
			categoryVariantsAnswer.Next = append(categoryVariantsAnswer.Next, next)
			i++
		}
		if i == maxCats {
			return categoryVariantsAnswer, nil
		}
	}

	if len(categoryVariantsAnswer.Next) == 0 {
		return nil, ErrNoCategoryVariantFound
	}

	return categoryVariantsAnswer, nil
}
