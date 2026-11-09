package http

import (
	"bytes"
	"crypto/tls"
	"net/http"
)

type DcHTTPClient struct {
	cert    string
	key     string
	headers map[string]string
	logger  Logger
	client  *http.Client
}

func NewDcHTTPClient(logger Logger, client *http.Client) *DcHTTPClient {
	if logger == nil {
		logger = NewEmptyLogger()
	}

	return &DcHTTPClient{logger: logger, client: client}
}

func (c *DcHTTPClient) SetCert(cert string) {
	c.cert = cert
}

func (c *DcHTTPClient) SetKey(key string) {
	c.key = key
}

func (c *DcHTTPClient) GetHeaders() map[string]string {
	return c.headers
}

func (c *DcHTTPClient) SetHeaders(headers map[string]string) {
	c.headers = headers
}

func (c *DcHTTPClient) Delete(url string) (*http.Response, error) {
	res, err := c.doRequest(url, http.MethodDelete)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) Get(url string) (*http.Response, error) {
	res, err := c.doRequest(url, http.MethodGet)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) Post(url string, data []byte) (*http.Response, error) {
	res, err := c.doRequestWithBody(url, data, http.MethodPost)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) getHttpClient() (*http.Client, error) {
	client := &http.Client{}
	if len(c.key) > 0 && len(c.cert) > 0 {

		cert, err := tls.X509KeyPair([]byte(c.cert), []byte(c.key))
		if err != nil {
			return nil, err
		}

		tlsConfig := &tls.Config{
			Certificates:       []tls.Certificate{cert},
			InsecureSkipVerify: true,
		}
		transport := &http.Transport{TLSClientConfig: tlsConfig}
		client.Transport = transport
	}
	return client, nil
}

func (c *DcHTTPClient) Put(url string, data []byte) (*http.Response, error) {
	res, err := c.doRequestWithBody(url, data, http.MethodPut)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) doRequest(url string, method string) (*http.Response, error) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header = c.mapToHeaders()

	client, err := c.getHttpClient()
	if err != nil {
		return nil, err
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) doRequestWithBody(url string, data []byte, method string) (*http.Response, error) {
	body := bytes.NewReader(data)
	client, err := c.getHttpClient()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	req.Header = c.mapToHeaders()

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func (c *DcHTTPClient) logResult(res *http.Response, err error) (*http.Response, error) {
	if err != nil {
		c.logger.Error("upstream HTTP request failed", "code", "UPSTREAM_REQUEST_FAILED")
	} else if res != nil {
		c.logger.Info("upstream HTTP response", "status", res.StatusCode)
	}
	return res, err
}

func (c *DcHTTPClient) DeleteWithLog(url string, _ ...any) (*http.Response, error) {
	return c.logResult(c.Delete(url))
}

func (c *DcHTTPClient) GetWithLog(url string, _ ...any) (*http.Response, error) {
	return c.logResult(c.client.Get(url))
}

func (c *DcHTTPClient) Do(req *http.Request) (*http.Response, error) {
	return c.client.Do(req)
}

func (c *DcHTTPClient) DoWithLog(req *http.Request, _ ...any) (*http.Response, error) {
	return c.logResult(c.Do(req))
}

func (c *DcHTTPClient) PostWithLog(url string, data []byte, _ ...any) (*http.Response, error) {
	return c.logResult(c.Post(url, data))
}

func (c *DcHTTPClient) PutWithLog(url string, data []byte, _ ...any) (*http.Response, error) {
	return c.logResult(c.Put(url, data))
}

func (c *DcHTTPClient) mapToHeaders() http.Header {
	headers := http.Header{}

	for headerName, headerValue := range c.headers {
		headers.Add(headerName, headerValue)
	}

	return headers
}

var _ Client = (*DcHTTPClient)(nil)
