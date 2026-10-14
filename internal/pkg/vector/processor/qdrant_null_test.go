package processor

import (
	"encoding/json"
	"testing"

	"github.com/qdrant/go-client/qdrant"
)

func TestConvertPayloadPreservesUnknownContext(t *testing.T) {
	unknown := ConvertPayload(&qdrant.Value_NullValue{})
	if unknown != nil {
		t.Fatalf("unknown context must remain nil, got %#v", unknown)
	}
	got, err := json.Marshal(map[string]any{
		"unknown": unknown,
		"denied":  ConvertPayload(&qdrant.Value_BoolValue{BoolValue: false}),
		"known":   ConvertPayload(&qdrant.Value_BoolValue{BoolValue: true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"denied":false,"known":true,"unknown":null}`
	if string(got) != want {
		t.Fatalf("context JSON = %s, want %s", got, want)
	}
}
