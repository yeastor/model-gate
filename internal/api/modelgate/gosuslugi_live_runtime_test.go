package modelgate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ch "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/google/uuid"
	gw "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"model-gate/internal/api/middleware"
	"model-gate/internal/pkg/chatcrypto/cryptotest"
	"model-gate/internal/repository/clickhouse"
	"model-gate/internal/repository/cookie"
	"model-gate/internal/repository/postgres"
	uc "model-gate/internal/usecase/modelgate"
	dcHTTP "model-gate/pkg/http"
	desc "model-gate/pkg/modelgate"
)

type gaAuthOptions struct{ URL string }

func (o gaAuthOptions) GetAuthCookieName() string    { return "ga-e2e-session" }
func (o gaAuthOptions) GetAuthFreeMessageLimit() int { return 5 }
func (o gaAuthOptions) GetAuthLoginDomain() string   { return o.URL }
func (o gaAuthOptions) GetAuthUserInfoURL() string   { return o.URL }
func (o gaAuthOptions) GetEnv() string               { return "test" }

// Opt-in local test: real HTTP/gRPC handlers, cookie provider, repositories,
// PostgreSQL, ClickHouse and existing Node server. Only the external site
// identity endpoint is a synthetic fixture; no real login/account is used.
func TestGosuslugiConditionalHelpRealAPI(t *testing.T) {
	out := os.Getenv("GA_E2E_OUTPUT")
	if out == "" {
		t.Skip("explicit isolated GA integration environment required")
	}
	if out == "temporary" {
		out = t.TempDir()
	}
	dsn := os.Getenv("GA_E2E_PG_DSN")
	if dsn != "postgres://ga_test:ga-isolated-test-only@127.0.0.1:19432/ga_test?sslmode=disable" || os.Getenv("GA_E2E_CH_ADDR") != "127.0.0.1:19900" {
		t.Fatal("isolated test databases required")
	}
	node := os.Getenv("GA_E2E_NODE")
	if node == "" {
		t.Fatal("node path required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	repo, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	pbytes, err := os.ReadFile(filepath.Join(repo, "services/category-runtime/service/conversation/policy/gosuslugi-access.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var policy struct {
		Version string `json:"version"`
		Source  struct {
			SHA string `json:"sha256"`
		} `json:"source"`
		Help struct {
			Session    string `json:"sessionInstruction"`
			Withdrawal string `json:"withdrawalInstruction"`
		} `json:"conditionalHelp"`
	}
	if err = json.Unmarshal(pbytes, &policy); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(pbytes)
	pin, _ := json.Marshal(map[string]any{"path": filepath.Join(repo, "services/category-runtime/service/conversation/policy/gosuslugi-access.v1.json"), "bytes": len(pbytes), "sha256": hex.EncodeToString(sum[:])})
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS chat; CREATE TABLE IF NOT EXISTS chat.site_user(id integer PRIMARY KEY,email text); CREATE TABLE IF NOT EXISTS chat.chat(id uuid PRIMARY KEY,name text NOT NULL,user_id integer NOT NULL REFERENCES chat.site_user(id),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE chat.chat ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '720 hours');`)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := ch.Open(&ch.Options{Addr: []string{"127.0.0.1:19900"}, Auth: ch.Auth{Username: "ga_test", Password: "ga-isolated-test-only"}, DialTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err = conn.Exec(ctx, "CREATE DATABASE IF NOT EXISTS chat"); err != nil {
		t.Fatal(err)
	}
	if err = conn.Exec(ctx, "CREATE TABLE IF NOT EXISTS chat.message(id UUID,chat_id UUID,question String,answer String,category String,created_at DateTime64(6)) ENGINE=MergeTree ORDER BY (chat_id,id)"); err != nil {
		t.Fatal(err)
	}
	var authCalls atomic.Int64
	authSite := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCalls.Add(1)
		c, e := r.Cookie("ga-e2e-session")
		if e != nil {
			w.WriteHeader(401)
			return
		}
		id := 19
		if c.Value == "ga-e2e-foreign" {
			id = 20
		} else if c.Value != "ga-e2e-owner" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "user": map[string]any{"id": id, "email": fmt.Sprintf("ga%d@example.test", id), "status": "active"}})
	}))
	defer authSite.Close()
	options := gaAuthOptions{URL: authSite.URL}
	provider := cookie.NewMetadataCookieProvider(dcHTTP.NewDcHTTPClient(nil, authSite.Client()), options)
	gateKeyFile, gateKeys := cryptotest.New(t)
	nodeKeyFile, nodeKeys := cryptotest.New(t)
	messages := clickhouse.NewRepository(conn, gateKeys)
	chats := postgres.NewRepository(pool, gateKeys)
	users := postgres.NewUserRepository(pool)
	api := NewAPI(nil, nil, nil, uc.NewAddMessageUseCase(messages), uc.NewMessageListUseCase(messages), nil, uc.NewAuthUseCase(provider), chats, users, options)
	activeRoot := filepath.Join(out, "active-sentinel")
	stateRoot := filepath.Join(out, "native-state")
	if err = os.MkdirAll(activeRoot, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := []byte(`{"sha256":"do-not-use-active-alias"}`)
	if err = os.WriteFile(filepath.Join(activeRoot, "active.json"), sentinel, 0600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	nativeAddr := listener.Addr().String()
	_ = listener.Close()
	nativeURL := "http://" + nativeAddr
	runtimeLog, err := os.Create(filepath.Join(out, "native-server.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer runtimeLog.Close()
	var process *exec.Cmd
	stopRuntime := func() {
		if process != nil {
			_ = process.Process.Kill()
			_ = process.Wait()
			process = nil
		}
	}
	defer stopRuntime()
	startRuntime := func() {
		process = exec.Command(node, filepath.Join(repo, "services/category-runtime/service/server.mjs"))
		process.Dir = repo
		env := []string{}
		for _, v := range os.Environ() {
			if !strings.HasPrefix(v, "CATEGORY_") && !strings.HasPrefix(v, "CHAT_RUNTIME_KEYS_FILE=") {
				env = append(env, v)
			}
		}
		_, port, _ := net.SplitHostPort(nativeAddr)
		process.Env = append(env, "CHAT_RUNTIME_KEYS_FILE="+nodeKeyFile, "CATEGORY_PORT="+port, "CATEGORY_INTERNAL_TOKEN="+strings.Repeat("g", 32), "CATEGORY_DATA_DIR="+activeRoot, "CATEGORY_PRIVATE_DIALOGUE_DATA_DIR="+stateRoot, "CATEGORY_PRIVATE_GOSUSLUGI_POLICY_PIN="+string(pin))
		process.Stdout = runtimeLog
		process.Stderr = runtimeLog
		if e := process.Start(); e != nil {
			t.Fatal(e)
		}
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			r, e := http.Get(nativeURL + "/health")
			if e == nil {
				var h map[string]any
				_ = json.NewDecoder(r.Body).Decode(&h)
				_ = r.Body.Close()
				tuple, _ := h["privateQualifiedTuple"].(map[string]any)
				if r.StatusCode == 200 && h["privateQualifiedMode"] == true && tuple["sourceSha256"] == policy.Source.SHA {
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("native server did not become ready; see native-server.log")
	}
	startRuntime()
	t.Setenv("CONVERSATION_STATE_V2", "true")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", nativeURL)
	t.Setenv("CATEGORY_INTERNAL_TOKEN", strings.Repeat("g", 32))
	grpcListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	gs := grpc.NewServer(grpc.UnaryInterceptor(middleware.UnaryServerInterceptor(options.GetAuthCookieName())))
	desc.RegisterModelServiceServer(gs, api)
	go func() { _ = gs.Serve(grpcListener) }()
	defer gs.Stop()
	mux := gw.NewServeMux()
	if err = desc.RegisterModelServiceHandlerFromEndpoint(ctx, mux, grpcListener.Addr().String(), []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}); err != nil {
		t.Fatal(err)
	}
	if err = api.RegisterGuidedHTTP(mux, options.GetAuthCookieName(), nil); err != nil {
		t.Fatal(err)
	}
	if err = api.RegisterManagementHTTP(mux, options.GetAuthCookieName()); err != nil {
		t.Fatal(err)
	}
	erasureToken := strings.Repeat("t", 32)
	if err = api.RegisterAccountErasureHTTP(mux, erasureToken); err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(mux)
	defer front.Close()
	traceFile, err := os.Create(filepath.Join(out, "api-traces.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer traceFile.Close()
	var traceMu sync.Mutex
	call := func(route, cookieValue string, body map[string]any, headers map[string]string) (int, map[string]any) {
		b, _ := json.Marshal(body)
		req, e := http.NewRequestWithContext(ctx, http.MethodPost, front.URL+route, bytes.NewReader(b))
		if e != nil {
			t.Fatal(e)
		}
		req.Header.Set("Content-Type", "application/json")
		if cookieValue != "" {
			req.AddCookie(&http.Cookie{Name: options.GetAuthCookieName(), Value: cookieValue})
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		response, e := front.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if e != nil {
			t.Fatal(e)
		}
		result := map[string]any{}
		_ = json.Unmarshal(raw, &result)
		traceMu.Lock()
		_ = json.NewEncoder(traceFile).Encode(map[string]any{"route": route, "status": response.StatusCode, "request": body, "response": result})
		traceMu.Unlock()
		return response.StatusCode, result
	}
	requireStatus := func(code, want int, r map[string]any) {
		t.Helper()
		if code != want {
			t.Fatalf("status %d wanted %d: %+v", code, want, r)
		}
	}
	startChat := func() string {
		code, r := call("/model/chat/start/start", "ga-e2e-owner", map[string]any{}, nil)
		requireStatus(code, 200, r)
		return r["chat"].(map[string]any)["id"].(string)
	}
	content := func(r map[string]any) string { return r["answer"].(map[string]any)["content"].(string) }
	used := func(r map[string]any) float64 { return r["presentation"].(map[string]any)["questionsUsed"].(float64) }
	count := func(id string) uint64 {
		var n uint64
		if e := conn.QueryRow(ctx, "SELECT count() FROM chat.message WHERE chat_id = ?", uuid.MustParse(id)).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	body := func(id, q string, r map[string]any) map[string]any {
		b := map[string]any{"protocolVersion": 2, "id": id, "question": q, "turnId": uuid.NewString()}
		if r != nil {
			b["conversation"] = r["conversation"]
		}
		return b
	}
	state := func(id string) map[string]any {
		h := sha256.Sum256([]byte("19:" + id))
		name := hex.EncodeToString(h[:]) + ".json"
		raw, e := os.ReadFile(filepath.Join(stateRoot, "conversation-sessions-v2", name))
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.HasPrefix(raw, []byte("azchat:v1:")) || bytes.Contains(raw, []byte(gaTexts["entry"])) {
			t.Fatal("runtime state is not encrypted at rest")
		}
		plain, e := nodeKeys.Open("runtime/file/isolated/conversation-sessions-v2/"+name, string(raw))
		if e != nil {
			t.Fatal(e)
		}
		var s map[string]any
		if e = json.Unmarshal([]byte(plain), &s); e != nil {
			t.Fatal(e)
		}
		return s
	}
	checks := []string{}
	code, r := call("/model/chat/start/start", "", map[string]any{}, nil)
	requireStatus(code, 401, r)
	code, r = call("/model/chat/start/start", "invalid", map[string]any{}, nil)
	requireStatus(code, 401, r)
	id := startChat()
	b := body(id, gaTexts["entry"], nil)
	code, r = call("/model/chat/conversation", "ga-e2e-owner", b, nil)
	requireStatus(code, 200, r)
	if !strings.Contains(content(r), policy.Help.Session) || strings.Contains(content(r), gaTexts["foreignClaim"]) || r["_historyEnvelope"] != nil {
		t.Fatalf("unsafe or incomplete response %+v", r)
	}
	if used(r) != 1 {
		t.Fatal("question count")
	}
	checks = append(checks, "real cookie provider rejects missing/invalid cookie", "real API -> existing private runtime delivers conditional session help")
	first := r
	chatID := uuid.MustParse(id)
	const renamed = "Synthetic private chat title 942a42"
	code, r = call("/model/chat/rename", "ga-e2e-owner", map[string]any{"id": id, "name": renamed}, nil)
	requireStatus(code, 200, r)
	code, r = call("/model/chat/export", "ga-e2e-owner", map[string]any{"id": id}, nil)
	requireStatus(code, 200, r)
	if r["chat"].(map[string]any)["name"] != renamed || len(r["message"].([]any)) != 2 {
		t.Fatal("owner export did not restore encrypted data")
	}
	code, r = call("/model/chat/export", "ga-e2e-foreign", map[string]any{"id": id}, nil)
	requireStatus(code, 403, r)
	var storedTitle, storedQuestion, storedAnswer string
	if e := pool.QueryRow(ctx, "SELECT name FROM chat.chat WHERE id=$1", chatID).Scan(&storedTitle); e != nil {
		t.Fatal(e)
	}
	if e := conn.QueryRow(ctx, "SELECT question, answer FROM chat.message WHERE chat_id=?", chatID).Scan(&storedQuestion, &storedAnswer); e != nil {
		t.Fatal(e)
	}
	for _, stored := range []string{storedTitle, storedQuestion, storedAnswer} {
		if !strings.HasPrefix(stored, "azchat:v1:") || strings.Contains(stored, gaTexts["entry"]) {
			t.Fatal("plaintext observed at database boundary")
		}
	}
	history, err := messages.GetAllMessagesByChatID(ctx, chatID)
	if err != nil || len(history) != 1 || history[0].Question != gaTexts["entry"] || !strings.HasPrefix(history[0].Answer, content(first)) {
		t.Fatal("encrypted export history not readable by the gateway", err)
	}
	title, err := chats.GetChatForOwner(ctx, chatID, 19)
	if err != nil || title.Name != renamed {
		t.Fatal("renamed title was not readable", err)
	}
	verifyChatDatabaseRestore(t, ctx, dsn, conn, gateKeyFile, chatID, history[0].Question, history[0].Answer, title.Name)
	code, r = call("/model/chat/conversation", "ga-e2e-owner", b, nil)
	requireStatus(code, 200, r)
	if count(id) != 1 || r["turn"].(map[string]any)["messageId"] != first["turn"].(map[string]any)["messageId"] {
		t.Fatal("duplicate retry history")
	}
	checks = append(checks, "same-turn retry keeps one physical ClickHouse row")
	before, _ := json.Marshal(state(id))
	code, r = call("/model/chat/conversation", "ga-e2e-foreign", body(id, gaTexts["thanks"], first), nil)
	requireStatus(code, 403, r)
	after, _ := json.Marshal(state(id))
	if !bytes.Equal(before, after) {
		t.Fatal("foreign user changed native state")
	}
	code, r = call("/model/chat/conversation", "ga-e2e-owner", body(id, gaTexts["thanks"], first), map[string]string{"Origin": "https://other.example.test"})
	requireStatus(code, 403, r)
	checks = append(checks, "foreign owner and cross-origin request rejected before runtime")
	code, r = call("/model/chat/conversation", "ga-e2e-owner", body(id, gaTexts["observation"], first), nil)
	requireStatus(code, 200, r)
	current := r
	code, r = call("/model/chat/massage/list", "ga-e2e-owner", map[string]any{"id": id}, nil)
	requireStatus(code, 200, r)
	if len(r["message"].([]any)) != 4 || count(id) != 2 {
		t.Fatalf("history mismatch %+v", r)
	}
	checks = append(checks, "history read through actual gateway/gRPC and ClickHouse")
	groups := current["answer"].(map[string]any)["next"].([]any)
	if len(groups) == 0 {
		t.Fatalf("pending NEXT lost after unrelated observation: %+v", current)
	}
	next := groups[0].(map[string]any)["view"].([]any)
	var unknown map[string]any
	for _, v := range next {
		view := v.(map[string]any)
		if view["value"] == gaTexts["unknown"] {
			unknown = view
		}
	}
	b = body(id, gaTexts["unknown"], current)
	b["guided"] = unknown["guided"]
	code, r = call("/model/chat/guided", "ga-e2e-owner", b, nil)
	requireStatus(code, 200, r)
	current = r
	if used(r) != 2 || count(id) != 3 {
		t.Fatal("unknown/budget")
	}
	checks = append(checks, "real NEXT unknown answer preserves two-question budget")
	oldView := first["answer"].(map[string]any)["next"].([]any)[0].(map[string]any)["view"].([]any)[0].(map[string]any)
	b = body(id, oldView["value"].(string), first)
	b["guided"] = oldView["guided"]
	code, r = call("/model/chat/guided", "ga-e2e-owner", b, nil)
	requireStatus(code, 409, r)
	if count(id) != 3 {
		t.Fatal("stale action wrote history")
	}
	checks = append(checks, "stale native action rejected without history write")
	// A lost acknowledgement is the only injected transport fault. Answers still
	// originate in the existing server, and persistence uses actual repositories.
	target, _ := url.Parse(nativeURL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	var failAck atomic.Bool
	failAck.Store(true)
	fault := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/conversation/ack" && failAck.Swap(false) {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"error":"injected acknowledgement loss"}`))
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	defer fault.Close()
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", fault.URL)
	b = body(id, gaTexts["thanks"], current)
	code, r = call("/model/chat/conversation", "ga-e2e-owner", b, nil)
	requireStatus(code, 503, r)
	if count(id) != 4 {
		t.Fatal("history not written before lost ack")
	}
	code, r = call("/model/chat/conversation", "ga-e2e-owner", b, nil)
	requireStatus(code, 200, r)
	current = r
	if count(id) != 4 || used(r) != 2 {
		t.Fatal("ack recovery duplicated/reset")
	}
	checks = append(checks, "lost ACK recovers outbox with one physical row and no budget reset")
	t.Setenv("APP_CONVERSATION_RUNTIME_URL", nativeURL)
	stopRuntime()
	code, r = call("/model/chat/conversation", "ga-e2e-owner", body(id, gaTexts["thanks"], current), nil)
	requireStatus(code, 503, r)
	startRuntime()
	code, r = call("/model/chat/guided", "ga-e2e-owner", map[string]any{"protocolVersion": 2, "id": id, "question": "", "resume": true, "guided": current["guided"], "conversation": current["conversation"]}, nil)
	requireStatus(code, 200, r)
	current = r
	if used(r) != 2 || count(id) != 4 {
		t.Fatal("resume reset budget or wrote history")
	}
	checks = append(checks, "real runtime restart/resume retains pending question, facts and budget")
	b = body(id, gaTexts["thanks"], current)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, x := call("/model/chat/conversation", "ga-e2e-owner", b, nil)
			if c != 200 {
				t.Errorf("concurrent request %d %+v", c, x)
			}
		}()
	}
	wg.Wait()
	if count(id) != 5 {
		t.Fatal("concurrent duplicate")
	}
	checks = append(checks, "concurrent repeat serializes through PostgreSQL advisory lock")
	cancelID := startChat()
	code, r = call("/model/chat/conversation", "ga-e2e-owner", body(cancelID, gaTexts["cancelEntry"], nil), nil)
	requireStatus(code, 200, r)
	if !strings.Contains(content(r), policy.Help.Withdrawal) {
		t.Fatal("missing conditional withdrawal help")
	}
	code, r = call("/model/chat/conversation", "ga-e2e-owner", body(cancelID, gaTexts["cancelObservation"], r), nil)
	requireStatus(code, 200, r)
	for chatID, field := range map[string]string{id: gaTexts["activeField"], cancelID: gaTexts["cancelField"]} {
		s := state(chatID)
		for _, f := range s["factLedger"].([]any) {
			if f.(map[string]any)["fieldKey"] == field {
				t.Fatal("observation became qualified fact")
			}
		}
		raw, _ := json.Marshal(s)
		if !bytes.Contains(raw, []byte("user_report_only")) {
			t.Fatal("observation missing")
		}
	}
	checks = append(checks, "visible button and unrecognized session remain user reports, not canonical facts")
	got, err := os.ReadFile(filepath.Join(activeRoot, "active.json"))
	if err != nil || !bytes.Equal(got, sentinel) {
		t.Fatal("active alias touched")
	}
	req, _ := http.NewRequest(http.MethodPost, nativeURL+"/state", strings.NewReader(`{}`))
	req.Header.Set("X-Category-Token", strings.Repeat("g", 32))
	rr, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = rr.Body.Close()
	if rr.StatusCode != 409 {
		t.Fatal("private mode allowed active operations")
	}
	checks = append(checks, "private mode forbids active catalog operations and leaves sentinel unchanged")
	ownerHistoryBeforeErasure, withdrawalHistoryBeforeErasure := count(id), count(cancelID)
	code, r = call("/model/chat/start/start", "ga-e2e-foreign", map[string]any{}, nil)
	requireStatus(code, 200, r)
	otherID := r["chat"].(map[string]any)["id"].(string)
	code, r = call("/model/chat/conversation", "ga-e2e-foreign", body(otherID, gaTexts["entry"], nil), nil)
	requireStatus(code, 200, r)
	ownerHash := sha256.Sum256([]byte("19:" + id))
	feedbackDir := filepath.Join(stateRoot, "dialogue-feedback", hex.EncodeToString(ownerHash[:]))
	if err := os.MkdirAll(feedbackDir, 0700); err != nil {
		t.Fatal(err)
	}
	feedbackFile := filepath.Join(feedbackDir, uuid.NewString()+".json")
	if err := os.WriteFile(feedbackFile, []byte("synthetic legacy feedback"), 0600); err != nil {
		t.Fatal(err)
	}
	erasure := map[string]any{"userId": 19}
	code, r = call("/internal/account-erasure", "ga-e2e-owner", erasure, nil)
	requireStatus(code, 401, r)
	if count(id) == 0 {
		t.Fatal("unauthorized erasure changed history")
	}
	erasureHeaders := map[string]string{"X-Account-Erasure-Token": erasureToken}
	stopRuntime()
	code, r = call("/internal/account-erasure", "", erasure, erasureHeaders)
	requireStatus(code, 503, r)
	if count(id) == 0 {
		t.Fatal("erasure skipped the unavailable runtime")
	}
	startRuntime()
	for range 2 {
		code, r = call("/internal/account-erasure", "", erasure, erasureHeaders)
		requireStatus(code, 204, r)
	}
	if count(id) != 0 || count(cancelID) != 0 || count(otherID) != 1 || state(id)["deleted"] != true {
		t.Fatal("account erasure did not isolate live history")
	}
	if _, err := os.Stat(feedbackFile); !os.IsNotExist(err) {
		t.Fatal("account erasure did not remove feedback")
	}
	code, r = call("/model/chat/start/start", "ga-e2e-owner", map[string]any{}, nil)
	requireStatus(code, 403, r)
	checks = append(checks, "authenticated machine erasure retries unavailable runtime, deletes history and feedback, and fences stale owner")
	report := map[string]any{"status": "PASS", "checks": checks, "auth_fixture": "external site identity endpoint only; real MetadataCookieProvider validates it", "postgres": "real isolated postgres:17-alpine", "clickhouse": "real isolated clickhouse/clickhouse-server:25.12-alpine", "runtime": "existing service/server.mjs with exact private GA policy pin", "auth_calls": authCalls.Load(), "owner_chat": id, "withdrawal_chat": cancelID, "owner_history_rows": ownerHistoryBeforeErasure, "withdrawal_history_rows": withdrawalHistoryBeforeErasure, "source_sha256": policy.Source.SHA, "policy_version": policy.Version, "category_closed": false, "production_ready": false}
	bytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(out, "real-api-result.json"), append(bytes, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}

var gaTexts = map[string]string{
	"entry":             "\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u044e \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c \u0441\u0432\u043e\u0435\u0433\u043e \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 \u0413\u043e\u0441\u0443\u0441\u043b\u0443\u0433 \u043f\u043e\u0441\u043b\u0435 \u0438\u043d\u0446\u0438\u0434\u0435\u043d\u0442\u0430",
	"observation":       "\u042f \u0432\u0438\u0436\u0443 \u043d\u0435\u0437\u043d\u0430\u043a\u043e\u043c\u044b\u0439 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0441\u0435\u0430\u043d\u0441",
	"unknown":           "\u041d\u0435 \u0437\u043d\u0430\u044e",
	"cancelEntry":       "\u042f \u043d\u0430\u0448\u0435\u043b \u0437\u0430\u044f\u0432\u043b\u0435\u043d\u0438\u0435, \u043a\u043e\u0442\u043e\u0440\u043e\u0435 \u043d\u0435 \u043f\u043e\u0434\u0430\u0432\u0430\u043b",
	"cancelObservation": "\u0423 \u044d\u0442\u043e\u0433\u043e \u0437\u0430\u044f\u0432\u043b\u0435\u043d\u0438\u044f \u0435\u0441\u0442\u044c \u043a\u043d\u043e\u043f\u043a\u0430 \u043e\u0442\u0437\u044b\u0432\u0430",
	"thanks":            "\u0421\u043f\u0430\u0441\u0438\u0431\u043e",
	"foreignClaim":      "\u0435\u0441\u0442\u044c \u0447\u0443\u0436\u0438\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0435",
	"activeField":       "gosuslugi_access.secure_account.foreign_sessions_active",
	"cancelField":       "gosuslugi_access.unauthorized_services.online_cancellation_available",
}
