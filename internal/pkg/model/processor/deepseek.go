package processor

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	dcHttp "model-gate/pkg/http"
	"net/http"
)

const ModelName = "deepseek-r1"

type DeepSeek struct {
	httpClient dcHttp.Client
	options    Options
	logger     Logger
}

func NewDeepSeek(httpClient dcHttp.Client, options Options, logger Logger) *DeepSeek {
	return &DeepSeek{httpClient: httpClient, options: options, logger: logger}
}

func (d *DeepSeek) GetAnswer(ctx context.Context, question *Question) (*Answer, error) {
	if question == nil || question.Question == "" {
		return nil, errors.New("question is empty")
	}

	reqBody := chatRequest{
		Model: ModelName,
		Messages: []chatMessage{
			{
				Role:    "user",
				Content: question.Question,
			},
			{
				Role:    "system",
				Content: "Отвечай только на русском языке",
			},
		},
		Stream: false,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	url := d.options.GetModelUrl() + ChatMethodPath

	d.httpClient.SetHeaders(map[string]string{"Content-Type": "application/json; charset=utf-8"})
	resp, err := d.httpClient.Post(url, bodyBytes)
	if err != nil {
		return nil, err
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("chat service returned non-200 status")
	}

	var chatResp chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, err
	}

	return &Answer{
		Content: chatResp.Message.Content,
	}, nil
}

var _ Processor = (*DeepSeek)(nil)

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Model     string `json:"model"`
	CreatedAt string `json:"created_at"`
	Message   struct {
		Role     string `json:"role"`
		Content  string `json:"content"`
		Thinking string `json:"thinking"`
	} `json:"message"`
	Done bool `json:"done"`
}
