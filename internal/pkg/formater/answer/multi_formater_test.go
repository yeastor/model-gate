package answer

import (
	"strings"
	"testing"
)

func TestMultiFormaterRetainsUserFacingLinkMetadata(t *testing.T) {
	payload := &Payload{Answer: Answer{
		WhereTo: []Destination{{Title: "Жалоба", DocumentLinkID: "dps_complaint"}},
		Laws: []Law{{
			Short: "Кратко",
			Ref:   "Статья 1",
			Title: "Статья 1. Тест",
			URL:   "/laws/test/st-1.html",
		}},
	}}

	formatted := NewMultiFormater().Format(payload)

	for _, want := range []string{
		"Жалоба",
		"/documents/link/dps_complaint",
		"Статья 1. Тест",
		"Статья 1",
		"Кратко",
		"/laws/test/st-1.html",
	} {
		if !strings.Contains(formatted, want) {
			t.Fatalf("formatted answer %q does not contain %q", formatted, want)
		}
	}
}

func TestMultiFormaterKeepsLegacyLawOutput(t *testing.T) {
	payload := &Payload{Answer: Answer{
		Laws: []Law{{Short: "Кратко", Ref: "Статья 1"}},
	}}

	want := "🧑‍⚖️ Законы:\n- Кратко (Статья 1)"
	if got := NewMultiFormater().Format(payload); got != want {
		t.Fatalf("unexpected legacy output: got %q, want %q", got, want)
	}
}
