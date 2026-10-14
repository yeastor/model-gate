//go:generate protoc --proto_path api --go_opt=paths=source_relative --go-grpc_opt=paths=source_relative --go_out=pkg --go-grpc_out=pkg api/modelgate/modelgate.proto
//go:generate protoc -I=api --grpc-gateway_opt=paths=source_relative --grpc-gateway_out=logtostderr=true:pkg api/modelgate/modelgate.proto
//go:generate protoc -I=api --validate_out=paths=source_relative,lang=go:pkg api/modelgate/modelgate.proto
//go:generate protoc -I=api --openapiv2_out swagger/ --openapiv2_opt logtostderr=true api/modelgate/modelgate.proto
//go:generate wire gen model-gate/internal/injection

package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"model-gate/config"
	"model-gate/internal/api/health"
	"model-gate/internal/api/middleware"
	modelgateAPI "model-gate/internal/api/modelgate"
	"model-gate/internal/injection"
	"model-gate/internal/pkg/embedding"
	"model-gate/internal/pkg/guided"
	healthcheck "model-gate/pkg/healthcheck/pb"
	dcHTTP "model-gate/pkg/http"
	"model-gate/pkg/interceptor/logger/logrus/logruswithrequestid"
	"model-gate/pkg/interceptor/xrequestid"
	"model-gate/pkg/modelgate"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/qdrant/go-client/qdrant"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
)

func main() {
	ctx := context.Background()

	cfg, err := config.NewConfig()
	if err != nil {
		panic("Failed to get config" + err.Error())
	}

	logLevel, err := cfg.GetLogLevel()
	if err != nil {
		panic(fmt.Errorf("failed to get log level: %w", err))
	}

	logHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})
	logger := slog.New(logHandler)

	server := grpc.NewServer(grpc.ChainUnaryInterceptor(
		xrequestid.UnaryServerInterceptor(),
		middleware.UnaryServerInterceptor(cfg.GetAuthCookieName()),
		logruswithrequestid.UnaryServerInterceptor(cfg),
	))

	reflection.Register(server)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.APP.Ports.GRPC))
	if err != nil {
		panic(fmt.Sprintf("failed to listen: %v", err))
	}

	httpClient := &http.Client{
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}

	clickHouseConnection, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{cfg.APP.DB.ChatHost + ":" + cfg.APP.DB.ChatPort},
		Auth: clickhouse.Auth{
			Database: cfg.APP.DB.ChatDb,
			Username: cfg.APP.DB.ChatLogin,
			Password: cfg.APP.DB.ChatPassword,
		},
		ClientInfo: clickhouse.ClientInfo{
			Products: []struct {
				Name    string
				Version string
			}{
				{Name: "ClickHouse-Importer", Version: "0.1"},
			},
		},
		TLS: nil,
	})
	if err != nil {
		log.Fatal(err)
	}

	postgresPool, err := pgxpool.New(ctx, cfg.APP.DatabaseDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer postgresPool.Close()

	client, err := qdrant.NewClient(&qdrant.Config{
		Host: cfg.GetVectorHost(),
		Port: cfg.GetVectorPort(),
	})
	if err != nil {
		log.Fatal(err)
	}

	api := injection.InitializeApplicationAPI(logHandler, cfg, httpClient, clickHouseConnection, postgresPool, client)
	var guidedRuntime *guided.Runtime
	if cfg.APP.GuidedDataPath != "" {
		emb, err := embedding.NewFactory(dcHTTP.NewDcHTTPClient(logger, httpClient), cfg, logger).GetProcessor(cfg.GetEmbeddingModelName())
		if err != nil {
			log.Fatal(err)
		}
		guidedRuntime, err = guided.Load(cfg.APP.GuidedDataPath, emb, client, cfg.APP.GuidedStageCollection)
		if err != nil {
			log.Fatal(err)
		}
	}
	modelgate.RegisterModelServiceServer(server, api)

	healthcheckAPI := health.NewAPI()
	healthcheck.RegisterHealthCheckServiceServer(server, healthcheckAPI)

	// Channel to listen for interrupt signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	go httpProxy(ctx, cfg.APP.Ports.GRPC, cfg.APP.Ports.HTTP, logger, api, cfg.GetAuthCookieName(), guidedRuntime)

	logger.Info("server started",
		"port", cfg.APP.Ports.HTTP)

	go func() {
		err = server.Serve(lis)
		if err != nil {
			panic(fmt.Errorf("failed to serve: %w", err))
		}
	}()

	sig := <-sigChan
	logger.Info("Received shutdown signal", "signal", sig)

	// Start graceful shutdown
	logger.Info("Initiating graceful shutdown...")

	// Shutdown gRPC server
	server.GracefulStop()
	logger.Info("gRPC server stopped gracefully")

	logger.Info("Server shutdown completed")
}

func httpProxy(ctx context.Context, grpcPort string, httpProxyPort string, logger *slog.Logger, api *modelgateAPI.API, cookieName string, guidedRuntime *guided.Runtime) {
	const ReadTimeout = 10
	const WriteTimeout = 20
	const IdleTimeout = 120
	const ReadHeaderTimeout = 5

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	mux := runtime.NewServeMux(
		runtime.WithIncomingHeaderMatcher(xrequestid.HeaderMatcher),
		runtime.WithMetadata(func(ctx context.Context, req *http.Request) metadata.MD {
			return metadata.Pairs("grpcgateway-cookie", req.Header.Get("Cookie"), "grpcgateway-referer", req.Header.Get("Referer"))
		}),
	)

	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}

	if err := api.RegisterManagementHTTP(mux, cookieName); err != nil {
		panic(fmt.Errorf("register chat management: %w", err))
	}
	if err := api.RegisterGuidedHTTP(mux, cookieName, guidedRuntime); err != nil {
		panic(fmt.Errorf("register guided chat: %w", err))
	}

	err := modelgate.RegisterModelServiceHandlerFromEndpoint(
		ctx,
		mux,
		fmt.Sprintf(":%s", grpcPort),
		opts,
	)
	if err != nil {
		panic(fmt.Errorf("failed to register note usecase handler: %w", err))
	}

	err = healthcheck.RegisterHealthCheckServiceHandlerFromEndpoint(
		ctx,
		mux,
		fmt.Sprintf(":%s", grpcPort),
		opts,
	)
	if err != nil {
		panic(fmt.Errorf("failed to register healthcheck: %w", err))
	}

	logger.Info("starting http proxy",
		"httpProxyPort", httpProxyPort,
		"grpcPort", grpcPort)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%s", httpProxyPort),
		Handler:           mux,
		ReadTimeout:       ReadTimeout * time.Second,
		WriteTimeout:      WriteTimeout * time.Second,
		IdleTimeout:       IdleTimeout * time.Second,
		ReadHeaderTimeout: ReadHeaderTimeout * time.Second,
	}

	err = httpServer.ListenAndServe()
	if err != nil {
		panic(fmt.Errorf("failed to serve: %w", err))
	}
}
