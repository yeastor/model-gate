package modelgate

import (
	"context"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/model/processor"
)

type ChatUseCase struct {
	modelFactory  *processor.Factory
	vectorUseCase usecase.Vector
	options       ChatUseCaseOptions
}

func NewChatUseCase(modelFactory *processor.Factory, vectorUseCase usecase.Vector, options ChatUseCaseOptions) *ChatUseCase {
	return &ChatUseCase{modelFactory: modelFactory, vectorUseCase: vectorUseCase, options: options}
}

func (useCase *ChatUseCase) Chat(ctx context.Context, question *usecase.Question) (*usecase.Answer, error) {

	vectorAnswer, err := useCase.vectorUseCase.Search(ctx, question)
	if err != nil {
		return nil, err
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

type ChatUseCaseOptions interface {
	GetModelName() string
	GetVectorModelName() string
	GetVectorMinScore() float32
	GetVectorMaxCount() int
}

var _ usecase.Chat = (*ChatUseCase)(nil)
