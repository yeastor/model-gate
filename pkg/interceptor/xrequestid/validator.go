package xrequestid

type validator func(string) bool

func DefaultValidator(xRequestID string) bool {
	return xRequestID != ""
}
