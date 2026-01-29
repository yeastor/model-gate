package xrequestid

import (
	"context"

	multiint "github.com/mercari/go-grpc-interceptor/multiinterceptor"
	"google.golang.org/grpc"
)

type requestIDKey struct{}

func UnaryServerInterceptor(opt ...Option) grpc.UnaryServerInterceptor {
	var opts options

	opts.validator = DefaultValidator
	for _, o := range opt {
		o.apply(&opts)
	}

	return func(
		ctx context.Context,
		req interface{},
		_ *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		requestID := HandleRequestID(ctx, opts.validator)
		ctx = context.WithValue(ctx, requestIDKey{}, requestID)

		return handler(ctx, req)
	}
}

func StreamServerInterceptor(opt ...Option) grpc.StreamServerInterceptor {
	var opts options

	opts.validator = DefaultValidator
	for _, o := range opt {
		o.apply(&opts)
	}

	return func(
		srv interface{},
		stream grpc.ServerStream,
		_ *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) (err error) {
		ctx := stream.Context()
		requestID := HandleRequestID(ctx, opts.validator)
		ctx = context.WithValue(ctx, requestIDKey{}, requestID)
		stream = multiint.NewServerStreamWithContext(stream, ctx)

		return handler(srv, stream)
	}
}

func FromContext(ctx context.Context) string {
	id, ok := ctx.Value(requestIDKey{}).(string)
	if !ok {
		return ""
	}

	return id
}
