package managerapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

const eventBuffer = 64

var (
	ErrSlowEventConsumer  = errors.New("manager event consumer is too slow")
	ErrEventGap           = errors.New("manager event stream has a cursor gap")
	ErrEventResync        = errors.New("manager event stream requires a resync")
	ErrEventServerChanged = errors.New("manager event stream server changed")
)

// EventSubscription owns a dedicated API connection. The manager sends a
// subscription response followed by event frames on that same connection, so
// event streaming must not share the normal request/response connection.
type EventSubscription struct {
	Info   EventSubscriptionInfo
	Events <-chan Event

	connection net.Conn
	events     chan Event
	done       chan struct{}
	closeOnce  sync.Once
	errMu      sync.Mutex
	err        error
	cursorMu   sync.Mutex
	cursor     EventCursor
}

func (s *EventSubscription) Done() <-chan struct{} { return s.done }

func (s *EventSubscription) Err() error {
	s.errMu.Lock()
	defer s.errMu.Unlock()
	return s.err
}

// Cursor is the latest contiguous cursor delivered by this subscription. It is
// safe to persist after an event and is never advanced over a detected gap.
func (s *EventSubscription) Cursor() EventCursor {
	s.cursorMu.Lock()
	defer s.cursorMu.Unlock()
	return s.cursor
}

func (s *EventSubscription) advanceCursor(event Event) {
	s.cursorMu.Lock()
	s.cursor.EventID = event.EventID
	s.cursor.StateRevision = event.StateRevision
	s.cursorMu.Unlock()
}

func (s *EventSubscription) Close() error {
	s.finish(nil)
	return nil
}

func (s *EventSubscription) finish(err error) {
	s.closeOnce.Do(func() {
		s.errMu.Lock()
		s.err = err
		s.errMu.Unlock()
		_ = s.connection.Close()
		close(s.done)
	})
}

func (c *APIClient) Subscribe(ctx context.Context, cursor EventCursor) (*EventSubscription, error) {
	c.mu.Lock()
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return nil, ErrClosed
	}
	connection, err := c.dial(ctx, "unix", c.endpoint)
	if err != nil {
		return nil, fmt.Errorf("connect manager event socket %q: %w", c.endpoint, err)
	}
	reader := bufio.NewReaderSize(connection, MaxFrameBytes+1)
	var hello HelloResult
	if err := c.subscriptionRequest(ctx, connection, reader, "session.hello", HelloParams{SupportedVersions: []int{APIVersion}, Client: c.identity}, &hello); err != nil {
		_ = connection.Close()
		return nil, err
	}
	if hello.SelectedVersion != APIVersion {
		_ = connection.Close()
		return nil, fmt.Errorf("unsupported negotiated API version %d", hello.SelectedVersion)
	}
	params := EventSubscribeParams{AfterServerID: cursor.ServerID}
	if cursor.EventID != 0 || cursor.ServerID != "" {
		eventID := cursor.EventID
		params.AfterEventID = &eventID
	}
	var info EventSubscriptionInfo
	if err := c.subscriptionRequest(ctx, connection, reader, "events.subscribe", params, &info); err != nil {
		_ = connection.Close()
		return nil, err
	}
	if cursor.ServerID != "" && info.ServerID != "" && cursor.ServerID != info.ServerID {
		_ = connection.Close()
		return nil, fmt.Errorf("%w: expected %q, got %q", ErrEventServerChanged, cursor.ServerID, info.ServerID)
	}
	serverID := info.ServerID
	if serverID == "" {
		serverID = cursor.ServerID
	}
	subscription := &EventSubscription{
		Info: info, connection: connection, events: make(chan Event, eventBuffer), done: make(chan struct{}),
		cursor: EventCursor{ServerID: serverID, EventID: cursor.EventID, StateRevision: cursor.StateRevision},
	}
	subscription.Events = subscription.events
	go subscription.readEvents(reader)
	return subscription, nil
}

func (c *APIClient) subscriptionRequest(ctx context.Context, connection net.Conn, reader *bufio.Reader, method string, params any, output any) error {
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.deadline)
		defer cancel()
	}
	deadline, _ := ctx.Deadline()
	if err := connection.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set manager subscription deadline: %w", err)
	}
	id := requestID()
	payload, err := json.Marshal(request{Type: "request", ID: id, Method: method, Params: params, DeadlineMS: deadlineMilliseconds(ctx, c.deadline)})
	if err != nil {
		return fmt.Errorf("encode %s: %w", method, err)
	}
	if len(payload)+1 > MaxFrameBytes {
		return ErrFrameTooLarge
	}
	if err := writeFrame(connection, append(payload, '\n')); err != nil {
		return fmt.Errorf("write %s: %w", method, err)
	}
	line, err := reader.ReadSlice('\n')
	if err != nil {
		if errors.Is(err, bufio.ErrBufferFull) {
			return ErrFrameTooLarge
		}
		return fmt.Errorf("read %s response: %w", method, err)
	}
	if len(line) > MaxFrameBytes {
		return ErrFrameTooLarge
	}
	var response response
	if err := json.Unmarshal(line, &response); err != nil {
		return fmt.Errorf("decode %s response: %w", method, err)
	}
	if response.Type != "response" || response.ID != id {
		return fmt.Errorf("invalid %s response type", method)
	}
	if response.Error != nil {
		return response.Error
	}
	if output != nil {
		if err := json.Unmarshal(response.Result, output); err != nil {
			return fmt.Errorf("decode %s result: %w", method, err)
		}
	}
	return connection.SetDeadline(time.Time{})
}

func (s *EventSubscription) readEvents(reader *bufio.Reader) {
	defer close(s.events)
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			if errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF) {
				s.finish(nil)
			} else if errors.Is(err, bufio.ErrBufferFull) {
				s.finish(ErrFrameTooLarge)
			} else {
				s.finish(fmt.Errorf("read manager event: %w", err))
			}
			return
		}
		if len(line) > MaxFrameBytes {
			s.finish(ErrFrameTooLarge)
			return
		}
		var frame struct {
			Type string `json:"type"`
			Event
		}
		if err := json.Unmarshal(line, &frame); err != nil {
			s.finish(fmt.Errorf("decode manager event: %w", err))
			return
		}
		if frame.Type != "event" {
			s.finish(errors.New("unexpected non-event frame on manager event stream"))
			return
		}
		if frame.Event.Type == "manager.resync_required" {
			s.finish(ErrEventResync)
			return
		}
		cursor := s.Cursor()
		if frame.Event.EventID != cursor.EventID+1 {
			s.finish(fmt.Errorf("%w: expected event %d, got %d", ErrEventGap, cursor.EventID+1, frame.Event.EventID))
			return
		}
		if frame.Event.StateRevision < cursor.StateRevision {
			s.finish(fmt.Errorf("%w: state revision regressed from %d to %d", ErrEventGap, cursor.StateRevision, frame.Event.StateRevision))
			return
		}
		s.advanceCursor(frame.Event)
		select {
		case <-s.done:
			return
		case s.events <- frame.Event:
		default:
			s.finish(ErrSlowEventConsumer)
			return
		}
	}
}
