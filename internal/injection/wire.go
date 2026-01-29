//go:build wireinject
// +build wireinject

package injection

import (
	"log/slog"
	"model-gate/config"
	modelgateApi "model-gate/internal/api/modelgate"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/model/processor"
	modelgateUsecase "model-gate/internal/usecase/modelgate"
	dcHttp "model-gate/pkg/http"
	"net/http"

	"github.com/google/wire"
)

func InitializeApplicationAPI(logHandler slog.Handler, cfg *config.Config, client *http.Client) *modelgateApi.API {
	wire.Build(

		wire.Bind(new(usecase.Chat), new(*modelgateUsecase.ChatUseCase)),
		processor.NewFactory,

		wire.Bind(new(modelgateUsecase.ChatUseCaseOptions), new(*config.Config)),
		wire.Bind(new(dcHttp.Client), new(*dcHttp.DcHTTPClient)),
		wire.Bind(new(dcHttp.Logger), new(*slog.Logger)),
		//dclogger.NewLogger,
		slog.New,
		wire.Bind(new(processor.Logger), new(*slog.Logger)),
		wire.Bind(new(processor.Options), new(*config.Config)),

		dcHttp.NewDcHTTPClient,
		modelgateUsecase.NewChatUseCase,
		modelgateApi.NewAPI,
	)

	return &modelgateApi.API{}
}
