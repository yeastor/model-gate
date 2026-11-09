package modelgate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"model-gate/internal/pkg/guided"
	"net/http"
	"net/url"
	"time"
)

var categoryRuntimeClient = &http.Client{
	// Never forward private requests via an environment proxy or redirect.
	Transport:     &http.Transport{},
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	Timeout:       90 * time.Second,
}

func categoryRuntimeCall(ctx context.Context, base, token, route string, input, output any) error {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Host != "category-runtime:18100") ||
		u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || len(token) < 32 {
		return fmt.Errorf("invalid internal category runtime configuration")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+route, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Category-Token", token)
	res, err := categoryRuntimeClient.Do(req)
	if err != nil {
		return status.Error(codes.Unavailable, "category runtime unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var detail struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&detail)
		switch res.StatusCode {
		case 409:
			return status.Error(codes.Aborted, detail.Error)
		case 403:
			return status.Error(codes.PermissionDenied, "invalid runtime identity")
		case 410:
			return status.Error(codes.NotFound, "conversation deleted")
		case 503:
			return status.Error(codes.Unavailable, "category runtime unavailable")
		default:
			return status.Error(codes.InvalidArgument, "invalid category request")
		}
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1024*1024)).Decode(output)
}

// bundleResponse runs only after the existing owner check and chat lock.
func bundleResponse(ctx context.Context, base, token, userID string, request guidedRequest) (*guided.Response, error) {
	var result guided.Response
	input := struct {
		guidedRequest
		UserID             string          `json:"userId"`
		FeedbackTranscript json.RawMessage `json:"feedbackTranscript,omitempty"`
	}{request, userID, request.feedbackTranscript}
	if err := categoryRuntimeCall(ctx, base, token, "/respond", input, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
