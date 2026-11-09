package chatcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
)

const envelope = "azchat:v1:"

var (
	ErrKeyFile    = errors.New("chat encryption key file missing or invalid")
	ErrUnreadable = errors.New("chat ciphertext is not readable")
	keyIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
)

type Keyring struct {
	active string
	keys   map[string]cipher.AEAD
}

func Load(file string) (*Keyring, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, ErrKeyFile
	}
	defer clear(raw)
	var spec struct {
		Active string            `json:"active"`
		Keys   map[string]string `json:"keys"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil || !keyIDPattern.MatchString(spec.Active) {
		return nil, ErrKeyFile
	}
	ring := &Keyring{active: spec.Active, keys: make(map[string]cipher.AEAD, len(spec.Keys))}
	for id, encoded := range spec.Keys {
		rawKey, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || len(rawKey) != 32 || !keyIDPattern.MatchString(id) || base64.StdEncoding.EncodeToString(rawKey) != encoded {
			clear(rawKey)
			return nil, ErrKeyFile
		}
		block, err := aes.NewCipher(rawKey)
		clear(rawKey)
		if err != nil {
			return nil, ErrKeyFile
		}
		aead, err := cipher.NewGCMWithRandomNonce(block)
		if err != nil {
			return nil, ErrKeyFile
		}
		ring.keys[id] = aead
	}
	if ring.keys[ring.active] == nil {
		return nil, ErrKeyFile
	}
	return ring, nil
}

// Seal binds a value to its record and field. The caller supplies an unambiguous scope.
func (r *Keyring) Seal(scope, value string) (string, error) {
	if r == nil || r.keys[r.active] == nil {
		return "", ErrKeyFile
	}
	prefix := envelope + r.active + ":"
	sealed := r.keys[r.active].Seal(nil, nil, []byte(value), []byte(prefix+scope))
	return prefix + base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (r *Keyring) Open(scope, value string) (string, error) {
	if r == nil {
		return "", ErrKeyFile
	}
	body, ok := strings.CutPrefix(value, envelope)
	id, encoded, delimited := strings.Cut(body, ":")
	key := r.keys[id]
	if !ok || !delimited || key == nil {
		return "", ErrUnreadable
	}
	sealed, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(sealed) < key.Overhead() || base64.RawURLEncoding.EncodeToString(sealed) != encoded {
		return "", ErrUnreadable
	}
	plain, err := key.Open(nil, nil, sealed, []byte(envelope+id+":"+scope))
	if err != nil {
		return "", ErrUnreadable
	}
	return string(plain), nil
}
