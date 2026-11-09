package chatcrypto_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"model-gate/internal/pkg/chatcrypto"
	"model-gate/internal/pkg/chatcrypto/cryptotest"
)

func TestAuthenticatedEncryption(t *testing.T) {
	file, keys := cryptotest.New(t)
	const scope = "chat-123/question"
	const value = "synthetic text: тестовая фраза"
	first, err := keys.Seal(scope, value)
	if err != nil || !strings.HasPrefix(first, "azchat:v1:test:") || strings.Contains(first, value) {
		t.Fatal("unexpected encryption envelope", err)
	}
	second, err := keys.Seal(scope, value)
	if err != nil || first == second {
		t.Fatal("reused encryption nonce", err)
	}
	tampered := []byte(first)
	i := len("azchat:v1:test:")
	tampered[i] = 'A'
	if first[i] == 'A' {
		tampered[i] = 'B'
	}
	for _, input := range []struct{ scope, ciphertext string }{
		{"chat-123/answer", first}, {"other/question", first}, {scope, string(tampered)}, {scope, value}, {scope, first + "\n"},
	} {
		if _, err := keys.Open(input.scope, input.ciphertext); !errors.Is(err, chatcrypto.ErrUnreadable) {
			t.Fatal("invalid or misplaced ciphertext was accepted", err)
		}
	}
	_, wrong := cryptotest.New(t)
	if _, err := wrong.Open(scope, first); !errors.Is(err, chatcrypto.ErrUnreadable) {
		t.Fatal("ciphertext readable with wrong key", err)
	}
	reloaded, err := chatcrypto.Load(file)
	if err != nil {
		t.Fatal(err)
	}
	if actual, err := reloaded.Open(scope, first); err != nil || actual != value {
		t.Fatal("unable to restore with correct key", err)
	}
	if _, err := chatcrypto.Load(filepath.Join(t.TempDir(), "absent")); !errors.Is(err, chatcrypto.ErrKeyFile) {
		t.Fatal("missing key file was not rejected", err)
	}
	invalid := filepath.Join(t.TempDir(), "invalid.json")
	if err := os.WriteFile(invalid, []byte(`{"active":"bad","keys":{"bad":"too-short"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := chatcrypto.Load(invalid); !errors.Is(err, chatcrypto.ErrKeyFile) {
		t.Fatal("invalid key file was not rejected", err)
	}
}
