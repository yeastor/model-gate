package processor

type Options interface {
	GetVectorHost() string
	GetVectorPort() int
	GetVectorMainCollection() string
	GetEmbeddingModelName() string
}
