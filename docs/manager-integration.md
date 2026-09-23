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
go run ./cmd/manager-api-harness -action cancel -device op_opaque_id
```

Use opaque IDs printed by `list`. Identification pauses only the mapping chosen
by the manager, and is bounded to 15 seconds in this harness. Poll the returned
operation with `-action operation -device op_opaque_id`, or cancel it with the
same operation ID.

The API contract fixtures and socket-server tests cover negotiation, request
correlation, size bounds, endpoint resolution, unknown enum values, errors, and
implemented method shapes. Running the harness against an installed manager is
the remaining manual proof for API-04.

## Current desktop slice

The **Keyboards** landing screen calls the capability-gated `Workspace` bridge.
It performs hello, then `manager.get`; only an advertised `device_discovery`
capability allows a subsequent `device.list`. Every unavailable, incomplete, or
reconnecting state visibly dims and disables inventory and setup actions. Browser
Vite development reports that desktop bindings are absent; it never pretends to
be connected with fixtures.

When `device_identification` is advertised, a connected keyboard enables
**Identify**. The flow calls `device.identify.start`, polls `operation.get` while
active, and calls `device.identify.cancel` only for a live operation. Setup,
draft editing, validation, profile, and apply controls remain disabled because
those implementation milestones are not complete. The reviewed manager cannot
yet advertise `manager.get`, so its expected normal presentation today is
**Manager API incomplete**, with no `device.list` call made.
