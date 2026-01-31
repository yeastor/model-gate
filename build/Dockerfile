FROM golang:1.23.12-alpine3.22 AS builder

ARG CI_JOB_TOKEN
ARG CI_JOB_USER

WORKDIR /build

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o application .

FROM alpine:3.22

RUN apk add curl #for coker compose health check

WORKDIR /root

COPY --from=builder /build/application .

ENTRYPOINT ["./application"]
