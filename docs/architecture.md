# Architecture and trade-offs

Trail combines typed event scopes, pluggable stores, framework adapters, and a local SQLite explorer. This document records the decisions behind that shape.

## From request to investigation

A checkout request enters the Hono middleware, which opens an HTTP scope using `obs.context()`. The handler calls `obs.enrich()` to add business context. A nested payment scope creates a separate event with the HTTP event's ID as its `parent_id`.

Each scope writes its accumulated event when it ends. Exceptions are captured with an error payload and rethrown; the HTTP adapter also records status and duration. Studio later reads those rows directly from SQLite.

The [checkout example](../examples/README.md) demonstrates successful, slow, and failed requests through this flow.

## Core: context belongs to the scope

[`core.ts`](../packages/trail/src/core.ts) uses `AsyncLocalStorage` to isolate concurrent scopes. Callers can enrich the current event without passing an event object through each function. Nested scopes and `emit()` calls inherit the current event's ID as their parent.

A store implements `write(event)` and may implement `flush()` and `cleanup()`. The core tracks pending writes for `obs.flush()`. It captures thrown errors even when a scope was suppressed, so suppressing routine traffic does not hide exceptions.

Adapters translate HTTP or RPC outcomes into event fields and severity. Hono, oRPC, and tRPC live behind separate subpath exports, as do the SQLite and memory stores.

## SQLite: explicit columns, flexible payloads

The store uses `bun:sqlite`. Common fields have fixed columns. Declared fields become SQL columns, with optional indexes; undeclared fields are serialized into `extra` JSON. Error payloads are serialized separately.

Adapter column maps such as `httpColumns` match the fields each adapter enriches. Declaring them makes those fields available to Studio's SQL filters. JSON fields remain inspectable in event details.

File-backed databases use WAL mode, allowing Studio to read while the application writes. Retention is applied when the caller invokes `obs.cleanup()`; it is not a background scheduler. The longest matching TTL wins across default, severity, and event type rules.

Column declarations create the initial schema. They are not a migration system for adding columns to an existing database.

## Studio: a standalone process

Studio is a CLI that starts a local Hono server and serves a React interface. It opens the database in readonly mode and does not call the source application's HTTP API.

This makes investigation possible after the source app stops. It also avoids mounting a new admin surface inside each application. The trade-off is coupling Studio to Trail's SQLite schema; other stores would need their own adapter.

Studio binds to `127.0.0.1` by default. There is no built-in authentication or multi-user access model. Remote investigation uses a consistent SQLite backup or an SSH tunnel. See the [Studio guide](../packages/trail-studio/README.md).

## Schema discovery and filters

At startup, SQLite PRAGMAs discover column names, SQL types, and indexes. The running process caches that structure. Event counts and oldest/newest timestamps are queried separately so they reflect ongoing writes.

Severity, timestamp, and parent relationships have dedicated UI behavior. Custom filters are derived from declared SQL columns. Filter values use prepared statement bindings, and column identifiers are validated against the discovered schema before SQL is built.

This keeps the database self-describing without adding a separate metadata protocol between Trail and Studio. Schema changes require restarting Studio.

## Live tail and pagination

The client polls matching events every three seconds. Pausing freezes the list while a separate count query checks for newer matches. Clicking the new-event badge returns to the newest events.

Polling keeps the server stateless and avoids a separate SSE or WebSocket transport. It trades immediate delivery for a short refresh delay.

Events are ordered by timestamp and ID. Cursors encode both values and support paging backward or counting newer rows. Trace queries follow parent links with a recursive CTE and return up to 200 direct child events.

## Packaging

The core publishes TypeScript source directly. Bun is the supported runtime, so consumers do not need a separate build step for Trail.

Studio's server also ships as TypeScript, but its React client is bundled with Vite before publication. React, Vite, and TanStack dependencies are development dependencies; consumers receive the built client assets. There is no postinstall build.

## Current boundaries

The API is early 0.1.x. Studio supports local, readonly investigation of Trail SQLite databases. Hosted dashboards, authentication, alerts, exports, and non-SQLite stores are outside its current scope.

Possible future work includes aggregations, filtering nested JSON fields, and multiple databases. These are directions rather than release commitments.
