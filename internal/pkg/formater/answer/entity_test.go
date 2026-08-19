package answer

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestAnswerUnmarshalStructuredLinks(t *testing.T) {
	raw := []byte(`{
		"where_to":[{"title":"Жалоба","document_link_id":"dps_complaint"}],
		"laws":[{"short":"Кратко","ref":"Статья 1","title":"Статья 1. Тест","url":"/laws/test/st-1.html"}]
	}`)

	var result Answer
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("unmarshal structured links: %v", err)
	}

	wantDestinations := []Destination{{Title: "Жалоба", DocumentLinkID: "dps_complaint"}}
	if !reflect.DeepEqual(wantDestinations, result.WhereTo) {
		t.Fatalf("unexpected destinations: %#v", result.WhereTo)
	}
	wantLaws := []Law{{
		Short: "Кратко",
		Ref:   "Статья 1",
		Title: "Статья 1. Тест",
		URL:   "/laws/test/st-1.html",
	}}
	if !reflect.DeepEqual(wantLaws, result.Laws) {
		t.Fatalf("unexpected laws: %#v", result.Laws)
	}
}

func TestAnswerUnmarshalLegacyStringDestination(t *testing.T) {
	var result Answer
	if err := json.Unmarshal([]byte(`{"where_to":["Прокуратура"]}`), &result); err != nil {
		t.Fatalf("unmarshal legacy destination: %v", err)
	}

	want := []Destination{{Title: "Прокуратура"}}
	if !reflect.DeepEqual(want, result.WhereTo) {
		t.Fatalf("unexpected legacy destination: %#v", result.WhereTo)
	}
}
