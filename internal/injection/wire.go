//go:build wireinject
// +build wireinject

package injection

import (
	"log/slog"
	"model-gate/config"
	modelgateApi "model-gate/internal/api/modelgate"
	"model-gate/internal/domain/repository"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/embedding"
	"model-gate/internal/pkg/formater/answer"
	"model-gate/internal/pkg/model/processor"
	processorvector "model-gate/internal/pkg/vector/processor"
	"model-gate/internal/repository/clickhouse"
	"model-gate/internal/repository/postgres"
	modelgateUsecase "model-gate/internal/usecase/modelgate"
	dcHttp "model-gate/pkg/http"
	"net/http"

	clickhousego "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/qdrant/go-client/qdrant"

	"github.com/google/wire"
)

func InitializeApplicationAPI(
	logHandler slog.Handler,
	cfg *config.Config,
	client *http.Client,
	conn clickhousego.Conn,
	pool *pgxpool.Pool,
	qdrantClient *qdrant.Client,
) *modelgateApi.API {
	wire.Build(

		wire.Bind(new(usecase.Chat), new(*modelgateUsecase.ChatUseCase)),
		//modelgateUsecase.NewChatUseCase
		modelgateUsecase.NewChatUseCase,
		processor.NewFactory,

		wire.Bind(new(usecase.Vector), new(*modelgateUsecase.Vector)),
		modelgateUsecase.NewVector,
		// modelgateUsecase.NewVector
		processorvector.NewFactory,
		//  processorvector.NewFactory
		embedding.NewFactory,
		//  /processorvector.NewFactory
		answer.NewStrategyFactory,

		wire.Bind(new(modelgateUsecase.ChatUseCaseOptions), new(*config.Config)),
		wire.Bind(new(dcHttp.Client), new(*dcHttp.DcHTTPClient)),
		wire.Bind(new(dcHttp.Logger), new(*slog.Logger)),
		//dclogger.NewLogger,
		slog.New,
		wire.Bind(new(processor.Logger), new(*slog.Logger)),
		wire.Bind(new(processor.Options), new(*config.Config)),
		wire.Bind(new(processorvector.Logger), new(*slog.Logger)),
		wire.Bind(new(processorvector.Options), new(*config.Config)),
		wire.Bind(new(embedding.Options), new(*config.Config)),
		wire.Bind(new(embedding.Logger), new(*slog.Logger)),
		wire.Bind(new(usecase.Logger), new(*slog.Logger)),
		//wire.Bind(new(processorvector.Options), new(*config.Config)),
		//wire.Bind(new(embedding.Options), new(*config.Config)),
		dcHttp.NewDcHTTPClient,

		modelgateApi.NewAPI,

		modelgateUsecase.NewAddChatUseCase,
		wire.Bind(new(usecase.AddChatUseCase), new(*modelgateUsecase.AddChatUseCase)),
		modelgateUsecase.NewCheckChatExistsUseCase,
		wire.Bind(new(usecase.CheckChatExistsUseCase), new(*modelgateUsecase.CheckChatExistsUseCase)),
		modelgateUsecase.NewAddMessageUseCase,
		wire.Bind(new(usecase.AddMessageUseCase), new(*modelgateUsecase.AddMessageUseCase)),
		modelgateUsecase.NewMessageListUseCase,
		wire.Bind(new(usecase.MessageListUseCase), new(*modelgateUsecase.MessageListUseCase)),

		clickhouse.NewRepository,
		wire.Bind(new(repository.ClickhouseChatRepository), new(*clickhouse.Repository)),
		postgres.NewRepository,
		wire.Bind(new(repository.ChatRepository), new(*postgres.Repository)),
	)

	return &modelgateApi.API{}
}
