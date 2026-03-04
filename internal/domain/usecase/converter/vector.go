package converter

import (
	"encoding/json"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/formater/answer"
)

func FromProcessorVectorAnswerToAnswerPayload(logger usecase.Logger, payload map[string]string) (*answer.Payload, error) {
	var vectorAnswer answer.VectorAnswer
	var category answer.Category
	var next answer.Next

	if answerStr, ok := payload["answer"]; ok {
		err := json.Unmarshal([]byte(answerStr), &vectorAnswer)
		if err != nil {
			logger.Error("error Unmarshal answer")
			return nil, err
		}
	} else {
		logger.Error("error No answer in payload")
	}

	if categoryStr, ok := payload["category"]; ok {
		err := json.Unmarshal([]byte(categoryStr), &category)
		if err != nil {
			logger.Error("error Unmarshal category")
			return nil, err
		}
	} else {
		logger.Error("error No category in payload")
	}

	if nextStr, ok := payload["next"]; ok {
		err := json.Unmarshal([]byte(nextStr), &next)
		if err != nil {
			logger.Error("error Unmarshal next")
			return nil, err
		}
	} else {
		logger.Error("error No next in payload")
	}

	payloadRes := &answer.Payload{
		Category: category,
		Answer:   vectorAnswer,
		Next:     next,
	}

	return payloadRes, nil
}
