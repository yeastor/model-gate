package health

import (
	"context"
	"model-gate/pkg/healthcheck/pb"

	"google.golang.org/protobuf/types/known/emptypb"
)

type API struct {
	healthcheck.UnsafeHealthCheckServiceServer
}

func NewAPI() *API {
	return &API{}
}

func (api *API) LivenessProbe(_ context.Context, _ *emptypb.Empty) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, nil
}

func (api *API) ReadinessProbe(_ context.Context, _ *emptypb.Empty) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, nil
}
