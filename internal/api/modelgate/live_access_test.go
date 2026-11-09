package modelgate

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	desc "model-gate/pkg/modelgate"
)

// Opt-in local test. Cookies are supplied in memory by unified-chat-smoke.mjs.
func TestLiveGRPCAccess(t *testing.T) {
	if os.Getenv("CHAT_ACCESS_LIVE") != "1" {
		t.Skip("local stack test not enabled")
	}
	conn, err := grpc.NewClient("127.0.0.1:8093", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := desc.NewModelServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, cookie := range []string{"", "aizaschita-app-session=test-user-5:test@example.test"} {
		guest := metadata.NewOutgoingContext(ctx, metadata.Pairs("grpcgateway-cookie", cookie, "x-user-id", "5"))
		_, a := client.StartStart(guest, &desc.StartRequest{})
		_, b := client.ChatList(guest, &desc.ChatListRequest{})
		_, c := client.MessageList(guest, &desc.MessageListRequest{Chat: &desc.Chat{Id: uuid.NewString()}})
		_, d := client.Chat(guest, chatRequest(uuid.New()))
		for _, e := range []error{a, b, c, d} {
			if status.Code(e) != codes.Unauthenticated {
				t.Fatalf("guest gRPC bypass: %v", e)
			}
		}
	}
	one := metadata.NewOutgoingContext(ctx, metadata.Pairs("grpcgateway-cookie", os.Getenv("CHAT_TEST_COOKIE_ONE")))
	two := metadata.NewOutgoingContext(ctx, metadata.Pairs("grpcgateway-cookie", os.Getenv("CHAT_TEST_COOKIE_TWO")))
	start, err := client.StartStart(one, &desc.StartRequest{})
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse(start.Chat.Id)
	if _, err := client.MessageList(one, &desc.MessageListRequest{Chat: start.Chat}); err != nil {
		t.Fatal(err)
	}
	list, err := client.ChatList(two, &desc.ChatListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range list.Chats {
		if c.Id == id.String() {
			t.Fatal("foreign gRPC list")
		}
	}
	_, a := client.MessageList(two, &desc.MessageListRequest{Chat: start.Chat})
	_, b := client.Chat(two, chatRequest(id))
	if status.Code(a) != codes.PermissionDenied || status.Code(b) != codes.PermissionDenied {
		t.Fatalf("gRPC ownership bypass: %v %v", a, b)
	}
}
