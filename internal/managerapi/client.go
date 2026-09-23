package managerapi

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	ErrClosed          = errors.New("manager client is closed")
	ErrTooManyRequests = errors.New("manager client has too many in-flight requests")
	ErrFrameTooLarge   = errors.New("manager API frame exceeds 1 MiB")
	ErrReconnecting    = errors.New("manager connection is waiting to retry")
)

type DialFunc func(ctx context.Context, network, address string) (net.Conn, error)

type Options struct {
	Endpoint         string
	ClientName       string
	ClientVersion    string
	DefaultDeadline  time.Duration
	Dial             DialFunc
	ReconnectInitial time.Duration
	ReconnectMaximum time.Duration
}

type ClientConnection struct {
	conn       net.Conn
	generation uint64
	writeMu    sync.Mutex
	pendingMu  sync.Mutex
	pending    map[string]chan response
	helloMu    sync.Mutex
	hello      *HelloResult
}

type APIClient struct {
	endpoint     string
	identity     Client
	deadline     time.Duration
	dial         DialFunc
	retryInitial time.Duration
	retryMaximum time.Duration

	mu            sync.Mutex
	connection    *ClientConnection
	generation    uint64
	closed        bool
	retryAttempt  int
	nextReconnect time.Time
}

type request struct {
	Type       string `json:"type"`
	ID         string `json:"id"`
	Method     string `json:"method"`
	Params     any    `json:"params"`
	DeadlineMS int    `json:"deadline_ms,omitempty"`
}

type response struct {
	Type   string          `json:"type"`
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *Error          `json:"error"`
}

func EndpointFromEnvironment(getenv func(string) string, home string) string {
	if runtimeDir := getenv("XDG_RUNTIME_DIR"); runtimeDir != "" {
		return filepath.Join(runtimeDir, "kmonad-device-manager", "api.sock")
	}
	return filepath.Join(home, ".config", "kmonad-device-manager", "api.sock")
}

func DefaultEndpoint() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "~"
	}
	return EndpointFromEnvironment(os.Getenv, home)
}

func New(options Options) *APIClient {
	if options.Endpoint == "" {
		options.Endpoint = DefaultEndpoint()
	}
	if options.ClientName == "" {
		options.ClientName = "keyboardeer"
	}
	if options.ClientVersion == "" {
		options.ClientVersion = "development"
	}
	if options.DefaultDeadline <= 0 {
		options.DefaultDeadline = DefaultDeadline * time.Millisecond
	}
	if options.DefaultDeadline > MaxDeadlineMS*time.Millisecond {
		options.DefaultDeadline = MaxDeadlineMS * time.Millisecond
	}
	if options.Dial == nil {
		options.Dial = (&net.Dialer{}).DialContext
	}
	if options.ReconnectInitial <= 0 {
		options.ReconnectInitial = 250 * time.Millisecond
	}
	if options.ReconnectMaximum <= 0 {
		options.ReconnectMaximum = 5 * time.Second
	}
	return &APIClient{
		endpoint: options.Endpoint, identity: Client{Name: options.ClientName, Version: options.ClientVersion},
		deadline: options.DefaultDeadline, dial: options.Dial, retryInitial: options.ReconnectInitial, retryMaximum: options.ReconnectMaximum,
	}
}

func (c *APIClient) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	connection := c.connection
	c.connection = nil
	c.mu.Unlock()
	if connection != nil {
		c.failConnection(connection, ErrClosed)
	}
	return nil
}

func (c *APIClient) ensureConnection(ctx context.Context) (*ClientConnection, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, ErrClosed
	}
	if c.connection != nil {
		connection := c.connection
		c.mu.Unlock()
		return connection, nil
	}
	if !c.nextReconnect.IsZero() && time.Now().Before(c.nextReconnect) {
		c.mu.Unlock()
		return nil, ErrReconnecting
	}
	c.mu.Unlock()

	conn, err := c.dial(ctx, "unix", c.endpoint)
	if err != nil {
		c.noteConnectFailure()
		return nil, fmt.Errorf("connect manager socket %q: %w", c.endpoint, err)
	}
	connection := &ClientConnection{conn: conn, pending: make(map[string]chan response)}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		_ = conn.Close()
		return nil, ErrClosed
	}
	if c.connection != nil {
		existing := c.connection
		c.mu.Unlock()
		_ = conn.Close()
		return existing, nil
	}
	c.generation++
	connection.generation = c.generation
	c.connection = connection
	c.retryAttempt = 0
	c.nextReconnect = time.Time{}
	c.mu.Unlock()
	go c.readResponses(connection)
	return connection, nil
}

func (c *APIClient) noteConnectFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retryAttempt++
	delay := c.retryInitial
	for step := 1; step < c.retryAttempt && delay < c.retryMaximum; step++ {
		delay *= 2
	}
	if delay > c.retryMaximum {
		delay = c.retryMaximum
	}
	c.nextReconnect = time.Now().Add(delay)
}

func (c *APIClient) readResponses(connection *ClientConnection) {
	reader := bufio.NewReaderSize(connection.conn, MaxFrameBytes+1)
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			if errors.Is(err, bufio.ErrBufferFull) {
				c.failConnection(connection, ErrFrameTooLarge)
				return
			}
			if !errors.Is(err, io.EOF) {
				c.failConnection(connection, fmt.Errorf("read manager response: %w", err))
			} else {
				c.failConnection(connection, io.EOF)
			}
			return
		}
		if len(line) > MaxFrameBytes {
			c.failConnection(connection, ErrFrameTooLarge)
			return
		}
		var wire response
		if err := json.Unmarshal(line, &wire); err != nil {
			c.failConnection(connection, fmt.Errorf("decode manager response: %w", err))
			return
		}
		if wire.Type != "response" || wire.ID == "" {
			// Events are intentionally ignored until events.subscribe is supported.
			continue
		}
		connection.pendingMu.Lock()
		waiter := connection.pending[wire.ID]
		delete(connection.pending, wire.ID)
		connection.pendingMu.Unlock()
		if waiter != nil {
			waiter <- wire
			close(waiter)
		}
	}
}

func (c *APIClient) failConnection(connection *ClientConnection, cause error) {
	_ = connection.conn.Close()
	connection.pendingMu.Lock()
	for id, waiter := range connection.pending {
		delete(connection.pending, id)
		waiter <- response{Error: &Error{Code: "transport", Message: cause.Error()}}
		close(waiter)
	}
	connection.pendingMu.Unlock()
	c.mu.Lock()
	if c.connection == connection {
		c.connection = nil
		if !c.closed {
			c.retryAttempt++
			delay := c.retryInitial
			for step := 1; step < c.retryAttempt && delay < c.retryMaximum; step++ {
				delay *= 2
			}
			if delay > c.retryMaximum {
				delay = c.retryMaximum
			}
			c.nextReconnect = time.Now().Add(delay)
		}
	}
	c.mu.Unlock()
}

func requestID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err == nil {
		return hex.EncodeToString(bytes)
	}
	return fmt.Sprintf("request-%d", time.Now().UnixNano())
}

func deadlineMilliseconds(ctx context.Context, fallback time.Duration) int {
	deadline := fallback
	if until, ok := ctx.Deadline(); ok {
		deadline = time.Until(until)
	}
	if deadline <= 0 {
		return 1
	}
	if deadline > MaxDeadlineMS*time.Millisecond {
		return MaxDeadlineMS
	}
	return int(deadline.Milliseconds())
}

func (c *APIClient) rawCall(ctx context.Context, method string, params any) (json.RawMessage, error) {
	connection, err := c.ensureConnection(ctx)
	if err != nil {
		return nil, err
	}
	return c.rawCallOnConnection(ctx, connection, method, params)
}

func (c *APIClient) rawCallOnConnection(ctx context.Context, connection *ClientConnection, method string, params any) (json.RawMessage, error) {
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.deadline)
		defer cancel()
	}
	id := requestID()
	wire := request{Type: "request", ID: id, Method: method, Params: params, DeadlineMS: deadlineMilliseconds(ctx, c.deadline)}
	payload, err := json.Marshal(wire)
	if err != nil {
		return nil, fmt.Errorf("encode %s: %w", method, err)
	}
	if len(payload)+1 > MaxFrameBytes {
		return nil, ErrFrameTooLarge
	}
	waiter := make(chan response, 1)
	connection.pendingMu.Lock()
	if len(connection.pending) >= MaxInFlight {
		connection.pendingMu.Unlock()
		return nil, ErrTooManyRequests
	}
	connection.pending[id] = waiter
	connection.pendingMu.Unlock()
	connection.writeMu.Lock()
	err = writeFrame(connection.conn, append(payload, '\n'))
	connection.writeMu.Unlock()
	if err != nil {
		connection.pendingMu.Lock()
		delete(connection.pending, id)
		connection.pendingMu.Unlock()
		c.failConnection(connection, fmt.Errorf("write manager request: %w", err))
		return nil, err
	}
	select {
	case response, open := <-waiter:
		if !open {
			return nil, errors.New("manager response channel closed")
		}
		if response.Error != nil {
			return nil, response.Error
		}
		return response.Result, nil
	case <-ctx.Done():
		connection.pendingMu.Lock()
		delete(connection.pending, id)
		connection.pendingMu.Unlock()
		return nil, ctx.Err()
	}
}

// writeFrame handles short writes so each API request remains one complete JSON
// Lines frame even when a transport accepts only part of a write at a time.
func writeFrame(connection net.Conn, frame []byte) error {
	for len(frame) != 0 {
		written, err := connection.Write(frame)
		if written > 0 {
			frame = frame[written:]
		}
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func (c *APIClient) ensureHello(ctx context.Context) (*ClientConnection, error) {
	connection, err := c.ensureConnection(ctx)
	if err != nil {
		return nil, err
	}
	connection.helloMu.Lock()
	defer connection.helloMu.Unlock()
	if connection.hello != nil {
		return connection, nil
	}
	result, err := c.rawCallOnConnection(ctx, connection, "session.hello", HelloParams{SupportedVersions: []int{APIVersion}, Client: c.identity})
	if err != nil {
		return nil, err
	}
	var hello HelloResult
	if err := json.Unmarshal(result, &hello); err != nil {
		return nil, fmt.Errorf("decode session.hello: %w", err)
	}
	if hello.SelectedVersion != APIVersion {
		return nil, fmt.Errorf("unsupported negotiated API version %d", hello.SelectedVersion)
	}
	connection.hello = &hello
	return connection, nil
}

func (c *APIClient) call(ctx context.Context, method string, params any, output any) error {
	connection, err := c.ensureHello(ctx)
	if err != nil {
		return err
	}
	result, err := c.rawCallOnConnection(ctx, connection, method, params)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(result, output); err != nil {
		return fmt.Errorf("decode %s: %w", method, err)
	}
	return nil
}

func (c *APIClient) Hello(ctx context.Context) (HelloResult, error) {
	connection, err := c.ensureHello(ctx)
	if err != nil {
		return HelloResult{}, err
	}
	return *connection.hello, nil
}
func (c *APIClient) ManagerGet(ctx context.Context) (ManagerInfo, error) {
	var result ManagerInfo
	return result, c.call(ctx, "manager.get", map[string]any{}, &result)
}
func (c *APIClient) SnapshotGet(ctx context.Context) (Snapshot, error) {
	var result Snapshot
	return result, c.call(ctx, "snapshot.get", map[string]any{}, &result)
}
func (c *APIClient) DeviceList(ctx context.Context) (DeviceListResult, error) {
	var result DeviceListResult
	return result, c.call(ctx, "device.list", map[string]any{}, &result)
}
func (c *APIClient) IdentifyStart(ctx context.Context, params IdentifyStartParams) (Operation, error) {
	var result struct {
		Operation Operation `json:"operation"`
	}
	err := c.call(ctx, "device.identify.start", params, &result)
	return result.Operation, err
}
func (c *APIClient) IdentifyCancel(ctx context.Context, operationID string) (Operation, error) {
	var result struct {
		Operation Operation `json:"operation"`
	}
	err := c.call(ctx, "device.identify.cancel", OperationParams{OperationID: operationID}, &result)
	return result.Operation, err
}
func (c *APIClient) OperationGet(ctx context.Context, operationID string) (Operation, error) {
	var result struct {
		Operation Operation `json:"operation"`
	}
	err := c.call(ctx, "operation.get", OperationParams{OperationID: operationID}, &result)
	return result.Operation, err
}
func (c *APIClient) Preview(ctx context.Context, params PreviewParams) (PreviewResult, error) {
	var result PreviewResult
	return result, c.call(ctx, "validation.preview", params, &result)
}
func (c *APIClient) ConfigurationCreate(ctx context.Context, params ConfigurationWriteParams) (Operation, error) {
	var result ConfigurationWriteResult
	err := c.call(ctx, "configuration.create", params, &result)
	return result.Operation, err
}
func (c *APIClient) ConfigurationUpdate(ctx context.Context, params ConfigurationWriteParams) (Operation, error) {
	var result ConfigurationWriteResult
	err := c.call(ctx, "configuration.update", params, &result)
	return result.Operation, err
}
func (c *APIClient) ConfigurationSetEnabled(ctx context.Context, params ConfigurationSetEnabledParams) (Operation, error) {
	var result ConfigurationSetEnabledResult
	err := c.call(ctx, "configuration.set_enabled", params, &result)
	return result.Operation, err
}
