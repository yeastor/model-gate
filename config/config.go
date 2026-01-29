package config

import (
	"fmt"
	"log/slog"
	"model-gate/internal/pkg/model/processor"
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
)

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
var _ modelgate.ChatUseCaseOptions = (*Config)(nil)
