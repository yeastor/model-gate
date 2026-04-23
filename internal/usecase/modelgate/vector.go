package modelgate

import (
	"context"
	"errors"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/domain/usecase/converter"
	"model-gate/internal/pkg/formater/answer"
	"model-gate/internal/pkg/vector/processor"
)

var ErrNoVectorFound = errors.New("no vector found for question")

type Vector struct {
	vectorFactory   *processor.Factory
	options         ChatUseCaseOptions
	logger          usecase.Logger
	strategyFactory answer.StrategyFactory
}

func NewVector(vectorFactory *processor.Factory, options ChatUseCaseOptions, logger usecase.Logger, strategyFactory *answer.StrategyFactory) *Vector {
	return &Vector{vectorFactory: vectorFactory, options: options, logger: logger, strategyFactory: *strategyFactory}
}

func (v Vector) Search(ctx context.Context, question *usecase.Question) (*usecase.Answer, error) {

	vectorProcessor, err := v.vectorFactory.GetModelProcessor(v.options.GetVectorModelName(), "")
	if err != nil {
		return nil, err
	}

	vQuestion := &processor.Question{
		Question:   question.Question,
		VariantID:  question.Variant.ID,
		CategoryID: question.Category.ID,
	}
	vAnswers, err := vectorProcessor.GetAnswer(ctx, vQuestion)
	if err != nil {
		return nil, err
	}

	answerStrategyFormater, err := v.strategyFactory.GetFormater(answer.StrategyMulti)

	for _, vAnswer := range vAnswers {
		if vAnswer.GetScore() >= v.options.GetVectorMinScore() {
			payload, err := converter.FromProcessorVectorAnswerToAnswerPayload(v.logger, vAnswer.GetPayload())
			if err != nil {
				return nil, err
			}

			strAnswer := answerStrategyFormater.Format(payload)
			return &usecase.Answer{
				Content: strAnswer,
				Next:    converter.FromProcessorVectorAnswerToAnswerNext(payload.Next),
			}, nil
		}
	}

	return nil, ErrNoVectorFound
}
