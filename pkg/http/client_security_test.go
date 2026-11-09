package http

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPClientLogsOnlyStatus(t *testing.T) {
	const marker = "private-marker"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, marker)
	}))
	defer server.Close()

	var logs bytes.Buffer
	client := NewDcHTTPClient(slog.New(slog.NewJSONHandler(&logs, nil)), server.Client())
	client.SetHeaders(map[string]string{"Authorization": marker})
	response, err := client.PostWithLog(server.URL+"/?token="+marker, []byte(marker), marker)
	if err != nil {
		t.Fatal("request failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != marker {
		t.Fatal("logging must not alter the response")
	}
	if output := logs.String(); strings.Contains(output, marker) || !strings.Contains(output, `"status":200`) {
		t.Fatal("log must report status without URL, body, header or caller data")
	}
}
