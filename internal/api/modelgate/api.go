package modelgate

import (
	"context"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	desc "model-gate/pkg/modelgate"
	"model-gate/pkg/utils"
	"slices"

	"github.com/google/uuid"
)

type API struct {
	desc.UnimplementedModelServiceServer
	chatUseCase            usecase.Chat
	addChatUseCase         usecase.AddChatUseCase
	checkChatExistsUseCase usecase.CheckChatExistsUseCase
	addMessageUseCase      usecase.AddMessageUseCase
	messageListUseCase     usecase.MessageListUseCase
	chatListUseCase        usecase.ChatListUseCase
	authUseCase            usecase.Auth
	relChatUserRepo        repository.RelChatUserRepository
	userRepo               repository.UserRepository
	freeMessageLimit       int
	loginDomain            string
}

func NewAPI(
	useCase usecase.Chat,
	addChatUseCase usecase.AddChatUseCase,
	checkChatExistsUseCase usecase.CheckChatExistsUseCase,
	addMessageUseCase usecase.AddMessageUseCase,
	messageListUseCase usecase.MessageListUseCase,
	chatListUseCase usecase.ChatListUseCase,
	authUseCase usecase.Auth,
	relChatUserRepo repository.RelChatUserRepository,
	userRepo repository.UserRepository,
	options usecase.AuthOptions,
) *API {
	return &API{
		chatUseCase:            useCase,
		addChatUseCase:         addChatUseCase,
		checkChatExistsUseCase: checkChatExistsUseCase,
		addMessageUseCase:      addMessageUseCase,
		messageListUseCase:     messageListUseCase,
		chatListUseCase:        chatListUseCase,
		authUseCase:            authUseCase,
		relChatUserRepo:        relChatUserRepo,
		userRepo:               userRepo,
		freeMessageLimit:       options.GetAuthFreeMessageLimit(),
		loginDomain:            options.GetAuthLoginDomain(),
	}
}

func (api *API) StartStart(ctx context.Context, req *desc.StartRequest) (*desc.StartResponse, error) {
	chatID := uuid.New().String()

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
			return api.buildAuthRequiredResponse(), nil
		}
	}

	if isAuth {
		user, err := api.authUseCase.GetAuthUserId(ctx)
		if err != nil {
			return api.buildAuthRequiredResponse(), nil
		}

		exists, err := api.userRepo.UserExists(ctx, user.GetID())
		if err != nil {
			return nil, err
		}
		if !exists {
			if err := api.userRepo.CreateUser(ctx, user); err != nil {
				return nil, err
			}
		}

		userIDs, err := api.relChatUserRepo.GetUsersByChatID(ctx, chatID)
		if err != nil {
			return nil, err
		}

		if len(userIDs) == 0 {
			err = api.relChatUserRepo.AddUserToChat(ctx, &entity.RelChatUser{
				UserID: user.GetID(),
				ChatID: chatID,
			})
			if err != nil {
				return nil, err
			}
		} else {
			found := slices.Contains(userIDs, user.GetID())
			if !found {
				return nil, fmt.Errorf("работа с этим чатом невозможна")
			}
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

func (api *API) buildAuthRequiredResponse() *desc.ChatResponse {
	return &desc.ChatResponse{
		Answer: &desc.ChatAnswer{
			Content: "Для продолжения необходимо <a href=\"" + api.loginDomain + "/login\">авторизоваться</a>.",
		},
	}
}

func (api *API) ChatList(ctx context.Context, _ *desc.ChatListRequest) (*desc.ChatListResponse, error) {
	chats, err := api.chatListUseCase.ChatList(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]*desc.ChatListItem, 0, len(chats))
	for _, chat := range chats {
		items = append(items, &desc.ChatListItem{
			Id:   chat.ID.String(),
			Name: chat.Name,
		})
	}

	return &desc.ChatListResponse{Chats: items}, nil
}
