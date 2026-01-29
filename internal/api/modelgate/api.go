package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	desc "model-gate/pkg/modelgate"
)

type API struct {
	desc.UnimplementedModelServiceServer
	noteUseCase usecase.Chat
}

func NewAPI(useCase usecase.Chat) *API {
	return &API{noteUseCase: useCase}
}

func (api *API) Chat(ctx context.Context, in *desc.ChatRequest) (*desc.ChatResponse, error) {
	err := in.Validate()
	if err != nil {
		return nil, fmt.Errorf("validate err: %w", err)
	}

	useCaseAnswer, err := api.noteUseCase.Chat(ctx, converter.FromDescChatRequestToUseCaseQuestion(in))
	if err != nil {
		return nil, fmt.Errorf("create err: %w", err)
	}

	return converter.FromUseCaseAnswerToDescChatResponse(useCaseAnswer), err
}
