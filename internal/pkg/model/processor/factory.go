package processor

import (
	"fmt"
	dcHttp "model-gate/pkg/http"
)

const NameDeepSeek = "deepseek-r1"

type Factory struct {
	httpClient dcHttp.Client
	options    Options
	logger     Logger
}

func NewFactory(httpClient dcHttp.Client, options Options, logger Logger) *Factory {
	return &Factory{httpClient: httpClient, options: options, logger: logger}
}

func (f *Factory) GetProcessor(processorName string) (Processor, error) {
	if processorName == NameDeepSeek {
		return NewDeepSeek(
			f.httpClient, f.options, f.logger), nil
	}

	return nil, fmt.Errorf("processor not found %s", processorName)
}
