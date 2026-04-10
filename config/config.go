package config

import (
	"fmt"
	"log/slog"
	"model-gate/internal/pkg/embedding"
	"model-gate/internal/pkg/model/processor"
	processorvector "model-gate/internal/pkg/vector/processor"
	"model-gate/internal/usecase/modelgate"
	"strings"

	"github.com/caarlos0/env/v10"
)

type (
	Config struct {
		APP `envPrefix:"APP_"`
	}

	APP struct {
		ENV       string `env:"ENV" envDefault:"dev"`
		Ports     `envPrefix:"PORTS_"`
		Log       `envPrefix:"LOG_"`
		Processor `envPrefix:"PROCESSOR_"`
		Embedding `envPrefix:"EMBEDDING_"`
		Vector    `envPrefix:"VECTOR_"`
		DB        `envPrefix:"DB_"`
	}

	Ports struct {
		GRPC string `env:"GRPC" envDefault:"8093"`
		HTTP string `env:"HTTP" envDefault:"8094"`
	}

	Log struct {
		Level string `env:"LEVEL" envDefault:"INFO"`
	}

	Processor struct {
		Model `envPrefix:"MODEL_"`
	}

	Model struct {
		Url  string `env:"URL" envDefault:"http://localhost:11434/"`
		Name string `env:"NAME" envDefault:"deepseek-r1"`
	}

	Vector struct {
		VectorModel `envPrefix:"MODEL_"`
	}

	VectorModel struct {
		Host           string  `env:"HOST" envDefault:"localhost"`
		Port           int     `env:"PORT" envDefault:"6334"`
		Name           string  `env:"NAME" envDefault:"qdrant"`
		MainCollection string  `env:"MAIN_COLLECTION" envDefault:"legal_advice"`
		MinScore       float32 `env:"MIN_SCORE" envDefault:"0.57"`
		MaxCount       int     `env:"MAX_COUNT" envDefault:"1"`
	}

	Embedding struct {
		EmbModel `envPrefix:"MODEL_"`
	}

	EmbModel struct {
		Url  string `env:"URL" envDefault:"http://localhost:11434/"`
		Name string `env:"NAME" envDefault:"bge-m3"`
	}

	DB struct {
		ChatHost     string `env:"CHAT_HOST" envDefault:"127.0.0.1"`
		ChatPort     string `env:"CHAT_PORT" envDefault:"9000"`
		ChatDb       string `env:"CHAT_DB" envDefault:"chat"`
		ChatLogin    string `env:"CHAT_LOGIN" envDefault:"app_chat_user"`
		ChatPassword string `env:"CHAT_PASSWORD" envDefault:"chat"`
	}
)

func (c *Config) GetEmbeddingUrl() string {
	return c.Embedding.EmbModel.Url
}
func (c *Config) GetEmbeddingModelName() string {
	return c.Embedding.EmbModel.Name
}

func (c *Config) GetVectorModelName() string {
	return c.Vector.VectorModel.Name
}

func (c *Config) GetVectorHost() string {
	return c.Vector.VectorModel.Host
}

func (c *Config) GetVectorPort() int {
	return c.Vector.VectorModel.Port
}

func (c *Config) GetVectorMainCollection() string {
	return c.Vector.VectorModel.MainCollection
}

func (c *Config) GetVectorMinScore() float32 {
	return c.Vector.VectorModel.MinScore
}

func (c *Config) GetVectorMaxCount() int {
	return c.Vector.VectorModel.MaxCount
}

func (c *Config) GetModelName() string {
	return c.Processor.Model.Name
}

func NewConfig() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (l *Log) GetLogLevel() (slog.Level, error) {
	switch strings.ToLower(l.Level) {
	case "error":
		return slog.LevelError, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	}

	return slog.LevelInfo, fmt.Errorf("not a valid slog Level: %q", l.Level)
}

func (c *Config) GetModelUrl() string {
	return c.Processor.Model.Url
}

var _ processor.Options = (*Config)(nil)
var _ processorvector.Options = (*Config)(nil)
var _ embedding.Options = (*Config)(nil)
var _ modelgate.ChatUseCaseOptions = (*Config)(nil)
