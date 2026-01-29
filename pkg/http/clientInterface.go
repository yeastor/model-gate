package http

import (
	"net/http"
)

type Client interface {
	Post(url string, data []byte) (*http.Response, error)
	Get(url string) (*http.Response, error)
	Put(url string, data []byte) (*http.Response, error)
	Delete(url string) (*http.Response, error)
	PostWithLog(url string, data []byte, logArgs ...any) (*http.Response, error)
	GetWithLog(url string, logArgs ...any) (*http.Response, error)
	PutWithLog(url string, data []byte, logArgs ...any) (*http.Response, error)
	Do(req *http.Request) (*http.Response, error)
	DoWithLog(req *http.Request, logArgs ...any) (*http.Response, error)
	DeleteWithLog(url string, logArgs ...any) (*http.Response, error)
	SetCert(cert string)
	SetKey(cert string)
	GetHeaders() map[string]string
	SetHeaders(headers map[string]string)
}
