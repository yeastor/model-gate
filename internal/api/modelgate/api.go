package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	desc "model-gate/pkg/modelgate"
	"model-gate/pkg/utils"

	"github.com/google/uuid"
)

type API struct {
	desc.UnimplementedModelServiceServer
	chatUseCase       usecase.Chat
	clickHouseUseCase usecase.ClickHouseUseCase
}

func NewAPI(useCase usecase.Chat, clickHouseUseCase usecase.ClickHouseUseCase) *API {
	return &API{chatUseCase: useCase, clickHouseUseCase: clickHouseUseCase}
}

func (api *API) StartStart(ctx context.Context, req *desc.StartRequest) (*desc.StartResponse, error) {
	chatID := uuid.New().String()

	// Формируем ответ с созданным чатом
	response := &desc.StartResponse{
		Chat: &desc.Chat{
			Id: chatID,
		},
	}

	return response, nil
}

func (api *API) MessageList(ctx context.Context, request *desc.MessageListRequest) (*desc.MessageListResponse, error) {
	chatID, err := uuid.Parse(request.Chat.Id)
	if err != nil {
		return nil, err
	}

	messages, err := api.clickHouseUseCase.MessageList(ctx, chatID)
	return converter.FromUseCaseMessagesToDescMessageListResponse(messages), err
}

func (api *API) Chat(ctx context.Context, chatRequest *desc.ChatRequest) (*desc.ChatResponse, error) {
	err := chatRequest.Validate()
	if err != nil {
		return nil, fmt.Errorf("validate err: %w", err)
	}
	chatID, err := uuid.Parse(chatRequest.ChatBody.Chat.Id)
	if err != nil {
		return nil, err
	}

	isChatExist, err := api.clickHouseUseCase.CheckExist(ctx, chatID)
	if err != nil {
		return nil, err
	}

	question := chatRequest.ChatBody.Question.Q
	if !isChatExist {
		err = api.clickHouseUseCase.AddChat(ctx, chatID, utils.GenerateChatName(question))
		if err != nil {
			return nil, fmt.Errorf("create chat err: %w", err)
		}
	}

	useCaseAnswer, err := api.chatUseCase.Chat(ctx, converter.FromDescChatRequestToUseCaseQuestion(chatRequest))
	if err != nil {
		return nil, fmt.Errorf("chat answer err: %w", err)
	}

	message := entity.NewMessage(chatID, question, useCaseAnswer.Content)
	api.clickHouseUseCase.AddMessage(ctx, message)
	if err != nil {
		return nil, fmt.Errorf("add message err: %w", err)
	}

	return converter.FromUseCaseAnswerToDescChatResponse(useCaseAnswer), err
}
