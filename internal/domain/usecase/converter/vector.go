package converter

import (
	"encoding/json"
	"fmt"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/formater/answer"
)

func FromProcessorVectorAnswerToAnswerPayload(logger usecase.Logger, payload map[string]string) (*answer.Payload, error) {
	category, err := unmarshalPayloadField[answer.Category](logger, payload, "category")
	if err != nil {
		return nil, err
	}

	stage, err := unmarshalPayloadField[answer.Stage](logger, payload, "stage")
	if err != nil {
		return nil, err
	}

	answerPayload, err := unmarshalPayloadField[answer.Answer](logger, payload, "answer")
	if err != nil {
		return nil, err
	}

	next, err := unmarshalPayloadField[[]answer.NextStep](logger, payload, "next")
	if err != nil {
		return nil, err
	}

	return &answer.Payload{
		Category: category,
		Stage:    stage,
		Answer:   answerPayload,
		Next:     next,
	}, nil
}

func unmarshalPayloadField[T any](logger usecase.Logger, payload map[string]string, key string) (T, error) {
	var result T

	raw, ok := payload[key]
	if !ok {
		logger.Error("payload field is missing", "key", key)
		return result, nil
	}

	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		logger.Error("failed to unmarshal payload field", "key", key, "error", err)
		return result, fmt.Errorf("unmarshal payload field %q: %w", key, err)
	}

	return result, nil
}

func FromProcessorVectorAnswerToAnswerNext(nextSteps []answer.NextStep) []*usecase.Next {
	if nextSteps == nil {
		return nil
	}

	result := make([]*usecase.Next, 0, len(nextSteps))

	for _, nextStep := range nextSteps {
		result = append(result, &usecase.Next{
			QuestionText: nextStep.Question,
			View:         getViews(&nextStep),
		})
	}

	return result
}

func getViews(nextStep *answer.NextStep) []*usecase.View {
	if nextStep.Type != "" {
		viewType := nextStep.Type
		views := make([]*usecase.View, 0, 1)

		views = append(views, &usecase.View{
			Type:      viewType,
			ID:        nextStep.Question,
			VariantID: nextStep.Data.VariantId,
			Value:     nextStep.Question,
		})

		return views
	}

	return nil
}
