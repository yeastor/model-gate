// Package guided serves a table compiled by the existing next-question resolver.
// Embeddings select navigation choices only; they never supply confirmed facts.
package guided

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/qdrant/go-client/qdrant"
	"model-gate/internal/pkg/embedding"
	formatted "model-gate/internal/pkg/formater/answer"
)

type State struct {
	Conversation   json.RawMessage  `json:"conversation,omitempty"`
	Native         json.RawMessage  `json:"native,omitempty"`
	Version        string           `json:"version,omitempty"`
	CategoryID     string           `json:"categoryId,omitempty"`
	StageID        string           `json:"stageId,omitempty"`
	EntryVariantID string           `json:"entryVariantId,omitempty"`
	Context        map[string]*bool `json:"context"`
}
type Node struct {
	Status    string `json:"status"`
	Question  string `json:"question"`
	Field     string `json:"field"`
	VariantID string `json:"variantId"`
}
type Stage struct {
	CategoryID string          `json:"categoryId"`
	StageID    string          `json:"stageId"`
	Name       string          `json:"name"`
	Nodes      map[string]Node `json:"nodes"`
}
type Bundle struct {
	ArticleDocuments map[string][]ArticleDocument `json:"articleDocuments"`
	Version          string                       `json:"version"`
	Categories       []formatted.Category         `json:"categories"`
	Stages           map[string]Stage             `json:"stages"`
	Rows             map[string]formatted.Payload `json:"rows"`
}
type ArticleDocument struct {
	LinkID    string `json:"linkId"`
	Title     string `json:"title"`
	Condition string `json:"condition"`
}
type View struct {
	Type       string `json:"type"`
	ID         string `json:"id"`
	Value      string `json:"value"`
	Question   string `json:"question"`
	CategoryID string `json:"categoryId"`
	VariantID  string `json:"variantId"`
	Guided     State  `json:"guided"`
}
type Next struct {
	Type         string `json:"type"`
	QuestionText string `json:"questionText"`
	View         []View `json:"view"`
}
type Answer struct {
	Content   string             `json:"content"`
	Category  formatted.Category `json:"category"`
	Next      []Next             `json:"next"`
	VariantID string             `json:"variantId,omitempty"`
}
type HistoryEnvelope struct {
	UserMessage *bool  `json:"userMessage,omitempty"`
	TurnID      string `json:"turnId"`
	MessageID   string `json:"messageId"`
	CreatedAt   string `json:"createdAt"`
	Question    string `json:"question"`
	Answer      string `json:"answer"`
	Category    string `json:"category"`
	ResponseID  string `json:"responseId"`
}
type Response struct {
	Conversation    json.RawMessage  `json:"conversation,omitempty"`
	Presentation    json.RawMessage  `json:"presentation,omitempty"`
	Turn            json.RawMessage  `json:"turn,omitempty"`
	HistoryEnvelope *HistoryEnvelope `json:"_historyEnvelope,omitempty"`
	Answer          Answer           `json:"answer"`
	Guided          State            `json:"guided"`
	Status          string           `json:"status"`
}
type Runtime struct {
	Bundle     Bundle
	embeddings embedding.Processor
	client     *qdrant.Client
	collection string
}

func Load(filename string, emb embedding.Processor, client *qdrant.Client, collection string) (*Runtime, error) {
	bytes, err := os.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	r := &Runtime{embeddings: emb, client: client, collection: collection}
	if err = json.Unmarshal(bytes, &r.Bundle); err != nil {
		return nil, err
	}
	if len(r.Bundle.Version) != 64 || len(r.Bundle.Stages) == 0 {
		return nil, fmt.Errorf("invalid guided bundle")
	}
	for key, s := range r.Bundle.Stages {
		if key != s.CategoryID+"."+s.StageID {
			return nil, fmt.Errorf("invalid stage key")
		}
		if _, ok := s.Nodes[""]; !ok {
			return nil, fmt.Errorf("missing initial state")
		}
		for _, n := range s.Nodes {
			if n.Status == "resolved" {
				p, ok := r.Bundle.Rows[n.VariantID]
				if !ok || p.Category.ID != s.CategoryID || p.Stage.ID != s.StageID {
					return nil, fmt.Errorf("invalid outcome binding")
				}
			}
		}
	}
	return r, nil
}
func Key(facts map[string]*bool) string {
	keys := make([]string, 0, len(facts))
	for k := range facts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		v := "null"
		if facts[k] != nil {
			v = strconv.FormatBool(*facts[k])
		}
		pairs = append(pairs, k+"="+v)
	}
	return strings.Join(pairs, "&")
}
func clone(s State) State {
	c := map[string]*bool{}
	for k, v := range s.Context {
		c[k] = v
	}
	s.Context = c
	return s
}
func (r *Runtime) view(label string, s State) View {
	return View{Type: "badge", ID: label, Value: label, Question: label, CategoryID: s.CategoryID, Guided: s}
}

// RespondFromEntry uses an article variant only to select the initial stage.
// Existing guided state always wins over an entry link, including a reset.
func (r *Runtime) RespondFromEntry(ctx context.Context, question string, input *State, categoryID, variantID string) (*Response, error) {
	if input != nil || variantID == "" {
		return r.Respond(ctx, question, input, categoryID)
	}
	payload, ok := r.Bundle.Rows[variantID]
	if ok && r.hasEntryStage(payload.Category.ID, payload.Stage.ID) {
		return r.Respond(ctx, question, &State{
			Version: r.Bundle.Version, CategoryID: payload.Category.ID, StageID: payload.Stage.ID,
			EntryVariantID: variantID, Context: map[string]*bool{},
		})
	}
	// Do not silently replace an unavailable exact entry with semantic search.
	response, err := r.Respond(ctx, "", &State{Context: map[string]*bool{}})
	if err != nil {
		return nil, err
	}
	response.Status = "entry_unavailable"
	response.Answer.Content = "Сценарий из статьи сейчас недоступен. Выберите подходящий раздел ниже — затем уточним обстоятельства вашей ситуации."
	return response, nil
}

func (r *Runtime) hasEntryStage(categoryID, stageID string) bool {
	if categoryID == "" || stageID == "" {
		return false
	}
	stage, ok := r.Bundle.Stages[categoryID+"."+stageID]
	if !ok || stage.CategoryID != categoryID || stage.StageID != stageID {
		return false
	}
	if _, ok = stage.Nodes[""]; !ok {
		return false
	}
	for _, category := range r.Bundle.Categories {
		if category.ID == categoryID {
			return true
		}
	}
	return false
}

func (r *Runtime) Respond(ctx context.Context, question string, input *State, searchCategory ...string) (*Response, error) {
	s := State{Version: r.Bundle.Version, Context: map[string]*bool{}}
	if input == nil && len(searchCategory) > 0 {
		s.CategoryID = searchCategory[0]
	}
	if input != nil {
		s = clone(*input)
		if (s.Version != "" && s.Version != r.Bundle.Version) || (len(s.Context) > 0 && s.Version != r.Bundle.Version) {
			return nil, fmt.Errorf("outdated guided state; restart required")
		}
		s.Version = r.Bundle.Version
	}
	if s.EntryVariantID != "" {
		entry, ok := r.Bundle.Rows[s.EntryVariantID]
		if !ok || entry.Category.ID != s.CategoryID || entry.Stage.ID != s.StageID {
			s.EntryVariantID = ""
		}
	}
	result := &Response{Guided: s, Status: "navigation", Answer: Answer{Content: "Выберите подходящую ситуацию. Факты уточним отдельно.", Next: []Next{}}}
	if s.CategoryID != "" {
		found := false
		for _, c := range r.Bundle.Categories {
			if c.ID == s.CategoryID {
				found = true
				result.Answer.Category = c
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown category")
		}
	}
	choices := []View{}
	searched := false
	if s.StageID == "" {
		if len(s.Context) > 0 {
			return nil, fmt.Errorf("facts require a stage")
		}
		if input == nil && strings.TrimSpace(question) != "" && r.embeddings != nil && r.client != nil {
			searched = true
			result.Answer.Content = "Ниже похожие ситуации из доступных разделов. Поиск может ошибиться: выберите только подходящий вариант. Если нужного нет, нажмите «Ни один вариант» — факты вашего дела пока не подтверждены."
			emb, err := r.embeddings.GetEmbedding(ctx, &embedding.EmbQuestion{Question: question})
			if err != nil {
				return nil, err
			}
			limit := uint64(5)
			var filter *qdrant.Filter
			if s.CategoryID != "" {
				filter = &qdrant.Filter{Must: []*qdrant.Condition{qdrant.NewMatch("category.id", s.CategoryID)}}
			}
			hits, err := r.client.Query(ctx, &qdrant.QueryPoints{CollectionName: r.collection, Query: qdrant.NewQueryDense(emb.Vector), Filter: filter, Limit: &limit, WithPayload: qdrant.NewWithPayload(true)})
			if err != nil {
				return nil, err
			}
			seen := map[string]bool{}
			for _, hit := range hits {
				c := hit.Payload["category"].GetStructValue().GetFields()["id"].GetStringValue()
				st := hit.Payload["stage"].GetStructValue().GetFields()["id"].GetStringValue()
				stage, ok := r.Bundle.Stages[c+"."+st]
				if !ok || seen[c+"."+st] {
					continue
				}
				seen[c+"."+st] = true
				label := stage.Name
				if s.CategoryID == "" {
					for _, category := range r.Bundle.Categories {
						if category.ID == c {
							label = category.Name + " — " + stage.Name
							break
						}
					}
				}
				choices = append(choices, r.view(label, State{Version: r.Bundle.Version, CategoryID: c, StageID: st, Context: map[string]*bool{}}))
			}
			if s.CategoryID == "" {
				// First confirm the subject. A nearest stage can belong to the wrong
				// domain, even with a high score. Never carry it into factual questions.
				categories := []View{}
				seenCategories := map[string]bool{}
				for _, choice := range choices {
					if seenCategories[choice.Guided.CategoryID] {
						continue
					}
					for _, category := range r.Bundle.Categories {
						if category.ID == choice.Guided.CategoryID {
							categories = append(categories, r.view(category.Name, State{Version: r.Bundle.Version, CategoryID: category.ID, Context: map[string]*bool{}}))
							seenCategories[category.ID] = true
							break
						}
					}
				}
				choices = categories
				result.Answer.Content = "Сначала уточним тему вопроса. Поиск может ошибиться: выберите подходящий раздел. Если вопросов несколько, начните с самого срочного; остальные можно разобрать отдельно. Если нужного раздела нет или вы не уверены, нажмите «Ни один вариант». Факты вашего дела пока не подтверждены."
			}
		}
		if s.CategoryID != "" && len(choices) == 0 {
			keys := []string{}
			for key, stage := range r.Bundle.Stages {
				if stage.CategoryID == s.CategoryID {
					keys = append(keys, key)
				}
			}
			sort.Strings(keys)
			for _, key := range keys {
				stage := r.Bundle.Stages[key]
				ns := clone(s)
				ns.StageID = stage.StageID
				choices = append(choices, r.view(stage.Name, ns))
			}
		}
		choiceTitle := "Ситуации"
		if searched && s.CategoryID == "" {
			choiceTitle = "К какой теме относится вопрос?"
		}
		result.Answer.Next = append(result.Answer.Next, Next{Type: "choice", QuestionText: choiceTitle, View: choices})
		if searched {
			result.Answer.Next = append(result.Answer.Next, Next{Type: "choice", QuestionText: "Если поиск не подошёл", View: []View{r.view("Ни один вариант", State{Version: r.Bundle.Version, Context: map[string]*bool{}})}})
		}
		if input != nil && s.CategoryID == "" && question == "Ни один вариант" {
			result.Answer.Content = "Подходящий раздел пока не выбран. Уточните, кто участвует в ситуации и что произошло: например, сотрудник полиции, работодатель, банк или управляющая компания. Ниже все доступные разделы. Если вашего вопроса среди них нет, готового ответа в этой локальной базе пока нет; выбирать случайную тему не нужно."
		}
	} else {
		stage, ok := r.Bundle.Stages[s.CategoryID+"."+s.StageID]
		if !ok {
			return nil, fmt.Errorf("unknown stage")
		}
		node, ok := stage.Nodes[Key(s.Context)]
		if !ok {
			return nil, fmt.Errorf("invalid context or skipped transition")
		}
		result.Status = node.Status
		switch node.Status {
		case "question":
			result.Answer.Content = node.Question
			for _, value := range []*bool{boolPointer(true), boolPointer(false), nil} {
				ns := clone(s)
				ns.Context[node.Field] = value
				label := "Неизвестно / не относится"
				if value != nil {
					label = "Нет"
					if *value {
						label = "Да"
					}
				}
				view := r.view(label, ns)
				view.Question = node.Question + " — " + label
				choices = append(choices, view)
			}
			result.Answer.Next = append(result.Answer.Next, Next{Type: "choice", QuestionText: "Выберите ответ; неизвестное не означает «Нет».", View: choices})
		case "resolved":
			payload := r.Bundle.Rows[node.VariantID]
			result.Answer.Content = formatted.NewMultiFormater().Format(&payload)
			for _, law := range payload.Answer.Laws {
				if strings.HasPrefix(law.URL, "/laws/") && !strings.ContainsAny(law.URL, "\"'<> \t\r\n") {
					link := " — <a href=\"" + html.EscapeString(law.URL) + "\">Открыть норму</a>"
					result.Answer.Content = strings.ReplaceAll(result.Answer.Content, " — "+law.URL, link)
				}
			}
			result.Answer.VariantID = node.VariantID
			for _, destination := range payload.Answer.WhereTo {
				if destination.DocumentLinkID != "" {
					result.Answer.Content += "\n<a href=\"/documents/link/" + html.EscapeString(destination.DocumentLinkID) + "\">Открыть документ: " + html.EscapeString(destination.Title) + "</a>"
				}
			}
			for _, document := range r.Bundle.ArticleDocuments[node.VariantID] {
				result.Answer.Content += "\n" + document.Condition + " <a href=\"/documents/link/" + html.EscapeString(document.LinkID) + "\">" + html.EscapeString(document.Title) + "</a>"
			}
		default:
			result.Answer.Content = "Для указанных обстоятельств в сохранённых сценариях пока нет готовой ветки ответа. Это не означает, что вы ответили неправильно. Не заменяйте подтверждённое «Нет» на «Неизвестно» ради получения результата. Если вы ошиблись, можно исправить ответ; иначе выберите другую подходящую ситуацию. Неизвестные факты не нужно угадывать."
			if node.Status == "conflict" && node.Question != "" {
				result.Answer.Content = node.Question
			}
		}
		restart := State{Version: r.Bundle.Version, CategoryID: s.CategoryID, StageID: s.StageID, EntryVariantID: s.EntryVariantID, Context: map[string]*bool{}}
		result.Answer.Next = append(result.Answer.Next, Next{Type: "choice", QuestionText: "Уточнить заново", View: []View{r.view("Исправить ответы", restart)}})
	}
	categories := []View{}
	for _, c := range r.Bundle.Categories {
		categories = append(categories, r.view(c.Name, State{Version: r.Bundle.Version, CategoryID: c.ID, Context: map[string]*bool{}}))
	}
	result.Answer.Next = append(result.Answer.Next, Next{Type: "choice", QuestionText: "Другая категория", View: categories})
	return result, nil
}
func boolPointer(v bool) *bool { return &v }
