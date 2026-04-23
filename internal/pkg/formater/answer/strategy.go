package answer

import "errors"

const StrategyMulti = "multi"

type FormatStrategy interface {
	Format(payload *Payload) string
}

type StrategyFactory struct {
}

func NewStrategyFactory() *StrategyFactory {
	return &StrategyFactory{}
}

func (factory *StrategyFactory) GetFormater(formater string) (FormatStrategy, error) {
	if formater == StrategyMulti {
		return NewMultiFormater(), nil
	}
	return nil, errors.New("invalid formater:" + formater)
}
