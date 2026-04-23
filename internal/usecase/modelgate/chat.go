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

	if question.Category.ID == "" {
		categoryVariants, err := useCase.getCategoryVariantUseCase.Invoke(ctx, question)
		if err != nil {
			return nil, err
		}
		return categoryVariants, nil
	}

	vectorAnswer, err := useCase.vectorUseCase.Search(ctx, question)
	if errors.Is(err, ErrNoVectorFound) {
		//todo: обработать отсутствие ошибки
		return &usecase.Answer{Content: "Уточните вопрос."}, nil
	} else if err != nil {
		return nil, err
	}

	for _, next := range vectorAnswer.Next {
		next.View = fromUseCaseViewToDescView(next.View)
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

func fromUseCaseViewToDescView(views []*usecase.View) []*usecase.View {
	if len(views) == 0 {
		return nil
	}

	for _, view := range views {
		view.Question = answer.FormatNextQuestion(view.Value)
	}

	return views
}

type ChatUseCaseOptions interface {
	GetModelName() string
	GetVectorModelName() string
	GetVectorMinScore() float32
	GetVectorMaxCount() int
}

var _ usecase.Chat = (*ChatUseCase)(nil)
