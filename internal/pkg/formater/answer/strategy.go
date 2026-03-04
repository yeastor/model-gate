package answer

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
	return NewMultiFormater(), nil
}
