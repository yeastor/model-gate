package xrequestid

import "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"

const RequestIDHeader = "X-Request-Id"

func HeaderMatcher(key string) (string, bool) {
	switch key {
	case RequestIDHeader:
		return key, true
	default:
		return runtime.DefaultHeaderMatcher(key)
	}
}
