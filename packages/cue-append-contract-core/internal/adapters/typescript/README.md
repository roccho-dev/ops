# TypeScript static-check adapter

TypeScript/tsgo/tsc is not core.  It is an optional adapter for generated SDKs,
field accessors, and projection samples.  Its job is to make removed fields fail
at compile time for TypeScript consumers.
