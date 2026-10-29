FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/agent-t-gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/agent-t-gateway /agent-t-gateway
EXPOSE 8330
ENTRYPOINT ["/agent-t-gateway"]
