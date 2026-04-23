package processor

import (
	"fmt"
	"model-gate/internal/pkg/embedding"

	"github.com/qdrant/go-client/qdrant"
)

const NameQdrant = "qdrant"

type Factory struct {
	qdrantClient     *qdrant.Client
	embeddingFactory *embedding.Factory
	options          Options
	logger           Logger
}

func NewFactory(qdrantClient *qdrant.Client, embeddingFactory *embedding.Factory, options Options, logger Logger) *Factory {
	return &Factory{qdrantClient: qdrantClient, embeddingFactory: embeddingFactory, options: options, logger: logger}
}

func (f *Factory) GetModelProcessor(processorName string, collectionName string) (Processor, error) {

	embeddingProcessor, err := f.embeddingFactory.GetProcessor(f.options.GetEmbeddingModelName())
	if err != nil {
		return nil, err
	}

	if collectionName == "" {
		collectionName = f.options.GetVectorMainCollection()
	}

	if processorName == NameQdrant {
		return NewQdrant(
			f.qdrantClient, collectionName, embeddingProcessor, f.options, f.logger), nil
	}

	return nil, fmt.Errorf("vector processor not found %s", processorName)
}
