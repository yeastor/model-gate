package processor

import (
	"context"
	"fmt"
	"model-gate/internal/pkg/embedding"

	"github.com/qdrant/go-client/qdrant"
)

type Qdrant struct {
	client             *qdrant.Client
	embeddingProcessor embedding.Processor
	options            Options
	logger             Logger
}

func NewQdrant(client *qdrant.Client, embeddingProcessor embedding.Processor, options Options, logger Logger) *Qdrant {
	return &Qdrant{client: client, embeddingProcessor: embeddingProcessor, options: options, logger: logger}
}

func (q *Qdrant) GetAnswer(ctx context.Context, question *Question) ([]VectorAnswer, error) {

	embQuestion := &embedding.EmbQuestion{Question: question.Question}

	embAnswer, err := q.embeddingProcessor.GetEmbedding(ctx, embQuestion)
	if err != nil {
		return nil, err
	}

	searchResult, err := q.client.Query(context.Background(), &qdrant.QueryPoints{
		CollectionName: q.options.GetVectorMainCollection(),
		Query:          qdrant.NewQueryDense(embAnswer.Vector),
		WithPayload:    qdrant.NewWithPayload(true),
		WithVectors:    qdrant.NewWithVectors(true),
	})
	if err != nil {
		return nil, err
	}

	answer := make([]VectorAnswer, len(searchResult))
	for i, sr := range searchResult {
		payloads := make(map[string]string, len(sr.Payload))

		for key, value := range sr.GetPayload() {
			payloads[key] = value.GetStringValue()
		}
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
