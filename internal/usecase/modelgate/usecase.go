package modelgate

import (
	"context"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	"model-gate/internal/pkg/model/processor"
)

type ChatUseCase struct {
	modelFactory *processor.Factory
	options      ChatUseCaseOptions
}

func NewChatUseCase(modelFactory *processor.Factory, options ChatUseCaseOptions) *ChatUseCase {
	return &ChatUseCase{modelFactory: modelFactory, options: options}
}

func (useCase *ChatUseCase) Chat(ctx context.Context, question *usecase.Question) (*usecase.Answer, error) {

	modelProcessor, err := useCase.modelFactory.GetProcessor(useCase.options.GetModelName())
	if err != nil {
		return nil, err
	}
	modelAnswer, err := modelProcessor.GetAnswer(ctx, converter.FromUseCaseQuestionToProcessorQuestion(question))
	if err != nil {
		return nil, err
	}

	return converter.FromProcessorAnswerAnswerToUseCase(modelAnswer), nil
}

type ChatUseCaseOptions interface {
	GetModelName() string
}

var _ usecase.Chat = (*ChatUseCase)(nil)
