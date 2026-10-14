package modelgate

import (
	"context"
	"errors"
	"fmt"
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	desc "model-gate/pkg/modelgate"
	"model-gate/pkg/utils"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	chatRepo               repository.ChatRepository
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
	chatRepo repository.ChatRepository,
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
		chatRepo:               chatRepo,
		userRepo:               userRepo,
		freeMessageLimit:       options.GetAuthFreeMessageLimit(),
		loginDomain:            options.GetAuthLoginDomain(),
	}
}

func (api *API) StartStart(ctx context.Context, req *desc.StartRequest) (*desc.StartResponse, error) {
	user, err := api.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	userID := user.GetID()
	chat := &entity.Chat{ID: uuid.New(), Name: "New chat", UserID: &userID, CreatedAt: time.Now()}
	if err := api.chatRepo.CreateChat(ctx, chat); err != nil {
		return nil, status.Error(codes.Internal, "failed to create chat")
	}
	return &desc.StartResponse{Chat: &desc.Chat{Id: chat.ID.String()}}, nil
}

func (api *API) MessageList(ctx context.Context, request *desc.MessageListRequest) (*desc.MessageListResponse, error) {
	user, err := api.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.Chat == nil {
		return nil, status.Error(codes.InvalidArgument, "chat ID required")
	}
	chatID, err := uuid.Parse(request.Chat.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid chat ID")
	}
	var response *desc.MessageListResponse
	err = api.chatRepo.WithChatLock(ctx, chatID, func(lockCtx context.Context) error {
		if _, err := api.ownedChat(lockCtx, chatID, user.GetID()); err != nil {
			return err
		}
		messages, err := api.messageListUseCase.MessageList(lockCtx, chatID)
		if err != nil {
			return err
		}
		response = converter.FromUseCaseMessagesToDescMessageListResponse(messages)
		return nil
	})
	return response, err
}

func (api *API) Chat(ctx context.Context, chatRequest *desc.ChatRequest) (*desc.ChatResponse, error) {
	user, err := api.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	if chatRequest == nil || chatRequest.ChatBody == nil {
		return nil, status.Error(codes.InvalidArgument, "chat request required")
	}
	err = chatRequest.Validate()
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid chat request")
	}
	chatID, err := uuid.Parse(chatRequest.ChatBody.Chat.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid chat ID")
	}

	var response *desc.ChatResponse
	err = api.chatRepo.WithChatLock(ctx, chatID, func(lockCtx context.Context) error {
		var err error
		response, err = api.chatForOwner(lockCtx, chatRequest, chatID, user.GetID())
		return err
	})
	return response, err
}

func (api *API) chatForOwner(ctx context.Context, chatRequest *desc.ChatRequest, chatID uuid.UUID, userID int) (*desc.ChatResponse, error) {
	chat, err := api.ownedChat(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}

	question := chatRequest.ChatBody.Question.Q
	if chat.Name == "New chat" {
		chat.Name = utils.GenerateChatName(question)
		if err := api.chatRepo.UpdateChat(ctx, chat); err != nil {
			return nil, err
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

	if err := api.chatRepo.UpdateUpdatedAt(ctx, chatID); err != nil {
		return nil, err
	}

	return converter.FromUseCaseAnswerToDescChatResponse(useCaseAnswer), err
}

func (api *API) ChatList(ctx context.Context, _ *desc.ChatListRequest) (*desc.ChatListResponse, error) {
	user, err := api.authenticatedUser(ctx)
	if err != nil {
		return nil, err
	}
	chats, err := api.chatRepo.GetChatsByUserID(ctx, user.GetID())
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

func (api *API) authenticatedUser(ctx context.Context) (*entity.User, error) {
	user, err := api.authUseCase.GetAuthUserId(ctx)
	if err != nil {
		if status.Code(err) == codes.Unavailable {
			return nil, err
		}
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}
	if user == nil || user.GetID() <= 0 {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}
	if err := api.userRepo.CreateUser(ctx, user); err != nil {
		return nil, status.Error(codes.Unavailable, "user directory unavailable")
	}
	return user, nil
}

func (api *API) ownedChat(ctx context.Context, id uuid.UUID, userID int) (*entity.Chat, error) {
	chat, err := api.chatRepo.GetChat(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, status.Error(codes.NotFound, "chat not found")
	}
	if err != nil {
		return nil, status.Error(codes.Unavailable, "chat storage unavailable")
	}
	if chat == nil {
		return nil, status.Error(codes.Unavailable, "chat storage unavailable")
	}
	if chat.UserID == nil || *chat.UserID != userID {
		return nil, status.Error(codes.PermissionDenied, "chat access denied")
	}
	return chat, nil
}
