package modelgate

import (
	"context"
	"testing"

	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	desc "model-gate/pkg/modelgate"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type accessAuth struct {
	user *entity.User
	err  error
}

func (a accessAuth) IsTokenExist(context.Context) (bool, error)          { return true, nil }
func (a accessAuth) GetAuthUserId(context.Context) (*entity.User, error) { return a.user, a.err }

type accessUsers struct{ calls int }

func (r *accessUsers) CreateUser(context.Context, *entity.User) error     { r.calls++; return nil }
func (r *accessUsers) UserExists(context.Context, int) (bool, error)      { return false, nil }
func (r *accessUsers) GetUser(context.Context, int) (*entity.User, error) { return nil, pgx.ErrNoRows }

type accessChats struct {
	chats map[uuid.UUID]*entity.Chat
	calls int
}

func (r *accessChats) WithChatLock(ctx context.Context, _ uuid.UUID, action func(context.Context) error) error {
	return action(ctx)
}
func (r *accessChats) DeleteChat(_ context.Context, id uuid.UUID, userID int) error {
	if chat := r.chats[id]; chat == nil || chat.UserID == nil || *chat.UserID != userID {
		return pgx.ErrNoRows
	}
	delete(r.chats, id)
	return nil
}

func (r *accessChats) CreateChat(_ context.Context, c *entity.Chat) error {
	r.calls++
	r.chats[c.ID] = c
	return nil
}
func (r *accessChats) ChatExists(_ context.Context, id uuid.UUID) (bool, error) {
	_, ok := r.chats[id]
	return ok, nil
}
func (r *accessChats) GetChat(_ context.Context, id uuid.UUID) (*entity.Chat, error) {
	r.calls++
	c, ok := r.chats[id]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	return c, nil
}
func (r *accessChats) UpdateChat(context.Context, *entity.Chat) error   { r.calls++; return nil }
func (r *accessChats) UpdateUpdatedAt(context.Context, uuid.UUID) error { r.calls++; return nil }
func (r *accessChats) GetChatsByUserID(_ context.Context, id int) ([]*entity.Chat, error) {
	r.calls++
	result := []*entity.Chat{}
	for _, c := range r.chats {
		if c.UserID != nil && *c.UserID == id {
			result = append(result, c)
		}
	}
	return result, nil
}

type accessMessages struct {
	reads, writes, generations int
	deleteErr                  error
	exported                   []*entity.Message
}

func (m *accessMessages) ExportMessages(ctx context.Context, id uuid.UUID) ([]*entity.Message, error) {
	m.reads++
	return m.exported, nil
}
func (m *accessMessages) DeleteMessages(context.Context, uuid.UUID) error {
	m.writes++
	return m.deleteErr
}

func (m *accessMessages) MessageList(context.Context, uuid.UUID) ([]*entity.Message, error) {
	m.reads++
	return nil, nil
}
func (m *accessMessages) AddMessage(context.Context, *entity.Message) error { m.writes++; return nil }
func (m *accessMessages) Chat(context.Context, *usecase.Question) (*usecase.Answer, error) {
	m.generations++
	return &usecase.Answer{Content: "test answer"}, nil
}

func accessAPI(auth accessAuth) (*API, *accessChats, *accessUsers, *accessMessages) {
	c := &accessChats{chats: map[uuid.UUID]*entity.Chat{}}
	u := &accessUsers{}
	m := &accessMessages{}
	return &API{authUseCase: auth, chatRepo: c, userRepo: u, messageListUseCase: m, addMessageUseCase: m, chatUseCase: m}, c, u, m
}
func chatRequest(id uuid.UUID) *desc.ChatRequest {
	return &desc.ChatRequest{ChatBody: &desc.ChatBody{Chat: &desc.Chat{Id: id.String()}, Question: &desc.ChatQuestion{Q: "test question"}}}
}

func TestAccessFailsClosedBeforeAnyWork(t *testing.T) {
	for _, tc := range []struct {
		name string
		auth accessAuth
		code codes.Code
	}{
		{"guest", accessAuth{err: status.Error(codes.Unauthenticated, "no session")}, codes.Unauthenticated},
		{"auth unavailable", accessAuth{err: status.Error(codes.Unavailable, "offline")}, codes.Unavailable},
		{"empty principal", accessAuth{}, codes.Unauthenticated},
		{"invalid site ID", accessAuth{user: &entity.User{ID: 0}}, codes.Unauthenticated},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, chats, users, messages := accessAPI(tc.auth)
			ctx := context.Background()
			_, e1 := api.StartStart(ctx, &desc.StartRequest{})
			_, e2 := api.ChatList(ctx, &desc.ChatListRequest{})
			_, e3 := api.MessageList(ctx, nil)
			_, e4 := api.Chat(ctx, nil)
			for _, err := range []error{e1, e2, e3, e4} {
				if status.Code(err) != tc.code {
					t.Fatalf("expected %s, got %v", tc.code, err)
				}
			}
			if chats.calls+users.calls+messages.reads+messages.writes+messages.generations != 0 {
				t.Fatal("unauthorized request performed work")
			}
		})
	}
}

func TestForeignAndUnownedChatsCannotBeReadWrittenOrClaimed(t *testing.T) {
	for _, owner := range []*int{nil, new(int)} {
		if owner != nil {
			*owner = 6
		}
		api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: 5, Email: "test@example.test"}})
		id := uuid.New()
		chats.chats[id] = &entity.Chat{ID: id, UserID: owner}
		_, readErr := api.MessageList(context.Background(), &desc.MessageListRequest{Chat: &desc.Chat{Id: id.String()}})
		_, writeErr := api.Chat(context.Background(), chatRequest(id))
		if status.Code(readErr) != codes.PermissionDenied || status.Code(writeErr) != codes.PermissionDenied {
			t.Fatalf("ownership bypass: %v %v", readErr, writeErr)
		}
		if messages.reads+messages.writes+messages.generations != 0 || chats.chats[id].UserID != owner {
			t.Fatal("foreign chat was accessed or claimed")
		}
	}
}

func TestSiteOwnerCreatesListsAndUsesChat(t *testing.T) {
	api, chats, _, messages := accessAPI(accessAuth{user: &entity.User{ID: 5, Email: "test@example.test"}})
	ctx := context.Background()
	start, err := api.StartStart(ctx, &desc.StartRequest{})
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse(start.Chat.Id)
	if *chats.chats[id].UserID != 5 {
		t.Fatal("not linked to canonical site ID")
	}
	foreign := uuid.New()
	other := 6
	chats.chats[foreign] = &entity.Chat{ID: foreign, UserID: &other}
	list, err := api.ChatList(ctx, &desc.ChatListRequest{})
	if err != nil || len(list.Chats) != 1 || list.Chats[0].Id != id.String() {
		t.Fatalf("wrong owner list: %v %v", list, err)
	}
	if _, err := api.MessageList(ctx, &desc.MessageListRequest{Chat: &desc.Chat{Id: id.String()}}); err != nil {
		t.Fatal(err)
	}
	if _, err := api.Chat(ctx, chatRequest(id)); err != nil {
		t.Fatal(err)
	}
	if messages.reads != 1 || messages.writes != 1 || messages.generations != 1 {
		t.Fatal("owner operations did not complete")
	}
	_, err = api.Chat(ctx, chatRequest(uuid.New()))
	if status.Code(err) != codes.NotFound {
		t.Fatalf("unknown ID must not create chat: %v", err)
	}
	for _, req := range []*desc.ChatRequest{nil, {}, {ChatBody: &desc.ChatBody{}}} {
		if _, err := api.Chat(ctx, req); status.Code(err) != codes.InvalidArgument {
			t.Fatalf("invalid request: %v", err)
		}
	}
}
