// Package cryptotest provisions disposable chat storage keys for integration tests.
package cryptotest

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"model-gate/internal/pkg/chatcrypto"
	"os"
	"path/filepath"
	"testing"
)

func New(t testing.TB) (string, *chatcrypto.Keyring) {
	t.Helper()
	file := filepath.Join(t.TempDir(), "chat-test-keys.json")
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(map[string]any{
		"active": "test",
		"keys":   map[string]string{"test": base64.StdEncoding.EncodeToString(key)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	ring, err := chatcrypto.Load(file)
	if err != nil {
		t.Fatal(err)
	}
	return file, ring
}
