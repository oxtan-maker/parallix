# Process entry

**This directory contains the minimal executable host for the packaged `px` command.**

The entry module invokes the composed CLI and assigns `process.exitCode`. All
parsing, dispatch, application behavior, and concrete dependency construction
live in their canonical layers.

## What this directory is not

It is not a command registry, composition root, or workflow implementation.
