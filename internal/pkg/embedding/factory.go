package embedding

import (
	"fmt"
	dcHttp "model-gate/pkg/http"
)

const NameBgeM3 = "bge-m3"

type Factory struct {
	httpClient dcHttp.Client
	options    Options
	logger     Logger
}

func NewFactory(httpClient dcHttp.Client, options Options, logger Logger) *Factory {
	return &Factory{httpClient: httpClient, options: options, logger: logger}
}

func (f *Factory) GetProcessor(processorName string) (Processor, error) {
	if processorName == NameBgeM3 {
		return NewBgeM3(
			f.httpClient, f.options, f.logger), nil
	}

	return nil, fmt.Errorf("embedding processor not found %s", processorName)
}
