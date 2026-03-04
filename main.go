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
	"model-gate/internal/injection"
	healthcheck "model-gate/pkg/healthcheck/pb"
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
	"github.com/qdrant/go-client/qdrant"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
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
		logruswithrequestid.UnaryServerInterceptor(cfg),
	))

	reflection.Register(server)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", cfg.APP.Ports.GRPC))
	if err != nil {
		panic(fmt.Sprintf("failed to listen: %v", err))
	}

	httpClient := &http.Client{}

	clickHouseConnection, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{cfg.APP.DB.ChatHost + ":9000"},
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

	client, err := qdrant.NewClient(&qdrant.Config{
		Host: cfg.GetVectorHost(),
		Port: cfg.GetVectorPort(),
	})
	if err != nil {
		log.Fatal(err)
	}

	api := injection.InitializeApplicationAPI(logHandler, cfg, httpClient, clickHouseConnection, client)
	modelgate.RegisterModelServiceServer(server, api)

	healthcheckAPI := health.NewAPI()
	healthcheck.RegisterHealthCheckServiceServer(server, healthcheckAPI)

	// Channel to listen for interrupt signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	go httpProxy(ctx, cfg.APP.Ports.GRPC, cfg.APP.Ports.HTTP, logger)

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

func httpProxy(ctx context.Context, grpcPort string, httpProxyPort string, logger *slog.Logger) {
	const ReadTimeout = 10
	const WriteTimeout = 20
	const IdleTimeout = 120
	const ReadHeaderTimeout = 5

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	mux := runtime.NewServeMux(
		runtime.WithIncomingHeaderMatcher(xrequestid.HeaderMatcher),
	)

	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
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
