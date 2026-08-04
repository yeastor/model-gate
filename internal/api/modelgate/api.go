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
	chatUseCase            usecase.Chat
	addChatUseCase         usecase.AddChatUseCase
	checkChatExistsUseCase usecase.CheckChatExistsUseCase
	addMessageUseCase      usecase.AddMessageUseCase
	messageListUseCase     usecase.MessageListUseCase
	authUseCase            usecase.Auth
	freeMessageLimit       int
	loginDomain            string
}

func NewAPI(
	useCase usecase.Chat,
	addChatUseCase usecase.AddChatUseCase,
	checkChatExistsUseCase usecase.CheckChatExistsUseCase,
	addMessageUseCase usecase.AddMessageUseCase,
	messageListUseCase usecase.MessageListUseCase,
	authUseCase usecase.Auth,
	options usecase.AuthOptions,
) *API {
	return &API{
		chatUseCase:            useCase,
		addChatUseCase:         addChatUseCase,
		checkChatExistsUseCase: checkChatExistsUseCase,
		addMessageUseCase:      addMessageUseCase,
		messageListUseCase:     messageListUseCase,
		authUseCase:            authUseCase,
		freeMessageLimit:       options.GetAuthFreeMessageLimit(),
		loginDomain:            options.GetAuthLoginDomain(),
	}
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

	messages, err := api.messageListUseCase.MessageList(ctx, chatID)
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

	isAuth, err := api.authUseCase.IsTokenExist(ctx)
	if err != nil {
		return nil, err
	}
	if !isAuth {
		messages, err := api.messageListUseCase.MessageList(ctx, chatID)
		if err != nil {
			return nil, err
		}
		if len(messages) >= api.freeMessageLimit {
			return &desc.ChatResponse{
				Answer: &desc.ChatAnswer{
					Content: "Для продолжения необходимо <a href=\"" + api.loginDomain + "/login\">авторизоваться</a>.",
				},
			}, nil
		}
	}

	isChatExist, err := api.checkChatExistsUseCase.CheckExist(ctx, chatID)
	if err != nil {
		return nil, err
	}

	question := chatRequest.ChatBody.Question.Q
	if !isChatExist {
		err = api.addChatUseCase.AddChat(ctx, chatID, utils.GenerateChatName(question))
		if err != nil {
			return nil, fmt.Errorf("create chat err: %w", err)
		}
	}

	useCaseAnswer, err := api.chatUseCase.Chat(ctx, converter.FromDescChatRequestToUseCaseQuestion(chatRequest))
	if err != nil {
		return nil, fmt.Errorf("chat answer err: %w", err)
	}

	message := entity.NewMessage(chatID, question, useCaseAnswer.Content, useCaseAnswer.Category.ID)
	err = api.addMessageUseCase.AddMessage(ctx, message)
	if err != nil {
		return nil, fmt.Errorf("add message err: %w", err)
	}

	return converter.FromUseCaseAnswerToDescChatResponse(useCaseAnswer), err
}
