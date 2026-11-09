package guided

import (
	"context"
	"strings"
	"testing"
)

func TestCompiledResolverAllReachableOutcomes(t *testing.T) {
	r, err := Load("../../../data/guided-runtime.json", nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, stage := range r.Bundle.Stages {
		for key, node := range stage.Nodes {
			facts := map[string]*bool{}
			if key != "" {
				for _, pair := range strings.Split(key, "&") {
					parts := strings.SplitN(pair, "=", 2)
					switch parts[1] {
					case "true":
						facts[parts[0]] = boolPointer(true)
					case "false":
						facts[parts[0]] = boolPointer(false)
					case "null":
						facts[parts[0]] = nil
					default:
						t.Fatal(pair)
					}
				}
			}
			response, err := r.Respond(context.Background(), "", &State{Version: r.Bundle.Version, CategoryID: stage.CategoryID, StageID: stage.StageID, Context: facts})
			if err != nil {
				t.Fatal(err)
			}
			if response.Status != node.Status || response.Answer.VariantID != node.VariantID {
				t.Fatal("resolver parity lost")
			}
			if Key(response.Guided.Context) != key {
				t.Fatal("facts inferred or mutated")
			}
			if node.Status == "resolved" {
				seen[node.VariantID] = true
				if node.VariantID == "debts_overdue_first_days_v02" && !strings.Contains(response.Answer.Content, "<a href=\"/laws/gk-rf-part2/st-811.html\">") {
					t.Fatal("local legal source link is not clickable")
				}
			}
			if node.Status == "question" {
				if len(response.Answer.Next[0].View) != 3 {
					t.Fatal("tri-state choices missing")
				}
				for _, v := range response.Answer.Next[0].View {
					if _, ok := stage.Nodes[Key(v.Guided.Context)]; !ok {
						t.Fatal("dead transition")
					}
				}
			}
			if node.Status == "conflict" && node.Question != "" && response.Answer.Content != node.Question {
				t.Fatal("material contradiction explanation missing")
			}
		}
	}
	if len(seen) != len(r.Bundle.Rows) || len(seen) != 4559 || len(r.Bundle.Stages) != 80 {
		t.Fatalf("coverage: %d outcomes", len(seen))
	}
}

func TestGuidedRejectsStaleForeignAndForgedFacts(t *testing.T) {
	r, err := Load("../../../data/guided-runtime.json", nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []State{
		{CategoryID: "missing"},
		{CategoryID: "dps", StageID: "foreign"},
		{Version: "stale", CategoryID: "dps", StageID: "protocol"},
		{Version: r.Bundle.Version, CategoryID: "dps", StageID: "protocol", Context: map[string]*bool{"invented": nil}},
		{CategoryID: "dps", StageID: "protocol", Context: map[string]*bool{"copy_received": boolPointer(true)}},
	} {
		if _, err := r.Respond(context.Background(), "", &state); err == nil {
			t.Fatal("accepted invalid state")
		}
	}
	unknown := map[string]*bool{"fact": nil}
	negative := map[string]*bool{"fact": boolPointer(false)}
	if Key(unknown) == Key(negative) || Key(unknown) == Key(nil) {
		t.Fatal("unknown, false and unanswered must remain distinct")
	}
}
