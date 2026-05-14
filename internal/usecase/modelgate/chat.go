package modelgate

import (
	"context"
	"errors"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/category"
	"model-gate/internal/pkg/formater/answer"
	"model-gate/internal/pkg/model/processor"
)

type ChatUseCase struct {
	modelFactory              *processor.Factory
	vectorUseCase             usecase.Vector
	getCategoryVariantUseCase category.GetCategoryVariantUseCase
	options                   ChatUseCaseOptions
}

func NewChatUseCase(
	modelFactory *processor.Factory,
	vectorUseCase usecase.Vector,
	getCategoryVariantUseCase category.GetCategoryVariantUseCase,
	options ChatUseCaseOptions,
) *ChatUseCase {
	return &ChatUseCase{
		modelFactory:              modelFactory,
		vectorUseCase:             vectorUseCase,
		getCategoryVariantUseCase: getCategoryVariantUseCase,
		options:                   options}
}

func (useCase *ChatUseCase) Chat(ctx context.Context, question *usecase.Question) (*usecase.Answer, error) {

	if question.Category.ID == "" && question.Variant.ID == "" {
		categoryVariants, err := useCase.getCategoryVariantUseCase.Invoke(ctx, question)
		if err != nil {
			return nil, err
		}

		if useCase.isOnlyOneCat(categoryVariants) {
			return categoryVariants, nil
		}

		question.Category.ID = categoryVariants.Next[0].View[0].CategoryID
	}

	vectorAnswer, err := useCase.vectorUseCase.Search(ctx, question)
	if errors.Is(err, ErrNoVectorFound) {
		//todo: обработать отсутствие ошибки
		return &usecase.Answer{Content: "Уточните вопрос."}, nil
	} else if err != nil {
		return nil, err
	}

	for _, next := range vectorAnswer.Next {
		next.View = fromUseCaseViewToDescView(next)
	}

	return vectorAnswer, nil

	/*modelProcessor, err := useCase.modelFactory.GetProcessor(useCase.options.GetModelName())
	if err != nil {
		return nil, err
	}
	modelAnswer, err := modelProcessor.GetAnswer(ctx, converter.FromUseCaseQuestionToProcessorQuestion(question))
	if err != nil {
		return nil, err
	}

	return converter.FromProcessorAnswerAnswerToUseCase(modelAnswer), nil*/
}

func (useCase *ChatUseCase) isOnlyOneCat(categoryVariants *usecase.Answer) bool {
	return categoryVariants.Next != nil && len(categoryVariants.Next) > 1
}

func fromUseCaseViewToDescView(next *usecase.Next) []*usecase.View {
	if len(next.View) == 0 {
		return nil
	}

	for _, view := range next.View {
		view.Question = answer.FormatNextQuestion(view.Value, next.Type)
	}

	return next.View
}

type ChatUseCaseOptions interface {
	GetModelName() string
	GetVectorModelName() string
	GetVectorMinScore() float32
	GetVectorMaxCount() int
}

var _ usecase.Chat = (*ChatUseCase)(nil)
