package embedding

import (
	"context"
	"encoding/json"
	"io"
	dcHttp "model-gate/pkg/http"
)

type BgeM3 struct {
	httpClient dcHttp.Client
	options    Options
	logger     Logger
}

func NewBgeM3(httpClient dcHttp.Client, options Options, logger Logger) *BgeM3 {
	return &BgeM3{httpClient: httpClient, options: options, logger: logger}
}

func (b *BgeM3) GetEmbedding(ctx context.Context, question *EmbQuestion) (*EmbAnswer, error) {

	requestBody, err := json.Marshal(map[string]interface{}{
		"model":  NameBgeM3,
		"prompt": question.Question,
	})

	if err != nil {
		return nil, err
	}

	url := b.options.GetEmbeddingUrl() + "api/embeddings"
	b.httpClient.SetHeaders(map[string]string{"Content-Type": "application/json; charset=utf-8"})
	resp, err := b.httpClient.Post(url, requestBody)
	if err != nil {
		return nil, err
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(resp.Body)

	var result struct {
		Embedding []float32 `json:"embedding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &EmbAnswer{
		Vector: result.Embedding,
	}, nil
}

var _ Processor = (*BgeM3)(nil)
