package api_test

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	categoryusecase "model-gate/internal/usecase/category"
	desc "model-gate/pkg/modelgate"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
)

const chatPath = "/model/chat/chat"

func TestChatReturnsAnswerForPPSCategory(t *testing.T) {
	response := callChat(t, &desc.ChatBody{
		Question: &desc.ChatQuestion{
			Q: "телефон забрали",
			Category: &desc.Category{
				Id: "pps",
			},
		},
		Chat: &desc.Chat{
			Id: "0e2840da-78a6-4307-bf73-ea4b54797c0c",
		},
	})

	assert.NotEmpty(t, response.GetAnswer().GetContent())
	assert.Len(t, response.GetAnswer().GetNext(), 0)
	require.NotNil(t, response.GetAnswer().GetCategory())
	assert.Equal(t, "pps", response.GetAnswer().GetCategory().GetId())
}

func TestChatReturnsCategoryChoicesWhenCategoryIsNotSpecified(t *testing.T) {
	response := callChat(t, &desc.ChatBody{
		Chat: &desc.Chat{
			Id: "d7524bd8-2c92-4d32-b0e2-1ba55fc1ef32",
		},
		Question: &desc.ChatQuestion{
			Q: "задержаи",
		},
	})

	require.NotNil(t, response.GetAnswer())
	assert.Equal(t, categoryusecase.TextChooseCategory, response.GetAnswer().GetContent())
	assert.Nil(t, response.GetAnswer().GetCategory())
	require.Len(t, response.GetAnswer().GetNext(), 1)
	actualView := response.GetAnswer().GetNext()[0].GetView()
	require.Len(t, actualView, 2)
	assertView(t, actualView[0], "badge", "задержаи", "ппс", "ппс", "pps", "")
	assertView(t, actualView[1], "badge", "задержаи", "дпс", "дпс", "dps", "")
}

func assertView(t *testing.T, actual *desc.View, expectedType string, expectedID string, expectedValue string, expectedQuestion string, expectedCategoryID string, expectedVariantID string) {
	t.Helper()

	require.NotNil(t, actual)
	assert.Equal(t, expectedType, actual.GetType())
	assert.Equal(t, expectedID, actual.GetId())
	assert.Equal(t, expectedValue, actual.GetValue())
	assert.Equal(t, expectedQuestion, actual.GetQuestion())
	assert.Equal(t, expectedCategoryID, actual.GetCategoryId())
	assert.Equal(t, expectedVariantID, actual.GetVariantId())
}

func callChat(t *testing.T, requestBody *desc.ChatBody) *desc.ChatResponse {
	t.Helper()

	endpoint, err := url.JoinPath(getServiceEndpoint(t), chatPath)
	require.NoError(t, err)

	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(requestBody)
	require.NoError(t, err)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, endpoint, bytes.NewReader(payload))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", "aizaschita-app-session=test-user-7:yeastor@yandex.ru")

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	require.NoErrorf(t, err, "request to %s failed; ensure the service is running", endpoint)
	defer func() {
		require.NoError(t, resp.Body.Close())
	}()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equalf(t, http.StatusOK, resp.StatusCode, "unexpected response body: %s", string(body))

	var response desc.ChatResponse
	err = protojson.Unmarshal(body, &response)
	require.NoError(t, err)
	require.NotNil(t, response.GetAnswer())

	return &response
}

func getServiceEndpoint(t *testing.T) string {
	t.Helper()

	if endpoint := strings.TrimSpace(os.Getenv("SERVICE_ENDPOINT")); endpoint != "" {
		return endpoint
	}

	endpoint, err := readServiceEndpointFromDotEnv()
	require.NoError(t, err)
	require.NotEmpty(t, endpoint, "SERVICE_ENDPOINT must be set")

	return endpoint
}

func readServiceEndpointFromDotEnv() (string, error) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("determine current file path")
	}

	envPath := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", ".env"))
	file, err := os.Open(envPath)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", envPath, err)
	}
	defer func() {
		_ = file.Close()
	}()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, found := strings.Cut(line, "=")
		if !found || strings.TrimSpace(key) != "SERVICE_ENDPOINT" {
			continue
		}

		return strings.Trim(strings.TrimSpace(value), `"'`), nil
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("scan %s: %w", envPath, err)
	}

	return "", fmt.Errorf("SERVICE_ENDPOINT not found in %s", envPath)
}
