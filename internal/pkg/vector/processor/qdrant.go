package processor

import (
	"context"
	"encoding/json"
	"fmt"
	"model-gate/internal/pkg/embedding"

	"github.com/qdrant/go-client/qdrant"
)

type Qdrant struct {
	client             *qdrant.Client
	embeddingProcessor embedding.Processor
	options            Options
	logger             Logger
	collectionName     string
}

func NewQdrant(
	client *qdrant.Client,
	collectionName string,
	embeddingProcessor embedding.Processor,
	options Options,
	logger Logger) *Qdrant {
	return &Qdrant{
		client:             client,
		collectionName:     collectionName,
		embeddingProcessor: embeddingProcessor,
		options:            options,
		logger:             logger}
}

func (q *Qdrant) GetAnswer(ctx context.Context, question *Question) ([]VectorAnswer, error) {

	searchResult, err := q.getResult(ctx, question)
	if err != nil {
		return nil, err
	}

	answer := make([]VectorAnswer, len(searchResult))
	for i, sr := range searchResult {
		payloads := make(map[string]string, len(sr.Payload))
		for key, value := range sr.GetPayload() {
			newVal := ConvertPayload(value.GetKind())
			switch val := newVal.(type) {
			case string:
				payloads[key] = val
			default:
				res, err := json.Marshal(val)
				if err != nil {
					q.logger.Error("GetAnswer error: " + err.Error())
				}
				payloads[key] = string(res)
			}
		}

		fmt.Printf("%v", payloads)
		answer[i] = Answer{
			payload: payloads,
			score:   sr.GetScore(),
			id:      sr.GetId(),
		}
	}

	log := fmt.Sprint("qdrant answer is: ", answer)

	q.logger.Info(log)

	return answer, nil

}

func ConvertPayload(v any) any {
	switch val := v.(type) {
	case *qdrant.Value_NullValue:
		return val.NullValue.String()
	case *qdrant.Value_BoolValue:
		return val.BoolValue
	case *qdrant.Value_DoubleValue:
		return val.DoubleValue
	case *qdrant.Value_IntegerValue:
		return val.IntegerValue
	case *qdrant.Value_StringValue:
		return val.StringValue
	case *qdrant.Value_ListValue:
		res := make([]any, len(val.ListValue.Values))
		for fkey, value := range val.ListValue.Values {
			res[fkey] = ConvertPayload(value.GetKind())
		}
		return res
	case *qdrant.Value_StructValue:
		res := make(map[string]any, len(val.StructValue.Fields))
		for fkey, value := range val.StructValue.Fields {
			res[fkey] = ConvertPayload(value.GetKind())
		}
		return res
	}

	return nil
}

func (q *Qdrant) getResult(ctx context.Context, question *Question) ([]*qdrant.ScoredPoint, error) {

	var query *qdrant.Query
	var filter *qdrant.Filter

	if question.VariantID != "" {
		filter = &qdrant.Filter{
			Must: []*qdrant.Condition{
				qdrant.NewMatch("variant_id", question.VariantID),
			},
		}
	} else {
		if question.CategoryID != "" {
			filter = &qdrant.Filter{
				Must: []*qdrant.Condition{
					qdrant.NewMatch("category.id", question.CategoryID),
				},
			}
		}

		embQuestion := &embedding.EmbQuestion{Question: question.Question}

		embAnswer, err := q.embeddingProcessor.GetEmbedding(ctx, embQuestion)
		if err != nil {
			return nil, err
		}
		query = qdrant.NewQueryDense(embAnswer.Vector)
	}

	searchResult, err := q.client.Query(context.Background(), &qdrant.QueryPoints{
		CollectionName: q.collectionName,
		Query:          query,
		Filter:         filter,
		WithPayload:    qdrant.NewWithPayload(true),
		WithVectors:    qdrant.NewWithVectors(true),
	})
	if err != nil {
		return nil, err
	}

	return searchResult, nil
}
