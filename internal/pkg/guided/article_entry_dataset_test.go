package guided

import (
	"context"
	"os"
	"testing"
)

// TestArticleEntryPilotDataset checks the reviewed pilot against an explicit data artifact.
// It performs no network requests, database writes, or semantic search.
func TestArticleEntryPilotDataset(t *testing.T) {
	filename := os.Getenv("GUIDED_ARTICLE_TEST_DATA")
	if filename == "" {
		t.Skip("set GUIDED_ARTICLE_TEST_DATA to the reviewed runtime JSON")
	}
	r, err := Load(filename, nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, pilot := range []struct {
		variantID    string
		maxQuestions int
	}{
		{"pps_street_stop_v11", 1},
		{"phone_police_show_phone_v05", 2},
		{"phone_police_phone_seizure_v05", 2},
		{"gosuslugi_access_unauthorized_services_v09", 3},
	} {
		t.Run(pilot.variantID, func(t *testing.T) {
			entry, err := r.RespondFromEntry(context.Background(), "", nil, "untrusted-category", pilot.variantID)
			if err != nil {
				t.Fatal(err)
			}
			if entry.Status != "question" || len(entry.Guided.Context) != 0 || entry.Guided.EntryVariantID != pilot.variantID {
				t.Fatalf("pilot entry is unavailable or inferred facts: %+v", entry)
			}
			stage := r.Bundle.Stages[entry.Guided.CategoryID+"."+entry.Guided.StageID]
			pending := []*Response{entry}
			seen := map[string]bool{}
			outcomes := map[string]bool{}
			questions, resolved, conflicts, maxQuestions := 0, 0, 0, 0
			for len(pending) > 0 {
				response := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				key := Key(response.Guided.Context)
				if seen[key] {
					t.Fatalf("duplicate or cyclic transition: %s", key)
				}
				seen[key] = true
				if response.Guided.EntryVariantID != pilot.variantID || response.Guided.CategoryID != stage.CategoryID || response.Guided.StageID != stage.StageID {
					t.Fatalf("entry provenance or stage changed during factual answers: %+v", response.Guided)
				}
				if len(response.Guided.Context) > pilot.maxQuestions {
					t.Fatalf("pilot exceeds its %d-question bound: %s", pilot.maxQuestions, key)
				}
				if len(response.Guided.Context) > maxQuestions {
					maxQuestions = len(response.Guided.Context)
				}
				switch response.Status {
				case "question":
					questions++
					if response.Answer.VariantID != "" || len(response.Answer.Next) == 0 || len(response.Answer.Next[0].View) != 3 {
						t.Fatal("question exposed an outcome or lost tri-state choices")
					}
					field := stage.Nodes[key].Field
					choices := response.Answer.Next[0].View
					for index, choice := range choices {
						value, exists := choice.Guided.Context[field]
						if !exists || len(choice.Guided.Context) != len(response.Guided.Context)+1 {
							t.Fatalf("choice did not add exactly its explicit fact: %+v", choice.Guided)
						}
						if (index == 0 && (value == nil || !*value)) || (index == 1 && (value == nil || *value)) || (index == 2 && value != nil) {
							t.Fatalf("true, false, and unknown were conflated at %s", key)
						}
						child, err := r.RespondFromEntry(context.Background(), choice.Question, &choice.Guided, "", pilot.variantID)
						if err != nil {
							t.Fatalf("dead transition at %s: %v", key, err)
						}
						pending = append(pending, child)
					}
				case "resolved":
					resolved++
					if response.Answer.VariantID != stage.Nodes[key].VariantID || response.Answer.VariantID == "" {
						t.Fatal("resolved answer differs from the reviewed graph")
					}
					outcomes[response.Answer.VariantID] = true
				case "conflict":
					conflicts++
					if response.Answer.VariantID != "" {
						t.Fatal("conflicting facts produced an answer variant")
					}
					if expected := stage.Nodes[key].Question; expected != "" && response.Answer.Content != expected {
						t.Fatal("conflict explanation was replaced by advice")
					}
				default:
					t.Fatalf("unexpected pilot status: %s", response.Status)
				}
			}
			if len(seen) != len(stage.Nodes) || resolved == 0 || len(outcomes) < 2 {
				t.Fatalf("incomplete traversal or pinned outcome: %d/%d nodes, %d resolved, %d outcomes", len(seen), len(stage.Nodes), resolved, len(outcomes))
			}
			t.Logf("nodes=%d questions=%d resolved=%d conflicts=%d outcomes=%d max_questions=%d", len(seen), questions, resolved, conflicts, len(outcomes), maxQuestions)
		})
	}
}
