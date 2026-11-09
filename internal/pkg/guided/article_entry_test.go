package guided

import (
	"context"
	"strings"
	"testing"

	formatted "model-gate/internal/pkg/formater/answer"
)

func articleEntryRuntime() *Runtime {
	category := formatted.Category{ID: "entry", Name: "Entry category"}
	stage := formatted.Stage{ID: "situation", Name: "Entry situation"}
	return &Runtime{Bundle: Bundle{
		Version:    strings.Repeat("a", 64),
		Categories: []formatted.Category{category, {ID: "other", Name: "Other category"}},
		Stages: map[string]Stage{
			"entry.situation": {CategoryID: category.ID, StageID: stage.ID, Name: stage.Name, Nodes: map[string]Node{
				"":            {Status: "question", Question: "Has the event happened?", Field: "event"},
				"event=true":  {Status: "resolved", VariantID: "entry_yes"},
				"event=false": {Status: "resolved", VariantID: "entry_no"},
				"event=null":  {Status: "conflict", Question: "More information is needed."},
			}},
			"other.situation": {CategoryID: "other", StageID: stage.ID, Name: "Other situation", Nodes: map[string]Node{
				"": {Status: "question", Question: "Another question?", Field: "other_event"},
			}},
		},
		Rows: map[string]formatted.Payload{
			"entry_yes":        {Category: category, Stage: stage, Answer: formatted.Answer{Now: "Advice after confirmation."}},
			"entry_no":         {Category: category, Stage: stage, Answer: formatted.Answer{Now: "Different advice after a negative answer."}},
			"other_entry":      {Category: formatted.Category{ID: "other"}, Stage: stage},
			"missing_stage":    {Category: category, Stage: formatted.Stage{ID: "missing"}},
			"missing_category": {Category: formatted.Category{ID: "missing"}, Stage: stage},
		},
	}}
}

func TestArticleEntrySelectsExactStageWithoutConfirmingFacts(t *testing.T) {
	r := articleEntryRuntime()
	response, err := r.RespondFromEntry(context.Background(), "Article title", nil, "other", "entry_yes")
	if err != nil {
		t.Fatal(err)
	}
	if response.Status != "question" || response.Answer.Content != "Has the event happened?" || response.Answer.VariantID != "" {
		t.Fatalf("article entry returned advice before confirmation: %+v", response)
	}
	state := response.Guided
	if state.CategoryID != "entry" || state.StageID != "situation" || state.EntryVariantID != "entry_yes" || len(state.Context) != 0 {
		t.Fatalf("article seed supplied facts or trusted URL category: %+v", state)
	}
	for _, choice := range response.Answer.Next[0].View {
		if choice.Guided.EntryVariantID != "entry_yes" || len(choice.Guided.Context) != 1 {
			t.Fatalf("question choice lost entry or added unrelated facts: %+v", choice)
		}
	}
}

func TestArticleEntryCanResolveToDifferentVariant(t *testing.T) {
	r := articleEntryRuntime()
	start, err := r.RespondFromEntry(context.Background(), "Article title", nil, "", "entry_yes")
	if err != nil {
		t.Fatal(err)
	}
	negative := start.Answer.Next[0].View[1]
	response, err := r.RespondFromEntry(context.Background(), negative.Question, &negative.Guided, "other", "other_entry")
	if err != nil {
		t.Fatal(err)
	}
	if response.Status != "resolved" || response.Answer.VariantID != "entry_no" || response.Guided.EntryVariantID != "entry_yes" {
		t.Fatalf("entry pinned the outcome or overrode confirmed state: %+v", response)
	}
	if value := response.Guided.Context["event"]; value == nil || *value {
		t.Fatal("confirmed negative answer was lost")
	}
}

func TestArticleEntryUnavailableOffersRecoverableNavigation(t *testing.T) {
	for _, variantID := range []string{"unknown", "missing_stage", "missing_category", " entry_yes "} {
		t.Run(variantID, func(t *testing.T) {
			r := articleEntryRuntime()
			response, err := r.RespondFromEntry(context.Background(), "Article title", nil, "untrusted-category", variantID)
			if err != nil {
				t.Fatal(err)
			}
			if response.Status != "entry_unavailable" || response.Guided.CategoryID != "" || response.Guided.EntryVariantID != "" || len(response.Guided.Context) != 0 {
				t.Fatalf("unavailable entry did not recover safely: %+v", response)
			}
			categories := response.Answer.Next[len(response.Answer.Next)-1].View
			if len(categories) != 2 {
				t.Fatal("category choices are missing")
			}
			recovery, err := r.RespondFromEntry(context.Background(), categories[0].Question, &categories[0].Guided, "", variantID)
			if err != nil || recovery.Status != "navigation" || recovery.Guided.CategoryID != "entry" {
				t.Fatalf("category selection kept reapplying broken entry: %+v, %v", recovery, err)
			}
		})
	}
}

func TestArticleEntryResumeResetAndTopicChange(t *testing.T) {
	r := articleEntryRuntime()
	start, err := r.RespondFromEntry(context.Background(), "Article title", nil, "", "entry_yes")
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := r.RespondFromEntry(context.Background(), "", &start.Guided, "other", "other_entry")
	if err != nil || resumed.Status != "question" || resumed.Guided.EntryVariantID != "entry_yes" || len(resumed.Guided.Context) != 0 {
		t.Fatalf("resume replaced the active entry: %+v, %v", resumed, err)
	}
	negative := resumed.Answer.Next[0].View[1]
	resolved, err := r.RespondFromEntry(context.Background(), negative.Question, &negative.Guided, "", "")
	if err != nil {
		t.Fatal(err)
	}
	restart := resolved.Answer.Next[0].View[0]
	reset, err := r.RespondFromEntry(context.Background(), restart.Question, &restart.Guided, "", "other_entry")
	if err != nil || reset.Status != "question" || reset.Guided.EntryVariantID != "entry_yes" || len(reset.Guided.Context) != 0 {
		t.Fatalf("reset did not clear facts while preserving its topic: %+v, %v", reset, err)
	}
	other := reset.Answer.Next[len(reset.Answer.Next)-1].View[1]
	changed, err := r.RespondFromEntry(context.Background(), other.Question, &other.Guided, "", "entry_yes")
	if err != nil || changed.Status != "navigation" || changed.Guided.CategoryID != "other" || changed.Guided.EntryVariantID != "" {
		t.Fatalf("article entry prevented changing topic: %+v, %v", changed, err)
	}
}
