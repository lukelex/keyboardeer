# Manager API development integration

KeyboarDeer communicates only through the same-user Unix socket API. It does
not read `/dev/input`, manager files, CLI output, process IDs, or logs as a
fallback.

## Transport client

`internal/managerapi` implements API v1 JSON Lines framing with a 1 MiB maximum
frame, a maximum of 32 in-flight requests, request IDs, bounded deadlines,
connection cleanup, and exponential reconnect backoff. Every new connection
starts with `session.hello`; normal application startup then requires
`manager.get` to determine capabilities.

At the reviewed manager revision, `manager.get` is intentionally unsupported.
The application reports **Manager API incomplete** and disables dependent UI. It
does not silently use fixture data or enable device actions based on a manager
version heuristic.

## Explicit harness

The harness is for testing a supported development manager; it is not a GUI
fallback or normal product transport.

```sh
go run ./cmd/manager-api-harness -action list
go run ./cmd/manager-api-harness -action preview -device dev_opaque_id \
  -behavior '(defsrc a)\n(deflayer base a)'
go run ./cmd/manager-api-harness -action identify -device dev_opaque_id
```

Use opaque IDs printed by `list`. Identification pauses only the mapping chosen
by the manager, and is bounded to 15 seconds in this harness. Poll the returned
operation with `-action operation -device op_opaque_id`.

The API contract fixtures and socket-server tests cover negotiation, request
correlation, size bounds, endpoint resolution, unknown enum values, errors, and
implemented method shapes. Running the harness against an installed manager is
the remaining manual proof for API-04.
