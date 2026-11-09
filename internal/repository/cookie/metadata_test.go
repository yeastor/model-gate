package cookie

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"model-gate/internal/api/middleware"
	dcHTTP "model-gate/pkg/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type testOptions struct{ url string }

func (o testOptions) GetAuthCookieName() string    { return "aizaschita-app-session" }
func (o testOptions) GetAuthFreeMessageLimit() int { return 5 }
func (o testOptions) GetAuthLoginDomain() string   { return o.url }
func (o testOptions) GetAuthUserInfoURL() string   { return o.url }
func (o testOptions) GetEnv() string               { return "dev" }

func TestEveryCookieIsVerifiedAgainstSite(t *testing.T) {
	for _, tc := range []struct {
		name, cookie, body string
		httpCode           int
		code               codes.Code
	}{
		{"guest", "", "", 200, codes.Unauthenticated},
		{"unsigned dev bypass removed", "test-user-5:test@example.test", `{}`, 401, codes.Unauthenticated},
		{"site denied", "signed", `{}`, 403, codes.Unauthenticated},
		{"blocked", "signed", `{"ok":true,"user":{"id":5,"email":"test@example.test","status":"blocked"}}`, 200, codes.Unauthenticated},
		{"missing status", "signed", `{"ok":true,"user":{"id":5,"email":"test@example.test"}}`, 200, codes.Unauthenticated},
		{"invalid ID", "signed", `{"ok":true,"user":{"id":0,"email":"test@example.test","status":"active"}}`, 200, codes.Unauthenticated},
		{"not OK", "signed", `{"ok":false,"user":{"id":5,"email":"test@example.test","status":"active"}}`, 200, codes.Unauthenticated},
		{"offline", "signed", `{}`, 500, codes.Unavailable},
		{"malformed", "signed", `not json`, 200, codes.Unavailable},
		{"oversized", "signed", strings.Repeat(" ", 65537), 200, codes.Unavailable},
		{"valid canonical account", "signed", `{"ok":true,"user":{"id":5,"email":"test@example.test","status":"active"}}`, 200, codes.OK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Cookie") != "aizaschita-app-session="+tc.cookie {
					t.Error("unexpected cookie")
				}
				w.WriteHeader(tc.httpCode)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			provider := NewMetadataCookieProvider(dcHTTP.NewDcHTTPClient(nil, server.Client()), testOptions{url: server.URL})
			ctx := context.Background()
			if tc.cookie != "" {
				ctx = middleware.SetAuthCookie(ctx, tc.cookie)
			}
			user, err := provider.GetAuthUserId(ctx)
			if status.Code(err) != tc.code {
				t.Fatalf("expected %s, got %v", tc.code, err)
			}
			if tc.cookie == "" && calls != 0 {
				t.Fatal("guest reached site")
			}
			if tc.cookie != "" && calls != 1 {
				t.Fatal("cookie bypassed site validation")
			}
			if tc.code == codes.OK && (user.GetID() != 5 || user.Email != "test@example.test") {
				t.Fatal("wrong canonical account")
			}
		})
	}
}

func TestRedirectAndCanceledRequestsFailClosed(t *testing.T) {
	leaks := 0
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaks++ }))
	defer target.Close()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer site.Close()
	client := site.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	p := NewMetadataCookieProvider(dcHTTP.NewDcHTTPClient(nil, client), testOptions{url: site.URL})
	ctx := middleware.SetAuthCookie(context.Background(), "signed")
	if _, err := p.GetAuthUserId(ctx); status.Code(err) != codes.Unavailable {
		t.Fatalf("redirect accepted: %v", err)
	}
	if leaks != 0 {
		t.Fatal("session leaked through redirect")
	}
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := p.GetAuthUserId(ctx); status.Code(err) != codes.Unavailable {
		t.Fatalf("canceled request accepted: %v", err)
	}
}
