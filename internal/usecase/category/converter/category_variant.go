package converter

import (
	"errors"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/formater/answer"
)

var ErrCategoryAlreadyChecked = errors.New("category already checked")

func FromProcessorVectorAnswerToUseCaseNext(logger usecase.Logger, payload map[string]string, categoryChecked map[string]bool) (*usecase.View, error) {
	const ErrorText = "category payload field is missing"
	//next := &usecase.Next{}
	//.Type = answer.NextTypeBadge

	key := "category_id"
	raw, ok := payload[key]
	if !ok {
		logger.Error(ErrorText, "key", key)
	}

	if _, isChecked := categoryChecked[raw]; isChecked {
		return nil, ErrCategoryAlreadyChecked
	}

	view := &usecase.View{}
	view.Type = answer.NextTypeBadge
	view.CategoryID = raw

	key = "category_name"
	raw, ok = payload[key]
	if !ok {
		logger.Error(ErrorText, "key", key)
	}
	view.ID = raw
	view.Value = raw
	view.Question = raw
	//next.View = append(next.View, view)

	return view, nil
}
