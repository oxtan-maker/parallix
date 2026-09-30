# Process entry

**This directory contains the minimal executable host for the packaged `px` command.**

The entry module invokes the composed CLI and terminates the process with the
command's status on both success and failure. A command can leave a loop anchor
behind (a kept-alive socket, an agent SDK handle), so assigning `process.exitCode`
alone would only return control once the event loop drained naturally and would
hang otherwise; the entry terminates with the operation's exit status. Because
`process.exit` truncates output when stdout/stderr is a pipe (writes flush
asynchronously there), the entry exits from a write callback that fires once
every buffered write has reached the pipe. It never waits for the event loop to
drain or for a fixed deadline, so a surviving loop anchor cannot hold the
process open and a slow reader never loses output. `npm run dev` therefore
always returns with the operation's status and its final output is never cut
off by a hang. All parsing, dispatch, application behavior, and
concrete dependency construction live in their canonical layers.

## What this directory is not

It is not a command registry, composition root, or workflow implementation.
